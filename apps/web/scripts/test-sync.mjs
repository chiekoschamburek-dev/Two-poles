import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'

await build({
  entryPoints: ['scripts/sync.test.ts'], outfile: '.sync-test.mjs', bundle: true,
  platform: 'node', format: 'esm', packages: 'external', tsconfig: 'tsconfig.json',
  define: { 'import.meta.env': JSON.stringify({ DEV: false, VITE_API_BASE_URL: 'http://twopoles.test' }) }
})
const result = spawnSync(process.execPath, ['--test', '.sync-test.mjs'], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
