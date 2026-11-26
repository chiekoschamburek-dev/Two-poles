import { createApiServer } from './http/app.mjs'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'

let api
try {
  api = createApiServer()
} catch (error) {
  console.error(`[twopoles-api] 启动失败：${error?.message ?? error}`)
  process.exit(1)
}

api.server.listen(port, host, () => {
  console.log(`[twopoles-api] listening on http://${host}:${port}/api/v1`)
})

const shutdown = () => {
  api.close().finally(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)