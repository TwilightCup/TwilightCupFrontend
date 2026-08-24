# 黄昏杯 · 赛事控制台（Twilight Cup Console）

《人类一败涂地》1v1 速通比赛的 **多端 Web 前端**。基于后端
[`TwilightCupBackend`](../TwilightCupBackend) 提供的 REST + WebSocket 接口，
登录后按角色优先级（管理员 > 裁判 > 导播 > 选手）进入默认端；**一个账号可拥有多个角色**，各端顶栏的「切换端」可随时切到其他角色端：

- **裁判端**（`/referee`）：实现需求文档 §8.3 的裁判全流程——会话接入、准备阶段、
  状态监控、回合控制、胜负判定（含事后修改）、数据查看、聊天与命令、独立倒计时器。
- **管理员端**（`/admin`）：账号管理（增删改查）、比赛会话管理（赛制 / 图池 /
  角色指派，含可视化图池编辑器）、会话数据查看（比赛日志 / 回合明细 / 聊天）。
- **选手端**：开发期模拟器（`/player`），模拟「游戏内输出」用于后端联调；仅 `npm run dev` 下启用。
- **导播端**（`/director`）：只读观赛控制台，并提供 **OBS 合并舞台**（`/stage.html?token=...`，
  单浏览器源承载全部场景）与各场景独立入口——比赛详情 / 图池 / 赛程图 / 项目信息
  （裁判宣布选图后展示该项目的 speedrun.com 排行榜 Top 15）。

**多角色账号**：一个账号可同时拥有多个角色（管理员默认兼裁判 + 导播）。登录进默认端后，
各端顶栏的「切换端」下拉可切到该账号其他角色对应的端；WebSocket 连接按 `?seat=` 指定身份，
同一账号可同时开多个端（不同 seat 互不踢连，例如管理员同时开裁判端 + 导播叠加层）。

> 需求文档原文将裁判端定位为「桌面应用」，本项目按需改为 **Web 前端**实现，
> 功能覆盖与文档一致。

## 技术栈

Vue 3 + TypeScript + Vite 6 + Pinia + Element Plus（与 `BSRWebsite` 同体系）。

## 前置条件

- Node.js ≥ 20（本仓库在 Node 26 验证）
- 可访问的 `TwilightCupBackend` 服务（默认 `http://localhost:8000`）

## 安装与运行

```bash
npm install

# 开发模式（默认 http://localhost:5173）
npm run dev
```

浏览器打开 `http://localhost:5173`，登录后按角色优先级进入默认端（多角色账号进最高
优先级端，顶栏可切换）。可用后端 `scripts/seed_demo.py` 灌入的 `admin`（兼裁判 + 导播）、
`referee` 等示例账号。

### 连接到后端

开发期默认走 **Vite 同源代理**（`/api` → REST、`/ws` → WebSocket），
浏览器与后端同源，**无需后端配置 CORS**：

| 浏览器请求 | 代理转发到 |
| --- | --- |
| `http://localhost:5173/api/auth/login` | `http://localhost:8000/auth/login` |
| `ws://localhost:5173/ws/{token}` | `ws://localhost:8000/ws/{token}` |

后端地址可通过两种方式改写：

```bash
# 方式 A：改代理目标（推荐，仍同源、无 CORS）
TWILIGHT_BACKEND=http://192.168.1.10:8000 npm run dev

# 方式 B：浏览器直连（需后端自行放行 CORS；WebSocket 不受 CORS 限制）
echo 'VITE_BACKEND_URL=http://192.168.1.10:8000' > .env
npm run dev
```

### 构建

```bash
npm run build     # vue-tsc 类型检查 + vite 打包到 dist/
npm run preview   # 本地预览构建产物（仍是 vite）
npm run typecheck # 仅类型检查
```

### 静态预览（脱离 dev server）

跨网段访问 dev server 偶发响应损坏、白屏时，可改用构建产物 + `vite preview` 静态预览。
应用功能零损失，只失去开发期热更新。

```bash
# 1) 把后端地址编进产物（<host> = 后端所在机器、客户端可达的地址；
#    后端需监听 0.0.0.0 并放行端口）
echo 'VITE_BACKEND_URL=http://<host>:8000' > .env

# 2) 构建 + 预览（--host 让局域网可访问；preview 自带 history fallback）
npm run build
npm run preview -- --host     # 默认 http://0.0.0.0:4173
```

改代码后重新 `npm run build` 即可；想省去手动重建，另开一个终端跑
`npm run build:watch`（监听变更自动打包到 `dist/`，但无 HMR，需手动刷浏览器）。

> 静态预览没有 dev server 的 `/api`、`/ws` 反代，故**必须设 `VITE_BACKEND_URL`** 让浏览器直连
> 后端（后端已 `allow_origins=["*"]` 放行 CORS）。裁判端的 WebSocket 也由该地址推导。
>
> 注意：`vite preview` 默认对响应做 gzip 压缩。若个别代理链路下出现
> `ERR_CONTENT_DECODING_FAILED`（浏览器解压失败），多半是链路上有设备破坏了压缩响应——
> 改用 nginx 等静态服务托管 `dist/`，或临时交给不压缩的静态 server 即可。

## 功能与需求对照（§8.3）

| 需求 | 实现 |
| --- | --- |
| 加入指定会话 | 登录后自动以 JWT 连接 `ws://.../ws/{token}`，服务端按账号解析其进行中的会话并下发 `auth_ok` |
| 标记准备阶段 / 选定选图 | 「回合准备」面板：`referee_mark_prep`、`referee_select_pick` |
| 状态监控 | 双方准备状态、比赛状态（游戏中/已完成/已弃权）、关卡进度、已完成关卡用时（实时 `player_status` / `level_time_update`） |
| 回合控制 | 图池选图、手动开始（`referee_manual_start`，不可中断倒计时）；平局由判定 `TIE_REMATCH` 自动触发重赛 |
| 胜负判定 | `referee_verdict`（A 胜 / B 胜 / 平局重赛 / A·B 断连判负），事后修改 `referee_edit_verdict` 实时同步导播端 |
| 强制操作 | 未全员就绪可手动开始；异常可 `referee_terminate_round` 强制终止 |
| 数据查看 | 「数据查看」抽屉：每回合双方明细（多关每关用时 / 单关每次尝试），刷新自 `/logs/.../rounds/{n}` |
| 聊天 | 三方群聊 + 系统消息，`!roll`、`!counter [秒]`、`!counter reset` 命令 |
| 日志 | （重）连接后拉取比赛日志与聊天日志重建状态 |

## 管理员端功能（`/admin`）

对接后端 `/admin/accounts`、`/admin/sessions`（管理员鉴权）与 `/logs/...`
（管理员具备 viewer 权限）。

| 模块 | 实现 |
| --- | --- |
| 账号管理 | 表格 + 搜索 + 创建 / 编辑 / 删除；**角色多选**（选「管理员」自动带裁判 + 导播）；编辑时密码留空不改；禁止删除当前登录的自己 |
| 会话管理 | 列表（双方 / 裁判 / 导播自动从账号映射展示名）+ 创建表单：赛制 BO、取胜分（留空按 BO÷2+1 推导）、单关计分方式、开始延迟、图池、按类型筛选的角色账号下拉 |
| 图池编辑器 | 可视化结构化编辑：类别 → 选图（编号 / 名称 / 类型 / 重试次数 / 词条），`collection.raw` 用 JSON 文本框带解析校验 |
| 数据查看 | 会话详情抽屉三 Tab：概览（赛制 / 图池 / 最终结果）、回合数据（并发拉取各回合明细）、聊天记录 |

路由按角色隔离：每条受保护路由声明 `meta.roles`，跨角色访问会被守卫重定向回
自己的首页（如管理员访问 `/referee` 自动回 `/admin/sessions`）。

## 选手端模拟器（`/player`，仅 dev）

开发期用于后端联调的选手端模拟器：登录选手账号后进入，模拟「游戏内输出」。
**仅在 `npm run dev` 下启用**（`import.meta.env.DEV` 守卫）；生产构建下选手登录显示
「仅开发可用」提示页，不进入模拟器。

复用 `MatchSocket` 连接后端，覆盖选手全部上报消息（对齐后端 `match_fsm`）：

| 阶段 / 项目 | 模拟器操作 | 对应消息 |
| --- | --- | --- |
| 准备 | `!ready` 切换 | `ready_toggle` |
| 多关 · 逐关 | 输入本关用时 → 上报 | `level_time_upload`（自动累计 `total_ms`） |
| 多关 · 结束 | 完成项目 / 弃权 | `project_complete`（带总时长）/ `forfeit_signal`（`multi_exit`） |
| 单关 · 逐次 | 输入本次成绩 → 上报 / 跳过 | `level_time_upload`（`level_index`=尝试号）/ `attempt_skip` |
| 单关 · 结束 | 完成项目 / 0 有效弃权 | `project_complete` / `forfeit_signal`（`single_exit_0_valid`） |

关卡数取自 `round_start.collection.raw.levels`，单关尝试次数取自 `pick.retry_count`，
模拟器据此自动推进序号。联调流程：裁判端 `mark_prep` + `select_pick` → 双方选手
`!ready` → 自动倒计时 → 回合开始 → 选手逐关 / 逐次上报 → 双方结束 → 裁判判定。

## 导播端与 OBS 场景页（`/director` + `/stage.html`）

导播登录后进入只读控制台（`/director`），实时展示比分 / 阶段 / 选图 / 双方进度 / 聊天，
并提供 **OBS 场景页链接**（含 token）。导播连 WS 后服务端按账号解析 seat=DIRECTOR 自动
订阅广播，全程只读（`director_subscribe` 实为 no-op）。

### OBS 浏览器源（合并舞台与独立场景页）

控制台点「复制链接」得到 `https://<host>/stage.html?token=<jwt>&match=<id>`，填入 OBS 的
「浏览器源」（建议 1920×1080）：

- **合并舞台（推荐）**：单浏览器源承载全部场景（待开始 / 项目信息 / 比赛详情 / 图池 /
  赛程图），控制台点按钮经 WS 广播即时切换；后打开的舞台由 state_sync + pick_announced
  回放自动对齐当前场景与选图。
- **独立场景页**：`match-scene.html` / `mappool.html` / `bracket.html` /
  `categoryinfo.html` 各自一个 OBS 源（合成器浪潮全屏画面）。
- **项目信息场景**（`categoryinfo`）：裁判宣布选图后，解析该选图的 speedrun.com
  项目并拉取排行榜 Top 15（名次 / 选手 / 成绩），本场选手（账号绑定 speedrun.com
  用户）上榜时以选手色高亮。解析规则：图池编辑器配置的显式映射优先；未配置时
  自动解析——多关按选图名称匹配全游戏项目（Aztec% / Dark% / Steam% / Any%…，
  CP 类回退 Checkpoint%），单关按关卡名经官方展示名对照匹配 IL（PC 分类）；
  子分类全杯 Solo，Glitchless 取选图标题、Checkpoint / Pinch 等取 CT 词条。
  解析不出的选图（如工坊图）显示占位卡。speedrun.com 数据经**后端同源代理**
  （`/api/speedrun/*`，需登录令牌）拉取，规避浏览器 / OBS 直连的网络与跨域
  问题，并由后端 TTL 缓存削峰（上游限流 100 请求/分）。
- token 来自导播账号 JWT，场景页用它自建 WS（hosted 场景由舞台代连）；后端支持同一
  导播账号多连接并存，控制台与舞台可同时在线、互不影响。

选手展示名从聊天消息捕获（未发言前为「选手A / 选手B」）；比赛元数据（赛制 / 延迟）在
`auth_ok` 后拉 `match_log` 补全。

## 数据来源说明（重要）

裁判无权访问 `/admin/sessions`（管理员限定），因此：

- **比赛元数据**（赛制、取胜分数、单关计分方式、延迟秒数、图池选图**编号**列表）
  来自 `/logs/sessions/{id}/match_log` 的 `initial_info`。
- **比赛日志在首个回合开始时才生成**。故首回合开始前，图池编号未知——
  此时需在「本回合选图」中**手动输入首个选图编号**（如 `ML1`）；后续回合的
  下拉列表会随回合明细逐步补全。
- **选手展示名**从聊天消息中捕获；未发言前以「选手A / 选手B」占位。
- 选图名称/类别随回合明细与回合广播逐步补全。

## 项目结构

```
src/
├── api/            # REST 客户端 + 类型（与后端 schema 对齐）+ 后端地址解析
│   ├── types.ts    # 枚举与领域模型（含管理员域：账号 / 会话 / 图池）
│   ├── config.ts   # restBase / wsUrl（代理 or 直连）
│   └── client.ts   # login / 日志查询 / 账号·会话 CRUD
├── ws/             # WebSocket 封装 + 协议消息类型（镜像 protocol.py，裁判端用）
│   ├── socket.ts   # 鉴权连接 / 心跳 / 断线重连
│   └── protocol.ts # 客户端→服务端、服务端→客户端消息
├── stores/
│   ├── auth.ts     # 登录 / 令牌持久化 / 多角色 roles + roleHome() 按优先级路由
│   ├── match.ts    # 裁判端中央状态：阶段 / 比分 / 双方实时 / 聊天 / 回合历史
│   ├── admin.ts    # 管理员端：账号 / 会话列表加载与 CRUD + id→展示名映射
│   ├── player.ts   # 选手模拟器（dev）：复用 MatchSocket + 游戏内上报动作
│   └── director.ts # 导播端（控制台 + 叠加层）：只读收广播 + OBS 链接
├── components/
│   ├── RoleSwitcher.vue  # 顶栏「切换端」（多角色账号可见）
│   ├── (裁判端)    # MatchHeader / PrepPanel / VerdictPanel / PlayerStatusCard /
│   │              # CountdownBanner / ChatPanel / CounterWidget / RoundHistoryDrawer
│   └── admin/      # AccountFormDialog / SessionFormDialog /
│                   # MappoolEditor + MappoolPickEditor / SessionDetailDrawer
├── views/
│   ├── LoginView.vue       # 通用登录，成功后按角色跳转
│   ├── MatchView.vue       # 裁判端（/referee）
│   ├── PlayerView.vue      # 选手模拟器（/player，仅 dev）
│   ├── DirectorView.vue    # 导播控制台（/director）
│   ├── DirectorHomeView.vue # 导播比赛列表（/director）
│   ├── PendingView.vue     # 兜底占位页（/pending）
│   └── admin/              # AdminLayout / AccountsView / SessionsView（/admin/*）
├── utils/format.ts # 时间格式化 + 枚举中文/配色（含账号类型 / 会话状态）
└── router/         # 多端路由 + requiresAuth / roles 角色守卫
```

## 验证

- 类型检查与生产构建：`npm run typecheck` / `npm run build`（`vue-tsc` 通过）。
- 裁判端：已对真实后端（mongomock）完成联通冒烟——REST 登录、`/auth/me`、
  WebSocket `auth_ok`（seat=REFEREE），以及一次完整回合
  （PREP → IN_ROUND → ROUND_JUDGING → ROUND_END）下裁判端所依赖的全部
  消息类型均按序到达。
- 管理员端：`admin/admin` 登录后进入 `/admin/sessions`，可新建账号、
  新建会话（图池编辑器 + 角色指派）、查看会话详情（回合明细 / 聊天）；
  跨角色访问（如管理员进 `/referee`）会被守卫重定向回自己首页。
- 选手端（dev）：`playerA` / `playerB` 登录进入 `/player` 模拟器，`!ready` 后配合裁判端走完
  一轮回合（多关逐关上报 → 完成项目，或单关逐次上报 → 完成 / 0 有效弃权）。
- 导播端：`director` 登录进入 `/director` 控制台，复制「OBS 叠加层链接」填入 OBS 浏览器源，
  叠加层实时显示比分 / 倒计时 / 选图 / 判定（透明背景 + 动画）。
- 多角色：`admin` 登录进管理员端，顶栏「切换端」可切到裁判 / 导播端；开多 tab 同时以
  `seat=REFEREE`（裁判端）与 `seat=DIRECTOR`（导播 / 叠加层）连接，互不踢连。
