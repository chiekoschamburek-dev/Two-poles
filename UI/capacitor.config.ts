import type { CapacitorConfig } from '@capacitor/cli'

/**
 * WebView 直接加载线上站点：账号同步、LLM 代理、登录态 cookie 全部复用现有部署，
 * 网页端更新后 App 无需发版。原生能力目前只有本地通知（补剂提醒）。
 */
const config: CapacitorConfig = {
  appId: 'com.twopoles.app',
  appName: '两仪',
  webDir: 'dist',
  server: {
    url: 'https://two-poles.bupt-empty-classrom.top',
    cleartext: false
  }
}

export default config
