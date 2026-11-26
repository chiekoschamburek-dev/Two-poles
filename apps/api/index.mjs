import { createApiServer } from './app.mjs'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const api = createApiServer()

api.server.listen(port, host, () => {
  console.log(`[twopoles-api] listening on http://${host}:${port}/api/v1`)
})

const shutdown = () => {
  api.close().finally(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
