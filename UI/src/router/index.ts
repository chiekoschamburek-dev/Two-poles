import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'poles',
    component: () => import('@/views/TwoPolesView.vue'),
    // workspace: 外壳让主区吃满视口、自己处理滚动；双极工作台不参与整页滚动
    meta: { title: '今日两仪', workspace: true }
  },
  {
    path: '/movement',
    name: 'movement',
    component: () => import('@/views/TwoPolesView.vue'),
    // 手机单极页；桌面访问仍渲染双极同屏
    meta: { title: '运动', workspace: true, pole: 'movement' }
  },
  {
    path: '/nutrition',
    name: 'nutrition',
    component: () => import('@/views/TwoPolesView.vue'),
    meta: { title: '饮食', workspace: true, pole: 'nutrition' }
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('@/views/OnboardingView.vue'),
    meta: { title: '个人档案' }
  },
  {
    // 旧地址保留跳转，书签与历史记录不会落到 404
    path: '/dashboard',
    redirect: '/'
  },
  {
    path: '/plan',
    name: 'plan',
    component: () => import('@/views/PlanView.vue'),
    meta: { title: '训练计划' }
  },
  {
    path: '/execution',
    name: 'execution',
    component: () => import('@/views/ExecutionView.vue'),
    meta: { title: '摄像头跟练' }
  },
  {
    path: '/meals',
    name: 'meals',
    component: () => import('@/views/MealsView.vue'),
    meta: { title: '饮食记录' }
  },
  {
    path: '/analysis',
    name: 'analysis',
    component: () => import('@/views/AnalysisView.vue'),
    meta: { title: '动作分析' }
  },
  {
    path: '/analysis/:id',
    name: 'analysis-detail',
    component: () => import('@/views/AnalysisDetailView.vue'),
    meta: { title: '分析详情' }
  },
  {
    path: '/report',
    name: 'report',
    component: () => import('@/views/ReportView.vue'),
    meta: { title: '记录报告' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: '个人设置' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }
    return { top: 0 }
  }
})

// Update document title based on route
router.afterEach((to) => {
  const title = to.meta.title as string
  if (title) {
    document.title = `${title} - 两仪·TwoPoles`
  } else {
    document.title = '两仪·TwoPoles'
  }
})

export default router
