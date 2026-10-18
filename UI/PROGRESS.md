# 两仪·TwoPoles 前端 UI 实现进展

> **本文件于 2026-10-18 整体重写。**
> 原版本是开工前的规划清单（"优先级 1：布局组件"、"Glassmorphism / 渐变色方案"、"组件库 0%"），
> 这些东西既已全部实现，也已经被推翻——玻璃态与多色渐变在第十一轮就被移除了。
> 需要看每一轮为什么改、怎么改，见 `交付说明.md` 的修订记录；本文件只回答"现在是什么状态"。

## 一句话状态

7 个页面全部有实际界面，并已完成 UI 3.0「编辑式仪表盘」的整体重排：令牌 → 导航壳 → 组件层 → 六个页面版式 → 计划页收尾。
`npm run typecheck`、`npm run build`、`npm run selfcheck`（92 项）当前全部通过；生产产物已重建在 `UI/dist`。

## 页面

| 路由 | 页面 | 状态 |
|---|---|---|
| `/onboarding` | 个人档案 | 完成（三步建档，写回 profile） |
| `/dashboard` | 今日概览 | 完成，3.0 重排：标题即动作 + 纵向时间轴 + 双极仪表 + 底部账本 |
| `/plan` | 训练计划 | 完成，3.0 收尾：日历 + 当日详情两栏、账本行、`align-items:start` |
| `/execution` | 摄像头跟练 | 完成（演示回放 + 实时摄像头）；取景框里是**人体剪影 + 姿态骨线**：弯举时前臂绕肘旋转、坐站时以脚为支点整体下蹲 |
| `/meals` | 饮食记录 | 完成，3.0 重排：指标条 + 三张记录单 + 常吃一键填表 |
| `/report` | 我的周报 | 完成，3.0 重排：指标条 + 每日负荷图 + 类别点阵 + 账本表 |
| `/settings` | 个人设置 | 完成（模式 / 隐私 / 外观 / 导出 / 清除），仅随令牌换肤 |

## 设计系统（UI 3.0）

- **令牌**：`src/styles/tokens.css`。纸面 `#f2f1ec`、墨 `#11161a`、单一强调色 `#0f766e`、第二极 `#24586f`；
  圆角 6/8/10/12/16；三档发丝线；`--font-num`（Bahnschrift）；`--card-pad` 内距变量；
  `--sidebar-width: 86px`、`--topbar-height: 58px`；深色主题整组覆盖同名令牌，组件零感知。
- **原子**：`.micro`（10px + `.17em` 大写小标签）、`.num`（等宽数字）、`.hairline`。
- **表面只有两种**：纸面（`BaseCard default/flush`）与仪表面（`BaseCard variant="ink"`）。
- **组件**：`BaseButton`（主按钮深墨）、`BaseCard`（三表面）、`StatusBadge`（形状 + 文字双编码）、
  `InsightCard`（可收起）、`ToastRegion`、`TwoPoleDial`（双极环）、`StatStrip`（指标条）、`ShapeState`（三态形状）。
- **外壳**：86px 图标脊（窄屏变抽屉）+ 58px 纸面页头 + 浮动胶囊底栏。

## 服务层

`planRules`（按档案生成，条件无解时如实返回冲突）、`mealRules`（类别覆盖 / 完整度 / 常吃 / 免责清单）、
`weekRules`（周报聚合，缺 RPE 不计入而不是补 0）、`foodComposition`（56 条目录 + 单位↔克数换算）、
`exercises`（动作库 + 场地/器材/限制过滤）、`demoCameraService`（按组时间线 + `summarizeSession`）。

## 质量门

| 检查 | 现状 |
|---|---|
| `npm run typecheck`（vue-tsc --noEmit） | 通过，零报错 |
| `npm run selfcheck` | 92 项全过 / 0 失败 |
| `npm run build` | exit 0；entry `62.4 kB` + `5.7 kB` gzip；`vite preview` 截图与 dev 逐像素一致 |
| 静态外观 | `redesign-shots/ui/*.png`（1440 / 1024 / 390 / 深色），另有 `before/` 与 `ui-step01/` 做对比 |
| 真机摄像头 | **未测**，只有演示回放 |

## 已知欠账

1. **跟练页识别-计数仍未联动**：实时模式能跑 MediaPipe、能画骨架与角度，但计数仍由预设时间线推进（界面已写明）。
2. **`MetricCard.vue` 是待删空壳**：UI 3.0 后无调用方，构建产物里也不再有它的 chunk；本机删除受文件权限限制，`git rm` 一次即可。
3. **`UI/README.md`、`UI/完成总结.md`、`UI/开始使用.md` 未逐句校对**，可能仍残留 2.x 的视觉描述。
4. **没有 ESLint / Prettier 配置**（历史上被误写过"ESLint 就绪"）。
5. **真机与键盘可达性未系统验证**：布局层有 ARIA，页面层的键盘路径没有逐个点过。

## 怎么跑

```bash
cd UI
npm run dev             # http://127.0.0.1:5173
npm run typecheck       # vue-tsc --noEmit
npm run selfcheck       # 92 项领域逻辑断言
npm run build           # 产物在 UI/dist
npm run camera:assets   # 首次跑实时摄像头前需要，生成 mediapipe 端侧资产
```
