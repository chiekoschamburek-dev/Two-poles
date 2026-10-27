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
    path: '/report',
    name: 'report',
    component: () => import('@/views/ReportView.vue'),
    meta: { title: '我的周报' }
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
