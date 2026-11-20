// 跟练页功能验证（CDP 驱动真实 Chrome + 生产构建），三个场景：
//
//   S1 计时与语音：已用时长按墙钟推进、保持倒计时递减、暂停停表、
//                  切后台回来后把时间补回、头部「结束并记录」真的落库
//   S2 组间休息：一组结束自动进入休息、休息倒计时递减、休息结束自动开始下一组
//   S3 手机 PiP：摄像头小窗不与演示栏标题/阶段徽标重叠
//
// 用法：
//   npm run build && npm run preview -- --port 4173
//   node scripts/motion-eval/verify-execution.mjs http://127.0.0.1:4173
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PORT = 9362
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find(p => existsSync(p))
if (!CHROME) throw new Error('找不到 Chrome')

const profile = `${process.env.TEMP}\\twopoles-exec-${Date.now()}`
const child = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--disable-gpu',
  '--window-size=1280,900',
  // 没有真实摄像头时给一个假设备，摄像头模式的布局才渲染得出来
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  'about:blank'
], { stdio: 'ignore' })

async function waitDebugger() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return } catch { /* 未就绪 */ }
    await sleep(300)
  }
  throw new Error('调试端口未就绪')
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.events = []
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data)
      if (m.id) {
        const s = this.pending.get(m.id)
        if (!s) return
        this.pending.delete(m.id)
        m.error ? s.reject(new Error(JSON.stringify(m.error))) : s.resolve(m.result)
      } else this.events.push(m)
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })
    return new Cdp(ws)
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} 超时`)) }, 60000)
    })
  }
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    })
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate 失败')
    return result.value
  }
}

const results = []
const check = (ok, name, detail = '') => {
  results.push({ ok, name })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 计划：本周、今天、平板支撑 2 组 × holdSeconds 秒（组间休息固定 6 秒） */
const seedPlan = holdSeconds => `(() => {
  const pad = n => String(n).padStart(2, '0')
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  const now = new Date()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const today = iso(now)
  const plan = {
    id: 'plan-verify-1', userId: 'demo-user', version: 1,
    createdAt: new Date().toISOString(), reason: '自动化验证',
    weekStartDate: iso(monday), weekEndDate: iso(sunday),
    items: [{
      id: 'item-verify-1', planId: 'plan-verify-1', date: today,
      exerciseName: '平板支撑', type: '其他',
      plannedSets: 2, plannedHoldSeconds: ${holdSeconds}, completed: false
    }]
  }
  localStorage.setItem('twopoles.v1.meta', JSON.stringify({ collapsed: [], theme: 'light', planCompletionStyle: 'highlight' }))
  localStorage.setItem('twopoles.v1.plans', JSON.stringify([plan]))
  localStorage.removeItem('twopoles.v1.sessions')
  localStorage.removeItem('twopoles_state')
  return today
})()`

const readClocks = `(() => {
  const cells = [...document.querySelectorAll('.count-strip .strip-cell')]
  return {
    elapsed: cells[2] ? cells[2].querySelector('.strip-num').textContent.trim() : null,
    primary: document.querySelector('.strip-cell.primary .strip-num')?.textContent.trim() ?? null,
    setNo: document.querySelector('.page-header h1')?.textContent.trim() ?? '',
    rest: document.querySelector('.rest-count')?.textContent.trim() ?? null,
    resting: !!document.querySelector('.rest-overlay')
  }
})()`

const secs = s => {
  if (!s) return NaN
  const m = /^(\d+):(\d+)$/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

const clickByText = text => `(async () => {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes(${JSON.stringify(text)}))
  if (!btn) return false
  btn.click()
  await new Promise(r => setTimeout(r, 700))
  return true
})()`

try {
  await waitDebugger()
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    if (!target) await sleep(300)
  }
  const page = await Cdp.connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')

  // 先打开站点取得同源 localStorage，再写入测试计划
  await page.send('Page.navigate', { url: BASE })
  await sleep(1800)
  const today = await page.evaluate(seedPlan(5))

  // ——— S1 计时与语音 ———
  console.log('\nS1 计时与语音（墙钟 / 暂停 / 切后台 / 结束并记录）')
  await page.send('Page.navigate', { url: `${BASE}/execution?planDate=${today}` })
  await sleep(2200)
  check(await page.evaluate(clickByText('计时与语音')), '进入「计时与语音」跟练')

  const t0 = await page.evaluate(readClocks)
  await sleep(2300)
  const t1 = await page.evaluate(readClocks)
  const d0 = secs(t0.elapsed), d1 = secs(t1.elapsed)
  check(Number.isFinite(d0) && Number.isFinite(d1), '已用时长可读', `${t0.elapsed} → ${t1.elapsed}`)
  check(d1 - d0 >= 2 && d1 - d0 <= 4, '已用时长按真实时间推进（A1）', `${d0}s → ${d1}s`)
  const hold0 = Number((t0.primary || '').replace(/[^\d]/g, ''))
  const hold1 = Number((t1.primary || '').replace(/[^\d]/g, ''))
  check(Number.isFinite(hold0) && Number.isFinite(hold1) && hold1 <= hold0, '保持倒计时在递减', `${hold0} → ${hold1}`)

  const paused0 = await page.evaluate(`(async () => {
    const btn = document.querySelector('.stage-controls .ctrl-btn[aria-label="暂停"]')
    if (!btn) return { ok: false }
    btn.click()
    await new Promise(r => setTimeout(r, 300))
    const cells = [...document.querySelectorAll('.count-strip .strip-cell')]
    return { ok: true, elapsed: cells[2].querySelector('.strip-num').textContent.trim() }
  })()`)
  check(paused0.ok, '点击暂停')
  await sleep(1600)
  const paused1 = await page.evaluate(readClocks)
  check(paused0.ok && paused1.elapsed === paused0.elapsed, '暂停期间已用时长不再增长（A1）', `${paused0.elapsed} → ${paused1.elapsed}`)

  check(await page.evaluate(`(async () => {
    document.querySelector('.stage-controls .ctrl-btn[aria-label="继续"]')?.click()
    await new Promise(r => setTimeout(r, 400))
    return true
  })()`), '点击继续')

  const beforeHide = await page.evaluate(readClocks)
  await page.evaluate(`(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise(r => setTimeout(r, 3000))
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise(r => setTimeout(r, 350))
  })()`)
  const afterHide = await page.evaluate(readClocks)
  const b = secs(beforeHide.elapsed), a = secs(afterHide.elapsed)
  check(a - b >= 2 && a - b <= 5, '切后台 3 秒回来后时长被补回（A1）', `${beforeHide.elapsed} → ${afterHide.elapsed}`)

  const headerLabel = await page.evaluate(`document.querySelector('.page-header button')?.textContent.trim() ?? ''`)
  check(/结束并记录/.test(headerLabel), '头部按钮为「结束并记录」（A2）', headerLabel)

  const finished = await page.evaluate(`(async () => {
    const btn = [...document.querySelectorAll('.page-header button')].find(x => x.textContent.trim().includes('结束并记录'))
    if (!btn) return { ok: false }
    btn.click()
    await new Promise(r => setTimeout(r, 1200))
    const raw = localStorage.getItem('twopoles.v1.sessions')
    const sessions = raw ? JSON.parse(raw) : []
    return {
      ok: true, count: sessions.length,
      actualDuration: sessions[0]?.actualDuration ?? null,
      summary: document.querySelector('.actions-card.summary h3')?.textContent.trim() ?? ''
    }
  })()`)
  check(finished.ok && finished.count === 1, '头部「结束并记录」落库一条（A2）', JSON.stringify(finished))
  check(typeof finished.actualDuration === 'number' && finished.actualDuration > 0, '记录里的时长为正数', String(finished.actualDuration))
  check(/跟练已结束/.test(finished.summary), '结果卡片正常展示', finished.summary)

  // ——— S2 组间休息 ———
  console.log('\nS2 组间休息（自动休息 / 倒计时 / 自动进入下一组）')
  await page.evaluate(seedPlan(3))
  await page.send('Page.navigate', { url: `${BASE}/execution?planDate=${today}` })
  await sleep(2200)
  check(await page.evaluate(clickByText('计时与语音')), '重新进入跟练')

  await sleep(4200)
  const rest0 = await page.evaluate(readClocks)
  check(rest0.resting, '一组结束后进入组间休息', JSON.stringify(rest0))
  const rest0s = Number((rest0.rest || '').replace(/[^\d]/g, ''))
  check(Number.isFinite(rest0s) && rest0s > 0 && rest0s <= 6, '休息倒计时初值合理', String(rest0s))

  await sleep(2200)
  const rest1 = await page.evaluate(readClocks)
  const rest1s = Number((rest1.rest || '').replace(/[^\d]/g, ''))
  check(rest1.resting && rest1s < rest0s, '休息倒计时按真实时间递减', `${rest0s} → ${rest1s}`)

  // 等休息结束（6 秒）自动开始第 2 组
  await sleep(4500)
  const set2 = await page.evaluate(readClocks)
  check(!set2.resting && /第 2 组/.test(set2.setNo), '休息结束自动开始第 2 组', JSON.stringify(set2))
  const elapsed2 = secs(set2.elapsed)
  check(Number.isFinite(elapsed2) && elapsed2 >= 8, '切到第 2 组后已用时长连续（含休息）', `${set2.elapsed}`)

  // ——— S3 手机 PiP 布局 ———
  console.log('\nS3 手机 PiP（与演示栏标题、阶段徽标不重叠）')
  await page.evaluate(seedPlan(30))
  await page.send('Page.navigate', { url: `${BASE}/execution?planDate=${today}` })
  await sleep(2200)
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true
  })
  await sleep(400)
  check(await page.evaluate(clickByText('摄像头跟练')), '进入「摄像头跟练」')
  await sleep(1800)

  const layout = await page.evaluate(`(() => {
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } }
    const overlap = (a, b) => !a || !b ? 0 : Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
    const pip = rect(document.querySelector('.pane-cam'))
    const title = rect(document.querySelector('.pane-demo .pane-title'))
    const note = rect(document.querySelector('.pane-demo .pane-note'))
    const badges = [...document.querySelectorAll('.pane-demo .stage-overlay > *')].map(rect)
    const count = rect(document.querySelector('.pane-demo .demo-video-count'))
    const live = rect(document.querySelector('.pane-demo .stage-live'))
    return {
      pip, title, note, count, live,
      pipWidth: pip ? pip.w : 0,
      overlapTitle: overlap(pip, title),
      overlapNote: overlap(pip, note),
      overlapBadges: badges.reduce((sum, r) => sum + overlap(pip, r), 0),
      badgeCount: badges.length,
      // 演示画面内的浮层之间也不能互相压住（手机端曾经 count 压住第二颗徽标）
      overlapCountBadges: badges.reduce((sum, r) => sum + overlap(count, r), 0),
      overlapCountLive: overlap(count, live),
      overlapCountPip: overlap(count, pip)
    }
  })()`)
  check(!!layout.pip && layout.pipWidth > 80 && layout.pipWidth < 200, 'PiP 小窗已渲染', JSON.stringify(layout.pip))
  // 表头右内距必须让出小窗宽度：文字右边界要落在小窗左边界左侧，才是"真的没被压住"
  check(layout.title && layout.pip && layout.title.r <= layout.pip.l,
    'PiP 不遮挡演示栏标题（B8）', `title.right=${layout.title?.r} ≤ pip.left=${layout.pip?.l}，overlap=${layout.overlapTitle}px²`)
  check(layout.note && layout.pip && layout.note.r <= layout.pip.l,
    'PiP 不遮挡演示栏说明（B8）', `note.right=${layout.note?.r} ≤ pip.left=${layout.pip?.l}，overlap=${layout.overlapNote}px²`)
  check(layout.badgeCount === 0 || layout.overlapBadges === 0, 'PiP 不遮挡阶段徽标（B8）', `overlap=${layout.overlapBadges}px² / ${layout.badgeCount} 个徽标`)
  check(layout.overlapCountBadges === 0, '倒计时浮层不压住阶段徽标（B8 同族）', `overlap=${layout.overlapCountBadges}px²`)
  check(layout.overlapCountLive === 0, '倒计时浮层不压住底部提示条', `overlap=${layout.overlapCountLive}px²`)
  check(layout.overlapCountPip === 0, '倒计时浮层不压住 PiP', `overlap=${layout.overlapCountPip}px²`)

  // 超窄屏（320 px，WCAG 1.4.10 的最小宽度）再确认一次表头让位仍然成立
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 320, height: 640, deviceScaleFactor: 2, mobile: true
  })
  await sleep(500)
  const narrow = await page.evaluate(`(() => {
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width) } }
    const pip = rect(document.querySelector('.pane-cam'))
    const title = rect(document.querySelector('.pane-demo .pane-title'))
    const note = rect(document.querySelector('.pane-demo .pane-note'))
    return { pip, title, note, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }
  })()`)
  check(narrow.title && narrow.pip && narrow.title.r <= narrow.pip.l,
    '320 px 下 PiP 仍不遮挡标题（B8）', `title.right=${narrow.title?.r} ≤ pip.left=${narrow.pip?.l}`)
  check(narrow.note && narrow.pip && narrow.note.r <= narrow.pip.l,
    '320 px 下 PiP 仍不遮挡说明（B8）', `note.right=${narrow.note?.r} ≤ pip.left=${narrow.pip?.l}`)
  check(narrow.scrollW <= narrow.clientW + 1, '320 px 下无横向溢出（WCAG 1.4.10）', `scroll=${narrow.scrollW} client=${narrow.clientW}`)

  const errors = page.events.filter(e => e.method === 'Runtime.exceptionThrown')
  check(errors.length === 0, '无未捕获异常', errors.map(e => e.params?.exceptionDetails?.text).join(' | '))
} finally {
  child.kill()
}

const failed = results.filter(r => !r.ok)
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`)
process.exit(failed.length ? 1 : 0)