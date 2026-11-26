# 两仪 · TwoPoles

运动与饮食双极协同 App：左侧运动、右侧饮食，底部做同期对照；本机优先（离线可用），可选账号同步。
前端 Vue 3 + Pinia + Vite，端侧姿态识别用 MediaPipe；服务端 Node 24 + 内置 SQLite。

## 目录

```
.
├─ apps/
│  ├─ web/                 # 前端（Vue 3 + Vite + Capacitor 安卓壳）
│  │  ├─ src/              # 页面、组件、组合式函数、领域服务
│  │  ├─ public/           # PWA 资源、端侧模型资产、演示视频、APK 下载文件
│  │  ├─ scripts/          # 构建/图标/APK 清单 + 动作评测（motion-eval）
│  │  ├─ eval/             # 真值标注工具页（人工点关节取参考角）
│  │  └─ android/          # Capacitor 原生工程（与 web 同根，cap sync 依赖此布局）
│  └─ api/                 # 服务端（Node 24 + node:sqlite，无第三方依赖）
│     ├─ http/             # createApiServer、路由与序列化
│     ├─ db/               # schema、幂等迁移、事务；本地 SQLite 数据在 db 运行期生成
│     ├─ llm.js            # 阿里云 ESA 边缘函数入口（/api/llm/* 代理）
│     ├─ auth.mjs / report.mjs / export-worker.mjs
│     └─ api.test.mjs      # 端到端测试（内存 SQLite）
├─ docs/
│  ├─ product/             # 设计文档、周计划（plan.md）
│  ├─ engineering/         # 前端说明、API 说明、部署、动作分析 v2 口径
│  ├─ adr/  specs/         # 架构决策记录与规格
│  └─ archive/             # 历史评审/进度/交付说明（不再维护，只作留档）
├─ assets/                 # 品牌与文档配图
├─ tools/                  # 一次性/本机脚本（评审工具、系统诊断）
├─ testdata/               # 测试素材（不入库）
├─ esa.jsonc               # 阿里云 ESA Pages 部署配置
└─ CONTEXT.md              # 领域口径与术语（先读这个再读代码）
```

## 快速开始

```bash
npm run dev            # 前端 http://127.0.0.1:5173
npm run test:api       # 服务端 41 项测试（内存 SQLite）
cd apps/api && npm start   # 账号/同步服务 http://127.0.0.1:8787/api/v1（可选）
```

前端默认纯本机模式；要启用账号与同步，用 `VITE_API_BASE_URL=same-origin npm run dev`。
端侧姿态模型资产不在仓库里，首次需要 `cd apps/web && npm run camera:assets`。

## 检查

```bash
npm run check    # typecheck → selfcheck（907 项纯逻辑断言）→ API 测试 → 动作评测门禁 → 构建
```

单项：

| 命令 | 内容 |
|---|---|
| `npm run typecheck` | vue-tsc 类型检查 |
| `npm run selfcheck` | 907 项领域/规则/存储断言 |
| `npm run test:api` | 服务端端到端测试（41 项） |
| `npm run eval:replay -- --gate` | 7 条真实素材的动作评测（真值对齐 + sha256 夹具校验） |
| `npm run build` | 生产构建（含 APK 版本清单生成） |

## 部署

- **前端**：push `main` 后阿里云 ESA Pages 自动构建发布（配置见 `esa.jsonc`，产物 `apps/web/dist`，边缘函数 `apps/api/llm.js`）。详见 [部署说明](docs/engineering/deploy.md)。
- **服务端**：ESA 不更新 Node API，改动 `apps/api/*` 后需单独部署到 `8.160.176.215`（步骤见同一份部署说明）。

## 文档导航

| 想了解 | 看这里 |
|---|---|
| 领域口径（双极、模式、同步、动作分析边界） | [CONTEXT.md](CONTEXT.md) |
| 前端架构与页面 | [docs/engineering/web.md](docs/engineering/web.md) |
| 服务端接口与环境变量 | [docs/engineering/api.md](docs/engineering/api.md) |
| 部署（ESA + 主机） | [docs/engineering/deploy.md](docs/engineering/deploy.md) |
| 动作分析引擎 v2 与真值口径 | [docs/engineering/motion-analysis-v2.md](docs/engineering/motion-analysis-v2.md) |
| 架构决策 | [docs/adr/](docs/adr/) |
| 产品设计 / 周计划 | [docs/product/](docs/product/) |

## 已知边界

- 动作分析是**本机 2D 单目测量**，不评分、不替代专业评估；真值标注为 provisional（agent 标注、未人工复核），对外不要表述为"准确率"。
- 账号同步为可选能力；未配置 `VITE_API_BASE_URL` 时全部数据留在本机。
- 生产环境必须设置独立的 `AUTH_SECRET`（当前代码在缺省时会退回开发默认值，属于已知待修项）。