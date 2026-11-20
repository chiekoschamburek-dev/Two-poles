// 生产构建冒烟测试：验证应用能启动、SPA 路由切换后焦点落到主区、aria-live 播报页面名、
// 触屏目标尺寸与滚动留白、减少动态效果下的动画开关，以及控制台无报错。
// 用法：npm run build && npm run preview -- --port 4173
//       node scripts/motion-eval/verify-web.mjs http://127.0.0.1:4173
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PORT = 9361
const BASE = process.argv[2] ?? 'http://127.0.0.1:4173'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].filter(Boolean).find(p => existsSync(p))
if (!CHROME) throw new Error('找不到 Chrome')

const profile = `${process.env.TEMP}\\twopoles-smoke-${Date.now()}`
const child = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--disable-gpu',
  '--window-size=1280,900',
  'about:blank'
], { stdio: 'ignore' })

async function waitDebugger() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return await r.json()
    } catch { /* 未就绪 */ }
    await sleep(300)
  }
  throw new Error('调试端口未就绪')
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.seq = 0; this.pending = new Map(); this.sessionId = null
    this.events = []
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data)
      if (m.id) {
        const s = this.pending.get(m.id)
        if (!s) return
        this.pending.delete(m.id)
        m.error ? s.reject(new Error(JSON.stringify(m.error))) : s.resolve(m.result)
      } else {
        this.events.push(m)
      }
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
      this.ws.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }))
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
  close() { try { this.ws.close() } catch { /* 忽略 */ } }
}

const results = []
const check = (ok, name, detail = '') => {
  results.push({ ok, name, detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

try {
  await waitDebugger()
  // 必须连到 page 目标（浏览器级 target 不支持 Page 域）
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
    if (!target) await sleep(300)
  }
  if (!target) throw new Error('找不到 page target')
  const page = await Cdp.connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Log.enable')

  await page.send('Page.navigate', { url: BASE })
  await sleep(2500)

  const booted = await page.evaluate(`(() => {
    const app = document.querySelector('#app')
    return { children: app ? app.children.length : 0, hasShell: !!document.querySelector('.shell') }
  })()`)
  check(booted.hasShell && booted.children > 0, '应用挂载（.shell 存在）', JSON.stringify(booted))

  const theme = await page.evaluate(`document.documentElement.dataset.theme || ''`)
  check(theme === 'light' || theme === 'dark', '首帧主题已落 DOM', theme)

  // SPA 路由切换：点侧栏/底栏里指向记录报告的链接
  const nav = await page.evaluate(`(async () => {
    const link = [...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/report')
    if (!link) return { clicked: false }
    link.click()
    await new Promise(r => setTimeout(r, 900))
    const main = document.querySelector('main')
    return {
      clicked: true,
      path: location.pathname,
      activeTag: document.activeElement ? document.activeElement.tagName : null,
      activeIsMain: document.activeElement === main,
      announcement: (document.querySelector('[aria-live="polite"].visually-hidden') || {}).textContent || '',
      title: document.title,
      mainTabIndex: main ? main.getAttribute('tabindex') : null
    }
  })()`)
  check(nav.clicked && nav.path === '/report', '路由切换到 /report', JSON.stringify(nav))
  check(nav.activeIsMain === true, '切换后焦点落到 main（B6）', JSON.stringify(nav))
  check(nav.mainTabIndex === '-1', 'main 带 tabindex=-1', String(nav.mainTabIndex))
  check(/记录报告/.test(nav.title || ''), '文档标题已更新', nav.title)
  check(/记录报告/.test(nav.announcement || ''), 'aria-live 播报了页面名（B6）', nav.announcement)

  // 滚动留白（B7）：手机档下应有非零的 scroll-padding-bottom
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true
  })
  await sleep(400)
  const mobile = await page.evaluate(`(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      scrollPadBottom: cs.scrollPaddingBottom,
      targetSize: getComputedStyle(document.documentElement).getPropertyValue('--target-size').trim(),
      coarse: matchMedia('(pointer: coarse)').matches
    }
  })()`)
  const pad = parseFloat(mobile.scrollPadBottom)
  check(Number.isFinite(pad) && pad >= 60, '手机档 scroll-padding-bottom 已生效（B7）', JSON.stringify(mobile))

  // 构建产物里 CSS 动效仍然存在（C7 只在 reduce 时关闭）
  const motion = await page.evaluate(`(() => {
    const el = document.createElement('div')
    el.className = 'animate-slide-in-up'
    document.body.appendChild(el)
    const name = getComputedStyle(el).animationName
    el.remove()
    return name
  })()`)
  check(motion === 'slideInUp', '默认（无 reduce）入场动画仍在', motion)
  console.log(`      --target-size = ${mobile.targetSize}（pointer: coarse = ${mobile.coarse}）`)

  // 真触屏设备上 --target-size 应抬到 44px
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await sleep(300)
  const coarse = await page.evaluate(`({
    coarse: matchMedia('(pointer: coarse)').matches,
    target: getComputedStyle(document.documentElement).getPropertyValue('--target-size').trim()
  })`)
  check(coarse.coarse && coarse.target === '44px', '触屏档 --target-size = 44px（B7）', JSON.stringify(coarse))
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })

  // C7：开启"减少动态效果"后，入场动画应完全不声明
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  await sleep(250)
  const reduced = await page.evaluate(`(() => {
    const el = document.createElement('div')
    el.className = 'animate-slide-in-up gradient-shimmer'
    document.body.appendChild(el)
    const after = getComputedStyle(el, '::after')
    const out = { name: getComputedStyle(el).animationName, shimmer: after.animationName }
    el.remove()
    return out
  })()`)
  check(reduced.name === 'none', 'reduce 时入场动画关闭（C7）', JSON.stringify(reduced))
  check(reduced.shimmer === 'none', 'reduce 时扫光动画关闭（C7）', JSON.stringify(reduced))

  const errors = page.events
    .filter(e => e.method === 'Runtime.exceptionThrown')
    .map(e => e.params?.exceptionDetails?.text ?? 'error')
  check(errors.length === 0, '无未捕获异常', errors.join(' | '))

  const consoleErrors = page.events
    .filter(e => e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error')
    .map(e => e.params.entry.text)
  check(consoleErrors.length === 0, '无 console error', consoleErrors.slice(0, 3).join(' | '))

  page.close()
} finally {
  child.kill()
}

const failed = results.filter(r => !r.ok)
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`)
process.exit(failed.length ? 1 : 0)