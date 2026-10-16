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
const models = [
  {
    name: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    bytes: 5777746
  },
  {
    name: 'efficientdet_lite0.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
    bytes: 7254339
  }
]

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

for (const model of models) {
  const dest = join(outDir, 'models', model.name)
  if (existsSync(dest) && statSync(dest).size === model.bytes) {
    console.log('已有', model.name)
    continue
  }
  console.log('downloading', model.name, '...')
  const res = await fetch(model.url)
  if (!res.ok || !res.body) {
    console.error('模型下载失败：', model.name, 'HTTP', res.status)
    process.exit(1)
  }
  await pipeline(res.body, createWriteStream(dest))
  const size = statSync(dest).size
  if (size !== model.bytes) {
    console.error(`${model.name} 大小不符：${size} != ${model.bytes}，请重跑本脚本`)
    process.exit(1)
  }
  console.log('downloaded', model.name, (size / 1048576).toFixed(1), 'MB')
}

console.log('\n完成。端侧推理资源已就绪：')
console.log('  /mediapipe/wasm/                     (4 个文件, ~27 MB)')
for (const model of models) {
  console.log(`  /mediapipe/models/${model.name}  (${(model.bytes / 1048576).toFixed(1)} MB)`)
}
