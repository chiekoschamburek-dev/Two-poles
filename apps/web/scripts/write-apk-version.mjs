// 把仓库里的 APK 与其版本号落成一份清单，供 App 自检是否有新版。
// 单独成步是为了让「网页已更新、装包还是旧的」这种情况在下次启动时能被 App 自己发现。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const gradlePath = join(root, 'android/app/build.gradle')
const apkPath = join(root, 'public/apk/twopoles-debug.apk')
const outPath = join(root, 'public/apk/version.json')

if (!existsSync(apkPath)) {
  console.warn('[apk-version] 没有找到 public/apk/twopoles-debug.apk，跳过清单生成')
  process.exit(0)
}

const gradle = readFileSync(gradlePath, 'utf8')
const versionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1] ?? 0)
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1] ?? ''

if (!versionCode) {
  console.error('[apk-version] 无法从 android/app/build.gradle 读取 versionCode')
  process.exit(1)
}

const bytes = readFileSync(apkPath)
const sha256 = createHash('sha256').update(bytes).digest('hex').toUpperCase()

const manifest = {
  versionCode,
  versionName,
  size: bytes.length,
  sha256,
  url: '/apk/twopoles-debug.apk'
}

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`[apk-version] ${versionName} (${versionCode}) · ${(bytes.length / 1024 / 1024).toFixed(2)}MB · ${sha256.slice(0, 12)}…`)