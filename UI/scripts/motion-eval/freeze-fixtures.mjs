// 把当前 baseline/*.series.json 冻结成评测夹具（fixtures/），并写 manifest 记录哈希。
//
// 为什么需要它：eval:motion 每次都会重采样逐帧序列，同一条素材换姿态后端/换一次运行就可能
// 采到不同 landmarks，replay 门禁会随之漂移。replay 只读 fixtures/，要刷新必须显式运行本脚本
// （或 eval:motion --recapture 后重跑本脚本），这样"改动算法"和"改动评测数据"永远是两次可审计的动作。
//
// 序列本身不进仓库（体积原因，见 .gitignore）；manifest.json 进仓库，用来校验夹具没有被篡改。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const UI_ROOT = resolve(import.meta.dirname, '../..')
const BASELINE = resolve(UI_ROOT, 'scripts/motion-eval/baseline')
const FIXTURES = resolve(UI_ROOT, 'scripts/motion-eval/fixtures')
const MANIFEST = resolve(FIXTURES, 'manifest.json')

const clips = existsSync(BASELINE)
  ? readdirSync(BASELINE).filter(file => file.endsWith('.series.json')).sort()
  : []
if (!clips.length) {
  console.error('baseline/ 下没有 .series.json，先跑 npm run eval:motion -- --recapture 采样')
  process.exit(1)
}

mkdirSync(FIXTURES, { recursive: true })
const entries = clips.map(file => {
  const source = resolve(BASELINE, file)
  const bytes = readFileSync(source)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(resolve(FIXTURES, file), bytes)
  const parsed = JSON.parse(bytes.toString('utf8'))
  return {
    clip: file.replace(/\.series\.json$/, ''),
    file,
    sha256,
    bytes: bytes.length,
    fps: parsed.fps ?? null,
    capturedAt: parsed.capturedAt ?? null,
    frameCount: Array.isArray(parsed.frames) ? parsed.frames.length : null
  }
})
writeFileSync(MANIFEST, JSON.stringify({
  schemaVersion: 1,
  frozenAt: new Date().toISOString(),
  note: 'replay 只读 fixtures/；刷新夹具必须显式重跑 freeze-fixtures，保证评测数据变更可审计',
  clips: entries
}, null, 2))
console.log(`已冻结 ${entries.length} 条夹具 -> ${FIXTURES}`)
for (const entry of entries) console.log(`  ${entry.clip.padEnd(20)} ${entry.sha256.slice(0, 12)} ${entry.frameCount ?? '?'} 帧`)