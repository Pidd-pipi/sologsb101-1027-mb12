# 精酿糖化配方与发酵比重台（gbbrewhouse）

面向精酿车间酿酒师与糖化班组的本地化工艺台账：按配方把麦芽投料糖化，编排升温步与洗糟，记录煮沸投花时间表，逐日测量发酵比重与双乙酰还原情况，算出收得率与酒精度，最后登记罐装批次并归档实绩。

**正式配方按不可变版本管理**：同一款酒连续酿造多批，一旦改动**风格、目标指标（OG/FG/IBU/EBC）、批次体积或原料配比**，系统会封存当前版本并生成新版本号；待执行的糖化步、煮沸投加与发酵计划复制到新版并标记「待复核」，而已完成工序、发酵读数与罐装实绩永远绑定投产时的原版本，历史实绩不会被新标准改写。

核心动作：**建配方与风格 → 维护麦芽酒花辅料库 → 排糖化升温步 → 录煮沸投加 → 跟踪发酵比重 → 罐装归档与结构版本导出**。

纯前端单页应用（Angular 18 + TypeScript + Angular Material + RxJS + NgRx + Angular Router + Dexie），**无后端、无数据库服务、无 API 服务**，全部数据保存在浏览器本地（IndexedDB），刷新或重启浏览器后仍然存在。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先复制环境变量模板
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

启动完成后访问：**http://localhost:22827**

常用命令：

```bash
docker compose ps                 # 查看服务状态（healthy 表示就绪）
docker compose logs -f frontend   # 查看 nginx 日志
docker compose down               # 停止并移除容器
docker compose up -d --build      # 代码改动后重新构建
```

> 端口可在 `.env` 中通过 `FRONTEND_PORT` 修改；容器名固定为 `${COMPOSE_PROJECT_NAME:-gbbrewhouse}-frontend`。
> 容器无状态：不连接数据库、不挂载命名卷，数据全部在浏览器本地，迁移设备请使用应用内「导出整库 JSON / 导入备份」。
> Angular 的构建产物在 `dist/gbbrewhouse/browser`（application builder 的默认结构），Dockerfile 已按此路径拷贝。

---

## 二、技术栈

| 分类 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Angular 18（standalone 组件 + 内置控制流 `@if` / `@for`） | 全部页面为独立组件并按路由懒加载 |
| 语言 | TypeScript（`strict: true`，`strictTemplates: true`） | `npm run build` = `ng build`，含 AOT 模板类型检查 |
| UI 组件库 | Angular Material 18 + Angular CDK（`DragDropModule`） | 卡片、表单、下拉、表格、拖拽调序、SnackBar |
| 响应式 | RxJS 7（`combineLatest` / `forkJoin` / `switchMap`） | 派生比重序列、表观发酵度与收得率 |
| 状态管理 | NgRx 18（Store + Effects + DevTools） | `recipe` / `ferment` / `ingredients` / `mash` / `boil` / `packaging` 六个 feature |
| 路由 | Angular Router（`app.routes.ts`，history 模式） | nginx 侧配合 `try_files` 做 SPA fallback |
| 本地存储 | Dexie 4（IndexedDB 封装） | 库名 `gbbrewhouse-db`，结构版本 `version(2)` 含 v1→v2 upgrade 迁移；配方按系列不可变版本化 |
| 容器化 | Docker 多阶段构建：`node:20-alpine` → `nginx:alpine` | 构建阶段执行生产构建，运行阶段仅托管静态产物 |

---

## 三、本地开发方式

```bash
cd frontend
npm install
npm start          # ng serve --port 22827 → http://localhost:22827
npm run build      # ng build，产物在 frontend/dist/gbbrewhouse/browser
```

---

## 四、页面与路由

| 路由 | 模块 | 消费模型 | 主要交互 |
| --- | --- | --- | --- |
| `/recipes` | 配方与风格台账 | Recipe、Ferment、Malt、Packaging | 配方按系列分版本展示、不可变改版（工艺变更自动 fork 新版本）、待复核列表、乐观锁冲突字段弹窗、切新版投产影响确认、按风格筛选、实时回算实绩 OG/FG、ABV、发酵度与色度偏差 |
| `/ingredients` | 麦芽与酒花辅料库 | Malt、Hop、Recipe | 按色度、α 酸、产地筛选，调整配比后自动重算加权平均色度与总投料量，麦芽色度色块预览；改正式版本配比会生成待复核新版 |
| `/mash` | 糖化升温步编排与洗糟 | MashStep、Recipe | **Angular CDK 拖拽调序**（含上下移按钮）、逐条签署完成（实绩不变版）、复制步「新版待复核」标记与复核、进度与总水量统计 |
| `/boil` | 煮沸投花时间表 | BoilAdd、Hop、Recipe | 按投加时点倒计时排序、**高亮下一投加点**、按 α 酸估算 IBU 并与目标 IBU 比对、复制投加的待复核标记 |
| `/ferment` | 发酵比重与双乙酰还原 | Ferment、Recipe | 批次切换、逐日录入比重/温度/双乙酰（读数绑定所选版本并留痕 vN）、**趋势条（超温标红）**、双乙酰低于阈值提示还原完成、停滞判定 |
| `/packaging` | 罐装批次登记与结构版本导出 | Packaging 及全部模型 | 由发酵读数自动带出 OG/FG 与 ABV、罐装实绩绑定版本、按配方系列导出全版本实绩档案、本地库版本查看与整库 JSON 导入导出 |

---

## 五、目录结构

```
sologsb101-1027/
├── README.md
├── docker-compose.yml
├── .env / .env.example
├── .gitignore
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # try_files SPA fallback + gzip
    ├── .dockerignore
    ├── angular.json / tsconfig.json / tsconfig.app.json / package.json
    ├── public/favicon.svg
    └── src/
        ├── index.html  main.ts  styles.css
        └── app/
            ├── app.component.ts  app.config.ts  app.routes.ts
            ├── core/models/         recipe（系列/版本/状态/发酵计划）malt hop mash-step boil-add ferment packaging（+ filter）
            ├── core/services/       recipe.service.ts（版本 fork/乐观锁/投产拦截事务）gravity-trend.service.ts idb-table.service.ts
            ├── core/state/          recipe/{actions,reducer,selectors,effects}
            │                        ferment/{actions,reducer,selectors,effects}
            │                        ingredients/ mash/ boil/ packaging/（各 actions + reducer + selectors）
            ├── core/utils/          brew.ts db.ts export.ts seed.ts uuid.ts recipe-version.ts（版本判定/冲突/影响纯函数）
            ├── shared/components/   style-tag/ filter-bar/ stat-badge/ empty-panel/
            └── features/            recipes/ ingredients/ mash/ boil/ ferment/ packaging/
```

---

## 六、数据存储与配方版本说明

- **IndexedDB 库名**：`gbbrewhouse-db`（Dexie 封装），数据结构版本号 `version(2)`：v1→v2 带 `upgrade()` 迁移，把历史配方补成各自系列的 v1「正式投产」版、为工序补复核标记、为发酵读数/罐装批次补系列与版本号。
- **分表存储**：`recipes` 配方版本、`malts` 麦芽、`hops` 酒花、`mashSteps` 糖化步、`boilAdds` 煮沸投加、`ferments` 发酵读数、`packagings` 罐装批次，共 7 张表；每行带 `revision` / `createdAt` / `updatedAt`。
- **配方不可变版本（核心规则）**：
  - 同一款酒的全部版本共享 `seriesId`（= 首版 id），版本行带 `versionNo` 与状态 `待复核 / 正式投产 / 已停用`。
  - 改 **风格 / 目标 OG·FG·IBU·EBC / 批次体积**，或在正式版本上改 **原料配比、待执行糖化步、煮沸投加**，都会封存当前版本并生成下一版「待复核」草稿；只改名称或发酵计划参数则在当前版本就地更新。
  - fork 新版时复制**麦芽、酒花、全部煮沸投加**与**未完成的糖化步**，统一打 `needsReview`，发酵计划打 `planNeedsReview`，酿酒师逐条或一键复核；**已完成糖化步不复制**。
  - **发酵读数与罐装批次**不随版本复制，保存时自动落 `seriesId` / `recipeVersionNo`，永远绑定投产时的版本行——配方改版后旧批次的糖化、煮沸、发酵、罐装仍按旧版解释，历史实绩不会被改写。
  - **并发保存（乐观锁）**：保存动作携带窗口打开时的版本号，只接受基于系列最新版本的提交；若期间已被其他窗口更新，旧窗口保存被拒并在页面列出冲突字段（基线值 / 本窗口值 / 最新值），可一键基于最新版本重新编辑。
  - **切新版投产**：当旧版本仍有未完成糖化步或未结束发酵读数（按批次号列出）时，投产按钮先弹出影响说明，必须确认后才把新版置为「正式投产」、同系列其余版本置为「已停用」；在制批次继续绑定旧版执行。
  - 车间现场的「签署完成」是实绩动作，直接写回当前版本、不触发改版。
- **首屏自动播种**：`core/utils/db.ts` 的 `initDatabase()` 在 `recipes` 表为空时调用 `seedDatabase()`，灌入含「正式投产 v1 + 待复核 v2」的演示数据（燕麦世涛系列展示了复制、待复核与历史实绩绑定）；播种幂等。
- **状态流**：页面只 `dispatch` NgRx actions 并 `select` 状态流，版本 fork / 冲突 / 投产拦截全部收口在 `RecipeService`（事务）与 `recipe` effects。
- **无后端**：没有 API 服务、没有数据库容器；容器本身无状态，不挂载任何卷。
- **级联规则**：删除配方系列会删除其全部版本，并级联删除各版本的麦芽、酒花、糖化步、煮沸投加、同系列发酵读数与罐装批次。
- **导入兼容**：整库导入自动给旧备份（v1 结构）补齐版本化字段，语义不回退。
