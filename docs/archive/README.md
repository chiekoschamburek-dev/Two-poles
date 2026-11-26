# 归档文档

这里保留历史评审、进度与交付说明，**不再维护**，只用于追溯当时的判断与数字。当前有效文档在：

- `docs/engineering/web.md`（前端）
- `docs/engineering/api.md`（服务端）
- `docs/engineering/deploy.md`（部署）
- `docs/engineering/motion-analysis-v2.md`（动作分析）
- `docs/product/`（产品设计与周计划）
- `CONTEXT.md`（领域口径）

| 文件 | 内容 | 归档原因 |
|---|---|---|
| `FRONTEND-REVIEW.md` | 早期前端评审 | 评审结论已落地，数字过期 |
| `FRONTEND-OPTIMIZATION-LOG.md` | 前端优化记录 | 已并入当前实现 |
| `PROGRESS.md` | 阶段进度与待办 | 待办已迁到计划/规格 |
| `baseline.md` | 早期基线说明 | 被 `eval:replay` 夹具取代 |
| `scan-summary.md` | 静态扫描摘要 | 一次性分析产物 |
| `subsystem-maps.md` | 子系统地图 | 结构已多次变化 |
| `交付说明.md` / `完成总结.md` / `开始使用.md` | 课程交付材料 | 内容过期，保留留档 |
| `research/` | 改版方向调研与示意图 | 决策已完成 |

> 需要查当前数字时以命令为准：`npm run selfcheck`（907 项）、`npm run test:api`（41 项）、`npm run eval:replay -- --gate`（7 条真值）。