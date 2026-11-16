/**
 * 站点落款信息（页脚用）。
 *
 * ICP 备案号必须与工信部备案系统里登记的**完全一致**，包括省份简称、主体序号后缀（如 -1）。
 * 换域名、换主体或补办公安备案时，只改这个文件即可，组件不用动。
 */

export interface BeianEntry {
  /** 备案号原文；留空则页脚不渲染这一项 */
  number: string
  /** 备案号点击跳转的官方查询地址 */
  href: string
}

export const SITE_INFO = {
  /** 页脚版权行显示的名字 */
  name: '两仪 TwoPoles',
  /** ICP 备案号：形如「京ICP备2024012345号-1」 */
  icp: {
    number: '京ICP备2026019440号-1',
    href: 'https://beian.miit.gov.cn/'
  } as BeianEntry,
  /**
   * 公安联网备案号：形如「京公网安备 11010502012345号」。
   * 官方要求带备案图标，图标版等拿到 badge 图再补；当前只做文字链接。
   */
  police: {
    number: '',
    href: 'https://beian.mps.gov.cn/'
  } as BeianEntry
} as const
