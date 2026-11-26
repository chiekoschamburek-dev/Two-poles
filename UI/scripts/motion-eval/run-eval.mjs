// 真实视频验证驱动：视频解码 + MediaPipe WASM 只能在浏览器里跑，所以走 CDP。
// 用法：
//   npm run eval:motion -- --target dev        （最坏情况：DEV 强制主线程 CPU）
//   npm run build && npm run eval:motion -- --target preview   （worker/GPU，性能结论只能用这个）
//   npm run eval:motion -- --target android    （先 adb forward tcp:9350 localabstract:chrome_devtools_remote）
//   npm run eval:motion -- --clip data_demo/test_squat.mp4
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const UI_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const REPO_ROOT = resolve(UI_ROOT, '..')
const TRUTH_DIR = resolve(UI_ROOT, 'scripts/motion-eval/truth')
const BASELINE_DIR = resolve(UI_ROOT, 'scripts/motion-eval/baseline')
const PORT = 9350

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const target = flag('target', 'dev')
const onlyClip = flag('clip', '')
const gate = args.includes('--gate')
const baseUrl = flag('url', target === 'preview' ? 'http://127.0.0.1:4173' : target === 'android' ? 'https://two-poles.bupt-empty-classrom.top' : 'http://127.0.0.1:5173')

/** 候选素材：库存片机位/人物任意，只能逐片报告，不得聚合成单一准确率。 */
const CANDIDATES = [
  'data_demo/test_squat.mp4',
  'UI/public/demo-videos/sit-to-stand.mp4',
  '.scratch/peso-muerto.webm',
  '.scratch/peso-muerto-sumo.webm',
  '.scratch/deadlift-demo.webm',
  'UI/public/demo-videos/easy-run.mp4',
  'UI/public/demo-videos/brisk-walk.mp4'
]

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean)
  return candidates.find(path => existsSync(path)) ?? null
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitForDebugger(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch { /* 还没起来 */ }
    await sleep(300)
  }
  throw new Error(`Chrome 调试端口 ${PORT} 未就绪`)
}

class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map()
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data)
      const slot = this.pending.get(msg.id)
      if (!slot) return
      this.pending.delete(msg.id)
      msg.error ? slot.reject(new Error(JSON.stringify(msg.error))) : slot.resolve(msg.result)
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
    return new Cdp(ws)
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} 超时`)) }, 300000)
    })
  }
  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? '页面求值失败')
    return res.result.value
  }
  close() { this.ws.close() }
}

function loadTruth() {
  if (!existsSync(TRUTH_DIR)) return new Map()
  return new Map(readdirSync(TRUTH_DIR).filter(f => f.endsWith('.json'))
    .map(f => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(resolve(TRUTH_DIR, f), 'utf8'))]))
}

const mean = values => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null
const pctl = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}
/** 动作 id 统一：真值里可能写 sit_to_stand / run，模板 id 用 sit-to-stand / running。 */
const canonicalAction = value => value === 'sit_to_stand' ? 'sit-to-stand' : value === 'run' ? 'running' : value ?? null

/** 逐片指标。无真值的维度一律返回 null 并标 untested，绝不编造。 */
function scoreClip(clip, series, pipeline, truth) {
  const repTruth = truth?.reps?.length ?? null
  const counted = pipeline?.result?.repCount ?? null
  const gaitTruth = truth?.gaitCycles ?? null
  const cycles = pipeline?.result?.gaitCycles ?? null
  const truthAction = canonicalAction(truth?.action ?? null)
  const measuredAction = canonicalAction(pipeline?.precheck?.action ?? series.action ?? null)
  const truthView = truth?.view ?? null
  const measuredView = series.view ?? null
  const countKind = gaitTruth !== null ? 'gait' : 'reps'
  const countTruth = countKind === 'gait' ? gaitTruth : repTruth
  const countMeasured = countKind === 'gait' ? cycles : counted
  const actionHit = truthAction === null ? null : truthAction === measuredAction
  const viewHit = truthView === null ? null : truthView === measuredView
  const countHit = countTruth === null ? null : countTruth === countMeasured

  const angleRows = (truth?.angleKeys ?? []).map(key => {
    const row = series.frames.reduce((best, candidate) =>
      Math.abs(candidate.timeMs - key.timeMs) < Math.abs((best?.timeMs ?? Infinity) - key.timeMs) ? candidate : best, null)
    const measured = row ? (key.joint === 'hip' ? row.hipAngle : key.joint === 'trunk' ? row.trunkAngle : row.kneeAngle) : null
    return { ...key, measured, error: measured === null ? null : Math.abs(measured - key.refAngleDeg) }
  }).filter(row => row.error !== null)

  const issueRows = (truth?.issues ?? []).map(item => {
    const hit = (pipeline?.result?.findings ?? []).some(f => f.ruleId === item.ruleId
      && (item.repIndex === undefined || f.detail?.includes(`第 ${item.repIndex} 次`)))
    return { ruleId: item.ruleId, expected: item.present, detected: hit }
  })
  const testedRules = new Set(issueRows.map(r => r.ruleId))
  const allRules = [...new Set((pipeline?.result?.findings ?? []).map(f => f.ruleId))]

  return {
    clip, hasTruth: Boolean(truth),
    annotationStatus: truth?.annotationStatus ?? 'pending',
    truth: {
      action: truthAction,
      movementFamily: truth?.movementFamily ?? null,
      view: truthView,
      viewNote: truth?.viewNote ?? null,
      repCount: repTruth,
      gaitCycles: gaitTruth,
      gaitSubtype: truth?.gaitSubtype ?? null,
      partialRepetitions: truth?.partialRepetitions ?? []
    },
    view: measuredView, viewConfidence: series.viewConfidence,
    action: measuredAction, actionConfident: pipeline?.precheck?.actionConfident ?? series.actionConfident,
    captureAction: series.action,
    gate: { action: actionHit, view: viewHit, count: countHit },
    count: { kind: countKind, truth: countTruth, measured: countMeasured },
    precheckVerdict: series.precheck?.verdict,
    // 整片纯管道与真实 precheck 是两个不同口径：precheck 只看前 ≤10 秒，
    // 可能拒掉整片可分析的片子。两者都报，不互相掩盖。
    fullClip: { view: series.view, verdict: series.precheck?.verdict, reasons: series.precheck?.reasons ?? [] },
    pipelinePrecheck: pipeline?.precheck
      ? { view: pipeline.precheck.view, verdict: pipeline.precheck.verdict, action: pipeline.precheck.action, reasons: pipeline.precheck.reasons }
      : null,
    precheckWindowMismatch: Boolean(pipeline?.precheck && series.view && pipeline.precheck.view !== series.view),
    repCount: { truth: repTruth, counted, signedError: repTruth !== null && counted !== null ? counted - repTruth : null },
    gaitCycles: { truth: gaitTruth, detected: cycles },
    angleAgreement: angleRows.length
      ? { samples: angleRows.length, mae: mean(angleRows.map(r => r.error)), p95: pctl(angleRows.map(r => r.error), 0.95),
          method: 'human-digitization', caveat: '人工点击精度约 ±3–5°，这是一致性不是绝对真值' }
      : { samples: 0, status: 'untested', reason: '该片没有数字化关键帧' },
    issueDetection: issueRows.length
      ? { rows: issueRows,
          precision: (() => { const tp = issueRows.filter(r => r.expected && r.detected).length; const fp = issueRows.filter(r => !r.expected && r.detected).length; return tp + fp ? tp / (tp + fp) : null })(),
          recall: (() => { const tp = issueRows.filter(r => r.expected && r.detected).length; const fn = issueRows.filter(r => r.expected && !r.detected).length; return tp + fn ? tp / (tp + fn) : null })() }
      : { status: 'untested', reason: '该片没有问题有无标注' },
    untestedRules: allRules.filter(rule => !testedRules.has(rule)),
    timing: { ...series.timing, pipelineWallMs: pipeline?.wallMs ?? null, delegate: series.engineState?.delegate, runsIn: series.engineState?.runsIn },
    crossCheck: {
      pureFrameCount: series.frameCount,
      pipelineRepCount: counted,
      note: '通道 a 与通道 b 用同一引擎与同一几何；计数不一致说明 composable 接线有问题'
    }
  }
}

async function main() {
  const truth = loadTruth()
  const clips = (onlyClip ? [onlyClip] : CANDIDATES)
    .map(path => resolve(REPO_ROOT, path))
    .filter(path => existsSync(path))
  if (!clips.length) { console.error('没有可用素材'); process.exitCode = 1; return }

  let chrome = null
  if (target !== 'android') {
    const binary = chromePath()
    if (!binary) { console.error('找不到 Chrome，请设置 CHROME_PATH'); process.exitCode = 1; return }
    chrome = spawn(binary, [
      '--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu-sandbox', '--use-gl=angle', '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + resolve(UI_ROOT, '.eval-chrome'), 'about:blank'
    ], { stdio: 'ignore' })
  }

  const version = await waitForDebugger()
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  // 会话级 CDP：把 sessionId 包进每条消息
  const rawSend = cdp.send.bind(cdp)
  cdp.send = (method, params = {}) => {
    const id = ++cdp.seq
    return new Promise((resolve, reject) => {
      cdp.pending.set(id, { resolve, reject })
      cdp.ws.send(JSON.stringify({ id, method, params, sessionId }))
      setTimeout(() => { if (cdp.pending.delete(id)) reject(new Error(`${method} 超时`)) }, 300000)
    })
  }
  void rawSend

  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('DOM.enable')
  const pageUrl = `${baseUrl}/eval/motion-eval.html`
  await cdp.send('Page.navigate', { url: pageUrl })
  await sleep(4000)
  const hasEval = await cdp.evaluate('typeof window.__eval === "object"')
  if (!hasEval) {
    console.error(`夹具页面未加载：${pageUrl}\ntarget=preview 需要先跑 EVAL=1 npm run build`)
    cdp.close(); chrome?.kill(); process.exitCode = 1; return
  }

  const results = []
  for (const clip of clips) {
    const name = basename(clip, extname(clip))
    console.log(`\n=== ${name} ===`)
    try {
      const { root } = await cdp.send('DOM.getDocument')
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file' })
      await cdp.send('DOM.setFileInputFiles', { files: [clip], nodeId })
      await sleep(2500)
      const fps = /run|walk/i.test(name) ? 30 : 15
      const maxSeconds = fps === 30 ? 20 : 60
      const series = await cdp.evaluate(`window.__eval.captureSeries(${fps}, ${maxSeconds})`)
      const pipeline = await cdp.evaluate(`window.__eval.runPipeline(${fps}, ${maxSeconds})`)
      const scored = scoreClip(name, series, pipeline, truth.get(name))
      results.push(scored)
      const mark = value => value === null ? '?' : value ? '✓' : '✗'
      console.log(`  动作 真值 ${scored.truth.action ?? '未标注'} / 实测 ${scored.action ?? '—'} ${mark(scored.gate.action)}`)
      console.log(`  视角 真值 ${scored.truth.view ?? '未标注'} / 实测 ${scored.view ?? '—'} ${mark(scored.gate.view)}`)
      console.log(`  计数 真值 ${scored.count.truth ?? '未标注'} / 实测 ${scored.count.measured ?? '—'} ${mark(scored.gate.count)} · 预检 ${scored.precheckVerdict}`)
      console.log(`  推理 p50 ${scored.timing.inferenceP50}ms p95 ${scored.timing.inferenceP95}ms · ${scored.timing.delegate}/${scored.timing.runsIn}`)
      console.log(`  角度一致性 ${scored.angleAgreement.samples ? `MAE ${scored.angleAgreement.mae?.toFixed(2)}°` : '未标注'}`)
      // 逐帧序列单独落盘，换阈值后可离线重跑规则而不重推理
      mkdirSync(BASELINE_DIR, { recursive: true })
      writeFileSync(resolve(BASELINE_DIR, `${name}.series.json`), JSON.stringify({ clip: name, fps, ...series }, null, 2))
    } catch (error) {
      console.error(`  失败：${error.message}`)
      results.push({ clip: name, error: error.message })
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const report = {
    generatedAt: new Date().toISOString(), target, baseUrl, gate,
    caveats: [
      'truth 为 provisional：关键帧初标，尚未由用户逐条复核',
      '库存素材机位/人物任意且未裁剪，只能逐片报告，不得聚合成单一准确率',
      '角度口径是与人工数字化的一致性（±3–5°），不是绝对真值',
      'reps 只含完整重复；partialRepetitions 单独记录，不参与计数',
      '语料未触发的规则标 untested，合成正例只算逻辑覆盖',
      target === 'dev' ? 'DEV 强制主线程 CPU，性能数字是最坏情况，不能代表生产' : ''
    ].filter(Boolean),
    clips: results
  }
  mkdirSync(BASELINE_DIR, { recursive: true })
  const file = resolve(BASELINE_DIR, `${stamp}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\n基线报告：${file}`)
  const untested = results.flatMap(r => r.untestedRules ?? [])
  if (untested.length) console.log(`未覆盖规则：${[...new Set(untested)].join(', ')}`)
  const noTruth = results.filter(r => r.hasTruth === false).map(r => r.clip)
  if (noTruth.length) console.log(`缺真值标注（只出耗时与识别结果，不出准确率）：${noTruth.join(', ')}`)

  if (gate) {
    const failed = results.filter(r => r.gate && Object.values(r.gate).includes(false))
    if (failed.length) {
      console.error(`\n门禁失败：${failed.map(r => r.clip).join(', ')}`)
      for (const row of failed) {
        const bad = Object.entries(row.gate).filter(([, hit]) => hit === false).map(([key]) => key)
        console.error(`  ${row.clip}: ${bad.join(', ')}`)
      }
      process.exitCode = 1
    } else {
      console.log('\n门禁通过：全部素材 action/view/count 命中 provisional 真值')
    }
  }

  cdp.close()
  chrome?.kill()
}

main().catch(error => { console.error(error); process.exitCode = 1 })