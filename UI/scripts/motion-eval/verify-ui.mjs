// 驱动真实 /analysis 页面跑完整 UI 流程，验证曲线/置信度/解读/趋势确实渲染出来。
// 用法：node scripts/motion-eval/verify-ui.mjs [--clip data_demo/test_squat.mp4]
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const UI_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const REPO_ROOT = resolve(UI_ROOT, '..')
const PORT = 9351
const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1] : fallback }
const clipPath = resolve(REPO_ROOT, flag('clip', 'data_demo/test_squat.mp4'))
const baseUrl = flag('url', 'http://127.0.0.1:5173')

const sleep = ms => new Promise(r => setTimeout(r, ms))

function chromePath() {
  return [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome'].filter(Boolean).find(p => existsSync(p))
}

async function waitDebugger() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return await r.json() } catch { /* not up */ }
    await sleep(300)
  }
  throw new Error('调试端口未就绪')
}

class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.pending = new Map(); this.sessionId = null
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); const s = this.pending.get(m.id); if (!s) return; this.pending.delete(m.id); m.error ? s.reject(new Error(JSON.stringify(m.error))) : s.resolve(m.result) })
  }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) }); return new Cdp(ws) }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }))
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} 超时`)) }, 240000)
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? '求值失败')
    return r.result.value
  }
}

let failed = 0
function ok(name, cond, extra = '') {
  if (cond) console.log(`  ok  ${name}`)
  else { failed++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`) }
}

async function main() {
  if (!existsSync(clipPath)) { console.error(`素材不存在：${clipPath}`); process.exitCode = 1; return }
  const binary = chromePath()
  if (!binary) { console.error('找不到 Chrome'); process.exitCode = 1; return }
  const chrome = spawn(binary, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + resolve(UI_ROOT, '.eval-ui-chrome'), 'about:blank'], { stdio: 'ignore' })

  const version = await waitDebugger()
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  cdp.sessionId = sessionId
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('DOM.enable')
  // 每次从干净存储开始：Chrome profile 会跨运行保留开关与记录，否则「默认关闭」测的是上一次的残留
  await cdp.send('Page.navigate', { url: `${baseUrl}/analysis` })
  await sleep(2500)
  await cdp.evaluate(`(async () => {
    localStorage.clear();
    // 首屏引导会挡住 /analysis；验证只关心分析页，直接把引导标成已完成
    localStorage.setItem('twopoles.v1.meta', JSON.stringify({ onboardingCompleted: true }));
    const wipe = name => new Promise(res => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    await wipe('twopoles_motion_series'); await wipe('twopoles_analysis_keyframes');
    return true;
  })()`)
  await cdp.send('Page.navigate', { url: `${baseUrl}/analysis` })
  await sleep(3500)

  console.log('\nU1. 真实 /analysis 页面：选视频 → 预检 → 分析 → 结果')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  ok('页面有文件选择入口', Boolean(nodeId))
  await cdp.send('DOM.setFileInputFiles', { files: [clipPath], nodeId })

  // 等预检出结论
  const pre = await cdp.evaluate(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 240; i++) {
      const t = document.querySelector('main')?.innerText ?? '';
      if (t.includes('视频可分析') || t.includes('无法分析')) return t.slice(0, 600);
      await sleep(500);
    }
    return document.querySelector('main')?.innerText?.slice(0, 600) ?? '';
  })()`)
  const prechecked = pre.includes('视频可分析')
  ok('预检给出可分析结论', prechecked, pre.slice(0, 200))
  if (!prechecked) { console.log('  预检拒绝，后续结果页断言跳过'); cdp.ws.close(); chrome.kill(); process.exitCode = failed ? 1 : 0; return }

  // 点「开始分析」
  await cdp.evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('开始分析'));
    if (btn) btn.click();
    return Boolean(btn);
  })()`)
  const result = await cdp.evaluate(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 480; i++) {
      const t = document.querySelector('main')?.innerText ?? '';
      if (t.includes('关注项') || t.includes('测量值')) break;
      await sleep(500);
    }
    const main = document.querySelector('main');
    return {
      text: main?.innerText ?? '',
      curveCards: document.querySelectorAll('.curve-card').length,
      polylines: document.querySelectorAll('.curve-card polyline').length,
      markerDots: document.querySelectorAll('.curve-card .marker-dot').length,
      axisNote: document.querySelector('.curve-card .axis-note')?.innerText ?? '',
      confidenceRows: [...document.querySelectorAll('.finding dt')].filter(d => d.innerText === '置信').length,
      explainPanel: (main?.innerText ?? '').includes('解读'),
      engineTags: [...document.querySelectorAll('.engine-tag')].map(e => e.innerText),
      curveSwitch: document.querySelectorAll('.curve-switch .switch-chip').length,
      seriesNote: document.querySelector('.curve-note')?.innerText ?? ''
    };
  })()`)

  console.log('\nU2. 结果页：角度曲线与证据链')
  ok('渲染角度曲线卡片', result.curveCards >= 1, String(result.curveCards))
  ok('曲线有折线段', result.polylines >= 1, String(result.polylines))
  ok('曲线有关节切换', result.curveSwitch === 3, String(result.curveSwitch))
  ok('曲线带「不能说明什么」告示', result.axisNote.includes('不能据此判断关节负荷'), result.axisNote.slice(0, 80))
  ok('未开留存时明示未落盘', result.seriesNote.includes('未落盘'), result.seriesNote)

  console.log('\nU3. 结果页：置信度与解读')
  ok('解读面板存在', result.explainPanel)
  ok('解读默认标注规则原文', result.engineTags.length === 0 || result.engineTags.every(t => t === '规则原文'), JSON.stringify(result.engineTags))
  // 「不评分」是产品口号本身，不能当成评分证据；只查真正的分数表达
  ok('结果页不给分数', !/得分|总分|\d{1,3}\s*分(?!钟|\/)/.test(result.text.replace(/不评分/g, '')))

  console.log('\nU4. 切到髋角曲线')
  const hipSwitch = await cdp.evaluate(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const btn = [...document.querySelectorAll('.curve-switch .switch-chip')].find(b => b.innerText.includes('髋角'));
    if (!btn) return { clicked: false };
    btn.click(); await sleep(300);
    return { clicked: true, title: document.querySelector('.curve-card h3')?.innerText ?? '', polylines: document.querySelectorAll('.curve-card polyline').length };
  })()`)
  ok('可切换到髋角', hipSwitch.clicked && hipSwitch.title.includes('髋'), JSON.stringify(hipSwitch))

  console.log('\nU5. 历史与趋势')
  const hist = await cdp.evaluate(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('换一个视频'));
    if (btn) btn.click();
    await sleep(600);
    const main = document.querySelector('main');
    return { text: main?.innerText ?? '', trendCards: document.querySelectorAll('.trend-card').length, historyItems: document.querySelectorAll('.an-history li').length };
  })()`)
  ok('分析记录进入历史列表', hist.historyItems >= 1, String(hist.historyItems))
  ok('渲染长期趋势卡片', hist.trendCards >= 1, String(hist.trendCards))
  ok('样本不足时如实标注', hist.text.includes('样本不足') || hist.trendCards === 0)

  console.log('\nU6. 设置页：新开关默认关闭')
  await cdp.send('Page.navigate', { url: `${baseUrl}/settings` })
  await sleep(3000)
  const settings = await cdp.evaluate(`(() => {
    const labels = [...document.querySelectorAll('label.toggle')];
    const find = name => labels.find(l => l.innerText.includes(name));
    const series = find('保存动作数据');
    return {
      hasSeriesToggle: Boolean(series),
      seriesChecked: series ? series.querySelector('input')?.checked : null,
      privacyCopy: document.body.innerText.includes('画面与视频本身始终不保存')
    };
  })()`)
  ok('设置页有「保存动作数据」开关', settings.hasSeriesToggle)
  ok('该开关默认关闭', settings.seriesChecked === false, String(settings.seriesChecked))
  ok('隐私文案说明画面始终不保存', settings.privacyCopy)

  if (args.includes('--series')) {
    console.log('\nU7. 开启留存后落盘，删除记录时级联清理')
    await cdp.evaluate(`(() => {
      const label = [...document.querySelectorAll('label.toggle')].find(l => l.innerText.includes('保存动作数据'));
      const input = label?.querySelector('input');
      if (input && !input.checked) input.click();
      return input?.checked;
    })()`)
    await sleep(500)
    await cdp.send('Page.navigate', { url: `${baseUrl}/analysis` })
    await sleep(3000)
    const doc2 = await cdp.send('DOM.getDocument')
    const input2 = await cdp.send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: 'input[type=file]' })
    await cdp.send('DOM.setFileInputFiles', { files: [clipPath], nodeId: input2.nodeId })
    await cdp.evaluate(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 240; i++) { const t = document.querySelector('main')?.innerText ?? ''; if (t.includes('视频可分析') || t.includes('无法分析')) break; await sleep(500); }
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText.includes('开始分析'));
      if (btn) btn.click();
      for (let i = 0; i < 480; i++) { const t = document.querySelector('main')?.innerText ?? ''; if (t.includes('测量值')) break; await sleep(500); }
      return true;
    })()`)
    const saved = await cdp.evaluate(`(async () => {
      const open = () => new Promise((res, rej) => { const r = indexedDB.open('twopoles_motion_series', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('series')) r.result.createObjectStore('series') }; });
      const db = await open();
      const keys = await new Promise((res, rej) => { const tx = db.transaction('series', 'readonly'); const q = tx.objectStore('series').getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const rec = await new Promise((res, rej) => { const tx = db.transaction('series', 'readonly'); const q = tx.objectStore('series').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      db.close();
      return { count: keys.length, angles: rec[0]?.angles?.length ?? 0, landmarkJoints: rec[0]?.landmarks?.[0]?.points?.length ?? 0, note: document.querySelector('.curve-note')?.innerText ?? '' };
    })()`)
    ok('开启后序列落进本机 IndexedDB', saved.count >= 1, JSON.stringify(saved))
    ok('落盘记录含逐帧角度', saved.angles > 0, String(saved.angles))
    ok('落盘关键点为 16 关节并集', saved.landmarkJoints === 16, String(saved.landmarkJoints))
    ok('页面明示已保存在本机', saved.note.includes('已保存在本机'), saved.note)

    const cascade = await cdp.evaluate(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      window.confirm = () => true;
      // U7 结束时停在结果页，先回选视频页才有历史列表
      const back = [...document.querySelectorAll('button')].find(b => b.innerText.includes('换一个视频'));
      if (back) { back.click(); await sleep(900); }
      const link = document.querySelector('.an-history-link');
      if (link) { link.click(); await sleep(1500); }
      // 只断言「被删这条」的引用消失：本次运行可能已产生多条记录，别的记录的关键帧应当保留
      const targetRefs = (() => {
        try {
          const raw = JSON.parse(localStorage.getItem('twopoles.v1.analyses') ?? '[]');
          const newest = [...raw].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
          return (newest?.findings ?? []).map(f => f.keyframeRef).filter(Boolean);
        } catch { return []; }
      })();
      const del = [...document.querySelectorAll('button')].find(b => b.innerText.includes('删除这条记录'));
      if (del) { del.click(); await sleep(1500); }
      const open = () => new Promise((res, rej) => { const r = indexedDB.open('twopoles_motion_series', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await open();
      const keys = await new Promise((res, rej) => { const tx = db.transaction('series', 'readonly'); const q = tx.objectStore('series').getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      const frames = await new Promise((res, rej) => { const r = indexedDB.open('twopoles_analysis_keyframes', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('keyframes')) r.result.createObjectStore('keyframes') }; });
      const kf = await new Promise((res, rej) => { const tx = frames.transaction('keyframes', 'readonly'); const q = tx.objectStore('keyframes').getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      db.close(); frames.close();
      return { remaining: keys.length, keyframesRemaining: kf.length, targetRefs, orphaned: targetRefs.filter(r => kf.includes(r)), hadDeleteButton: Boolean(del) };
    })()`)
    ok('找到详情页删除入口', cascade.hadDeleteButton)
    if (cascade.hadDeleteButton) {
      ok('删除分析记录后动作序列被级联清理', cascade.remaining === 0, JSON.stringify(cascade))
      ok('被删记录的关键帧全部清理', cascade.orphaned.length === 0, JSON.stringify(cascade.orphaned))
    }
  }

  console.log(`\nUI 验证：失败 ${failed} 项`)
  cdp.ws.close(); chrome.kill()
  process.exitCode = failed ? 1 : 0
}

main().catch(e => { console.error(e); process.exitCode = 1 })