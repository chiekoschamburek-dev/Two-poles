// 生成 App 打包用的精简 dist（dist-lite）：
// App 通过 server.url 加载线上站点，public/ 下的大资源（端侧模型、演示视频）由站点自己下发，
// 打进 APK 只会白白增大安装包（53MB → ~5MB），这里复制 dist 时剔除它们。
// 运行：npm run cap:prepare（cap sync 之前）
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'dist')
const out = join(root, 'dist-lite')

/** 打进 APK 无用的重资源目录（Vite 把 public/* 平铺到 dist 根；线上站点会正常下发） */
const EXCLUDE_TOP = ['mediapipe', 'demo-videos', 'apk']

if (!existsSync(src)) {
  console.error('dist 不存在，请先 npm run build')
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

function copyDir(from, to, rel) {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    const relNext = rel ? `${rel}/${entry}` : entry
    if (EXCLUDE_TOP.includes(relNext)) continue
    const s = join(from, entry)
    const t = join(to, entry)
    if (statSync(s).isDirectory()) copyDir(s, t, relNext)
    else cpSync(s, t)
  }
}

copyDir(src, out, '')
const size = (p) => {
  let total = 0
  for (const e of readdirSync(p, { recursive: true })) {
    const s = join(p, e)
    if (statSync(s).isFile()) total += statSync(s).size
  }
  return Math.round(total / 1024 / 102.4) / 10
}
console.log(`dist-lite 已生成：${size(out)}MB（dist ${size(src)}MB）`)
