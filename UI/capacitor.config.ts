import type { CapacitorConfig } from '@capacitor/cli'

/**
 * WebView 直接加载线上站点：账号同步、LLM 代理、登录态 cookie 全部复用现有部署，
 * 网页端更新后 App 无需发版。原生能力目前只有本地通知（补剂提醒）。
 */
const config: CapacitorConfig = {
  appId: 'com.twopoles.app',
  appName: '两仪',
  // App 加载的是 server.url 指向的线上站点，这里的 webDir 只做壳资源；
  // 用剔除大资源后的精简副本，安装包从 53MB 缩到 ~1MB（先 npm run build && npm run cap:prepare）
  webDir: 'dist-lite',
  server: {
    url: 'https://two-poles.bupt-empty-classrom.top',
    cleartext: false
  }
}

export default config
