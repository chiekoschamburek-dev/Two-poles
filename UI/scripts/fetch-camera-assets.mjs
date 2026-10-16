// 把 MediaPipe 的 wasm 与姿态模型复制到 public/mediapipe/，让摄像头跟练可以离线运行。
// 这些二进制被 .gitignore 排除，换新机器或重新 clone 后先跑：npm run camera:assets
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const outDir = join(root, 'public/mediapipe')
const wasmFiles = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm'
]
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
const modelBytes = 5777746
const modelOut = join(outDir, 'models/pose_landmarker_lite.task')

if (!existsSync(wasmSrc)) {
  console.error('未找到 @mediapipe/tasks-vision，请先 npm install')
  process.exit(1)
}

mkdirSync(join(outDir, 'wasm'), { recursive: true })
mkdirSync(join(outDir, 'models'), { recursive: true })

for (const f of wasmFiles) {
  const to = join(outDir, 'wasm', f)
  cpSync(join(wasmSrc, f), to)
  console.log('copied', f, (statSync(to).size / 1048576).toFixed(1), 'MB')
}

if (existsSync(modelOut) && statSync(modelOut).size === modelBytes) {
  console.log('model 已存在，跳过下载')
} else {
  console.log('downloading pose_landmarker_lite.task ...')
  const res = await fetch(modelUrl)
  if (!res.ok || !res.body) {
    console.error('模型下载失败：HTTP', res.status)
    process.exit(1)
  }
  await pipeline(res.body, createWriteStream(modelOut))
  const size = statSync(modelOut).size
  if (size !== modelBytes) {
    console.error(`模型大小不符：${size} != ${modelBytes}，请重跑本脚本`)
    process.exit(1)
  }
  console.log('downloaded model', (size / 1048576).toFixed(1), 'MB')
}

console.log('\n完成。摄像头跟练所需资源已就绪：')
console.log('  /mediapipe/wasm/            (4 个文件, ~27 MB)')
console.log('  /mediapipe/models/pose_landmarker_lite.task  (5.5 MB)')
