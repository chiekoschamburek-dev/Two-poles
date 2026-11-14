// 生成 PWA 图标：通用图标直接栅格化 favicon.svg（圆角徽章、四角透明）；
// maskable 与 apple-touch-icon 用同色实底（#14384D）加内容居中缩放，
// 避免系统裁成圆形/圆角时把靠近边缘的图形切掉。
// 产物已提交进仓库，部署不需要跑本脚本；仅在本机更换品牌资源后重新生成：npm run icons:generate
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'public/favicon.svg')
const outDir = join(root, 'public')

/** 徽章内圆角矩形与描边同色，实底上叠加即可无缝融合；scale 是内容占画布边长的比例 */
const BRAND_BG = '#14384D'

async function renderBadge(size) {
  // librsvg 默认按 72dpi 解析 SVG，显式给足密度保证大尺寸不失真
  return sharp(source, { density: 72 * (size / 64) }).resize(size, size).png().toBuffer()
}

async function writeSolid(size, scale, file) {
  const inner = Math.round(size * scale)
  const offset = Math.round((size - inner) / 2)
  const badge = await renderBadge(inner)
  await sharp({
    create: { width: size, height: size, channels: 4, background: BRAND_BG }
  })
    .composite([{ input: badge, left: offset, top: offset }])
    .png()
    .toFile(join(outDir, file))
}

async function writeBadge(size, file) {
  await sharp(source, { density: 72 * (size / 64) }).resize(size, size).png().toFile(join(outDir, file))
}

// 通用图标（purpose any）：徽章原样，圆角外留透明
await writeBadge(192, 'pwa-192.png')
await writeBadge(512, 'pwa-512.png')

// maskable：内容收到安全区（直径 ~66% 的圆形裁切范围内）
await writeSolid(192, 0.68, 'pwa-maskable-192.png')
await writeSolid(512, 0.68, 'pwa-maskable-512.png')

// iOS 主屏图标：iOS 自己做圆角裁切，给全出血实底方形
await writeSolid(180, 0.78, 'apple-touch-icon.png')

console.log('PWA 图标已生成到 public/：pwa-192/512.png、pwa-maskable-192/512.png、apple-touch-icon.png')
