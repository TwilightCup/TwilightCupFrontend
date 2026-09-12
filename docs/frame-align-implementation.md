# 实现计划：直播流 × 计时器事件对齐（基于 SEI 帧级时间戳 realtime_us）

> 前篇《frame-align-hls-feasibility.md》论证了**可行性**：MediaMTX HLS 段内 SEI `realtime_us`
> 逐帧原样保留，绕开 MSE 走 fetch/demux/WebCodecs 即可拿到逐帧共享时钟并帧锁。
> 本文把可行性落到**当前仓库的两个导播端界面**的具体实现：
> ① **舞台界面**（`src/scenes/match/MatchScene.vue` + `StreamFrame.vue`，A/B 双 4:3 同屏 +
> 计时器/偏差条 overlay）；② **控制界面**（`src/views/DirectorView.vue`，监控预览 + 延迟控制卡）。
>
> 对齐**原理 = SEIInjector 已发布的 `tools/align_streams.py` 同款**：每流帧按 `realtime_us` 升序 →
> 挑公共目标时刻 **虚拟对齐时间戳 T**（§1.1：`T ≤ 最慢流前沿 − 30s`，漂移满 30s 用 2 倍速追回 15s，
> 10 分钟缓冲）→ 逐流呈现 rt 最接近 T 的帧（帧锁）；**所有渲染（舞台 A/B + 控制台 A/B = 四路）共用
> 同一个 T 与解析帧**，保证控制台所见与舞台像素一致；计时/事件叠加层**全部锚定虚拟时间 T**——
> 事件按 `T ≥ 事件现实时间戳` 门控揭示（防剧透、单调揭示一次），连续计时外推到 T，替代手动 delayA/B/delayDiff。

## 0. 现状与缺口（一句话）

现有 `StreamFrame` 用 hls.js+MSE 播画面，**拿不到逐帧 SEI**；计时器靠 `useDelayedRef` 按手动
`delayA/delayB/delayDiff`（0.5s 步进，导播猜）回放对齐画面。目标：**自动**测出每侧画面
端到端延迟并持续跟随，A/B 同帧呈现，计时事件与画面用户动作对得上。

## 0.1 需你确认的取舍（实现前定）

| 取舍 | 默认建议 |
|---|---|
| **对齐渲染是否替换现有 MSE `<video>`** | 新增 `SeiStream`（WebCodecs/canvas 帧锁）为对齐主路径；`StreamFrame`(MSE) 保留为**兜底/非对齐预览**。配置键按侧开关。 |
| **手动 delay* 是否废除** | 取消「均匀整段 delay 手动猜」。叠加层改**锚定虚拟时间 T**：事件按 `T ≥ 事件 ts` 门控揭示、连续计时外推到 T。保留 `offsetA/B/Diff` 作手动微调兜底（对齐失败/NTP 断时）。`delay*` 留兼容别名。 |
| **解码资源（2×1080p）** | 每侧 `isConfigSupported` 探测后硬解；不可解该侧退 MSE 兜底并提示（不拖垮另一侧）。 |
| **控制台 vs 舞台一致性（四路一个 T）** | **单一对齐权威**：每条唯一流只解码一次、在共享 T 下解析出一份帧；舞台 A/B 与控制台 A/B 四路渲染**都消费同一份解析帧** → by construction 像素一致。同一文档内直接共享；跨文档（不同页签/机器）经 WS `director_cmd` 广播 T（每帧一次），各侧按 T 取最近帧（≤1 帧差异）。**废弃**原「控制台独立轻量预览/探针」思路（会漂移不一致）。 |

---

## 1. 需要对齐的两个东西

1. **两路直播流互相对齐**（A/B 呈现同一真实瞬间）——由帧锁保证。
2. **计时器事件对齐画面**——计时器的读数是「服务器近实时」（`live_time` 墙钟外推），
   画面是「≥30s 延迟」。要让人眼看到选手在屏幕上做动作的瞬间与计时器数字吻合，
   需把计时器**回放延迟 = 画面实测端到端延迟** `lat_side`。

关键物理量：
```
lat_side ≈ now(浏览器墙钟合用 rt 域表示) − rt_shown   // rt_shown = 当前上屏帧的 realtime_us
```
因为呈现即「目标 rt = 现在 − D」的帧，`lat_side ≈ D`，正好是观众实际看到的画面滞后。
计时器晚播 `lat_side` 即与画面同刻。D 对各侧取公共值＝虚拟对齐时间戳的滞后（见 §1.1）。

### 1.1 控制规格（2026-09-12 已与需求方确认）

> 目标从可行性篇的「低延迟(≈400ms) 帧锁」改为「**高延迟(≥30s) 但永不 desync 的稳定对齐合成**」——
> 同一套 SEI 帧锁机制，仅呈现目标延迟 D 由 ~400ms 放大到 ≥30s，且引入**可控速率 T**。

三条规则（µs 口径，`realtime_us` 记 `rt`）：

1. **缓冲**：每侧解码帧按 `rt` 升序放 **10 分钟**环形缓冲（每侧独立），
   过期帧丢 + `VideoFrame.close()` 防显存泄漏。
2. **虚拟对齐时间戳 T**（共用呈现点）：A/B 都呈现「rt 最接近 T」的帧。
   ```
   S_side    = 每侧缓冲内最新可用帧的 rt（每侧独立）
   S_慢      = min over sides(S_side)              // 最慢那侧的前沿
   required  = S_慢 − 30s                           // T 的上限（呈现至少比慢侧前沿旧 30s）
   T         = min(T_按_1x_推进, required)           // T ≤ required，永不“追最新”
   ```
   T 默认随真实时间按 **1 倍速**推进；两侧取最接近 T 的帧，故相对零错位。
3. **2 倍速追回**：当 T 相对慢侧前沿漂移累积满 30s，转 **2 倍速向前推进 15s** 追回 。
   ```
   drift = required − T                              // 滞后富余（T 落后 required 的程度）
   if drift 累积 ≥ 30s:
       T 转 2 倍速推进，直到净追回 15s（2x 播 15s 真实 = 相对 1x 净多走 15s → 滞后减 15s）
       或提前触到 required；随后回 1x，drift 计数归零
   ```
   **Why 这能保住缓冲**：慢侧前沿快跑（如断流恢复跳帧）时 `required = S_慢−30s` 也快跑，T 用 1x 追不上 → drift 涨；
   满 30s 时 T 用 2x 快进 15s 贴住前沿，把「落后/耗尽缓冲」限制在 ≤30s 内，10 分钟缓冲作安全垫。
   2x 期间两侧**一起**快进（都取最接近 T 的帧），依然互锁，只是共同加速——管理器/输出端可见统一快进。

### 1.2 一致性：四路渲染共用单个虚拟 T

- **要求**：导演在控制台看到的 A/B 画面必须与舞台像素一致 → 不能各自算一个 T。
- **设计**：**单一对齐权威** `useFrameAlign`（模块级单例）拥有每条**唯一流**的
  poller+demux+decoder + T（§1.1）+ 解析出的帧缓冲。**舞台 A/B 与控制台 A/B 四路渲染都消费同一份
  解析帧**（解码一次、T 一份）。同文档直接共享实例（零差异）；跨文档经 WS `director_cmd`
  新增 action 广播 T（每列刷新一次），各侧按广播 T 取最近帧（≤1 帧 = 33ms 差异）。
- **唯一流**：A/B 各一条视频源即 2 路解码；若某侧确有两源（面捕+屏捕）则按实际唯一路径数解码，
  原则不变——每唯一流解码一次、被两界面复用。

### 1.3 事件防剧透 + 计时器锚定虚拟时间 T

> 计时事件（live_time / subsegment_gap / 完赛、成企信 / 选图/回合变更）现多含**现实时间戳**
> （`LiveTime.realTimeMs`/`receivedAt`、`UtcTimestamp.utcMs` 为 epoch 毫秒；缺的用 WS 接收时刻
> `Date.now()`）。虚拟时间 T 是 epoch 微秒，与事件 epoch 毫秒同一时钟（NTP 精度内，30s 缓冲掩蔽偏移），
> 可直接比较。**T 只前向单调**（§1.2），故 gating 单调、揭示一次。

- **连续计时（主计时/分段/偏差值）**：不再 uniform delay，改为**外推到虚拟时间 T**——
  `值(T) = totalMs + (T_wall_ms − receivedAt)`，其中 `T_wall_ms = T/1000`。画面呈现 rt≈T 的帧、
  计时显示 T 时刻读数 → **天然同刻**，2× 追回时 T 快进、计时也随之加速，仍与加速画面一致。
- **离散事件（完赛、结果、新分段完工、选图、偏差条某条）**：入一个带 `ts` 的事件队列，
  **只在 `T/1000 ≥ ts` 时揭示**到叠加层（latched——揭示一次不隐回）。T 落后 30s+ → 事件在
  「画面上已经发生」之后才出现 → 不剧透；2× 追回只让它更快揭示（画面更快），不破一致性。
- **绑 ts**：`subsegment_gap`/`lastResult`/round 变更等现无戳 → 在 director store 收口时绑
  `recvAt = Date.now()`（≤ 亚秒误差，远小于 30s 缓冲）。逐事件精确门控，取代现有整段 delay 猜测。
- **手动兜底**：`offsetA/B/Diff`（秒）加减在 `ts` 上作为最终微调，对齐失败/NTP 断时回落手动延迟。

### 1.4 计时器「何时起转 / 能否回溯」（现状核对，2026-09-12）

- **起转**：页面挂载起 50ms 一跳，但**有第一条 `live_time` 样本才显示**；读数 =
  `totalMs + (now − receivedAt)` 墙钟外推，此后**仅前向**。mock 从挂载起随墙钟走。它不认识视频时间轴。
- **回溯**：源只前向；显示层 `useDelayedRef` 能「往回看」进 60s 缓冲（均匀 delay，非逐事件，亦不知 T）。
- **新设计**：T 前向单调 → 计时/事件随 T 揭示，**不回溯不反复**；2× 只加速不倒退。故「能否回溯」
  的答案是进程不回溯，且这正是防剧透、防闪的基础。

---

## 2. 复用已验证的地基（不必重做）

- **SEI 载荷布局**（UUID 后 22B，全大端）：`version(1)=1|flags(1)|seq(4)|media_pts(8)|realtime_us(8)`；
  flags bit0=关键帧、bit1=NTP 校准。Annex-B 起始码 + 0xFF 变长 + **RBSP 反转义**。
- **盲搜可与解析双路径**：UUID `7e57c2ee…` 段字节可直接搜（含 0 会被 0x03 反转义，字段须先反转义）。
- **判关键帧**：moof `sdtp`/`isKey` + SEI `flags.bit0` 双保险；首关键帧后初始化 decoder。
- **fMP4 形态即 WebCodecs 想要**：init 段 `avcC/hvcC` 作 description；样本 = AVCC 长度前缀。
- 上述全部已在 `public/tools/hls-sei-smoke.html` 验证到 demux+SEI 解析这一步（不含解码），
  实现时**直接移植其 JS 逻辑**，不是从零写。

---

## 3. 新共享模块 `src/scenes/align/`（舞台与控制共用）

> 每条流一条管线（复用冒烟工具逻辑封装）：

```
SeiParser(sei.ts)          —— 复刻 C 布局：切 NAL→H264 type6 / H265 type39→反转义→{uuid,version,seq,pts,rt,key,ntp}
HlsSegmentPoller           —— 拉 m3u8，增量追 LL-HLS parts（含 EXT-X-PRELOAD-HINT）/ 经典 segments + 首拉 init
Fmp4Demuxer                —— 增量喂 init+segment → 逐样本 {avcc, isKey, dts, pts}
FrameQueue                 —— 已解帧按 rt 升序；过期帧 VideoFrame.close() 防显存泄漏
FrameLockPlayer            —— WebCodecs VideoDecoder + rAF 排程 + 自锚时钟 + lag 测量
useFrameAlign (单例权威)    —— 多路汇总：公共目标 T（§1.1）、每侧 lat_side/ntpFlag/lag/fps；
                              暴露各唯一流的解析帧 + T 给舞台/控制台两界面复用（§1.2）
```

- **时钟自锚（rt 域 ↔ 浏览器 perf 域桥接，feasibility §4.3）**：每侧维护
  `rt(perf) = rt_latest + 1000·(perf − perf_latest)`（µs 口径）；跨侧用**中位数**聚合「现在」，
  避免单流缓冲抖动带偏公共 T。首帧锚定误差只影响绝对延迟 D，不影响 A/B 相对对齐。
- **排程（按 §1.1 控制规格）**：维护共用**虚拟对齐时间戳 T**（默认 1x 推进 + `T≤S_慢−30s` 上限 +
  漂移满 30s 转 2 倍速追回 15s）。每 rAF 对每侧取 `argmin|f.rt − T|` → draw 到该侧 `<canvas>`
  （2 倍速时两侧一起快进，仍互锁）；每侧 **10 分钟**环形缓冲，`< T − 2×帧间隔` 的旧帧出队丢 +
  `VideoFrame.close()`；某侧缓冲内最长 rt 仍 `< T`（严重滞后）→ 该侧保持上一帧并记 `lag_s`，超标走重同步。
- **demux/SEI 扫描放 Web Worker**（`align.worker.ts`），主线程只接管片断 + VideoDecoder + 排程，
  避免拉取/解析卡 UI。解码走主线程即可（VideoDecoder 本就拉起独立编解码线程）。
- **降级**：`VideoDecoder.isConfigSupported` 探测；不可解/超两路 → 侧/整页切 `StreamFrame`(MSE) 兜底。
- **可插拔取源（2026-09-12）**：`transport.ts` 抽 `FrameSource`（HLS 默认 / annexb-原始ES）——
  »RTSP 单拉逐帧解析« 的浏览器落点 = 后端/代理把 RTSP 或原始 Annex-B ES 透成 HTTP fetch，前端
  `parseAnnexbFrames` 逐帧锚（可换 WebRTC/MediaStream 源）。换源不触核心（demux/SEI/解码/速率/排程）。
  内存：10 分钟**原始**环（字节级）对 4K60 也无压力（需求方已证 2×1080p60 对齐可行）；解码帧仍
  只在 T 小窗外保留（GPU）。

### 组件封装 `SeiStream.vue`（对齐渲染，输出 canvas）

```html
<SeiStream side="A" :canvas="resolvedCanvasA" @ntp="(b)=>…" @lag="(s)=>…" />
```
- **只消费 `useFrameAlign` 解析好的帧**（`resolvedCanvasA/B`），不做独立对齐/独立解码——
  舞台与控制台传同一份 canvas → 四路渲染同 T 同帧、像素一致（§1.2）。
- `sideA/B` 各自 `SeiStream` 只是「把权威解析帧画到本视图的 canvas + 裁切 4:3/应对 hidden」的展示层。
- 内部能力探测失败时 `useFrameAlign` 报告该侧 `off`，外层 `SeiStream` 切回 `StreamFrame`(MSE) 兜底并提示。
- 保留 `crop4to3` / `hidden` / `refreshNonce` 语义，与 `StreamFrame` 对齐。

---

## 4. 舞台界面对齐（`MatchScene.vue`）

1. **A/B 对齐画面**：`<section class="streams">` 的两个 `StreamFrame` 换成 `SeiStream`，
   消费 `useFrameAlign`（单例权威）解析帧；参与共用 T（§1.1）。双画同帧、零跳变。
2. **叠加层锚定 T（替代手动 delay，§1.3）**：
   - **连续计时**（主计时/两行副计时/偏差值）：`useLiveTimers` 外推锚从 `now` 换成虚拟时间
     `T/1000`（wall-ms）→ 显示「画面上那一时刻」的读数，天然同刻，2× 追回自动跟上。
   - **离散事件**（完赛/结果/选图/偏差条条目）：事件队列按 `T/1000 ≥ ts` 门控揭示（latched）。
   - 弃用 `useDelayedRef` 整段均匀 delay；保留 `offsetA/B/Diff` 手动微调兜底。
3. **对齐主路径 = OBS 窗口采集的合成时输出**（沿用 feasibility §0.1 既定决策——
   导演台真实 Chrome 全屏，OBS 只采像素，页内不二次编码）。
4. 原有 MSE `StreamFrame` 保留为「监看/兜底」，配置 `alignA/alignB` 关回退；关掉时叠加层用它
   的手动 `offset*` 对齐。

---

## 5. 控制界面对齐（`DirectorView.vue`）

1. **监控区预览与舞台像素一致**：`cfgCard` 里的两个 `StreamFrame` 换成 `SeiStream`，与舞台
   **消费同一个 `useFrameAlign` 解析帧 + 同一 T**（同文档共享实例；跨文档经 WS 广播 T，§1.2）。
   → 导演在控制台看到的 A/B 与舞台一致。
2. **状态卡**：每侧显示 **实测延迟 ms**（= `T` 相对实时）、NTP 状态（`n=false` 提示）、`lag_s`、
   当前播放速率（1x/2x 追回中）。
3. **对齐控制卡改造**（现 `delay-grid`，`@change pushDelay`）：
   - 「自动对齐」开关 `alignA/alignB`：开 = 叠加层锚定 T（§1.3）；关 = 回落手动 `offset*`。
   - 保留 0.5s 步进 `offsetA/B/Diff` 微调（对齐失败/NTP 断的降级锚）。保存/调整即 `config_update` 广播。
4. **stageUrl 随链接参数**：`withCfgParams` 增加 `align_a/align_b/offset_a/offset_b/offset_diff`
   非空即拼，三段下发与现有 hls_a 等并列，落库同三层优先级。

---

## 6. 配置与协议扩展小结

`useDirectorConfig.DirectorConfig` 新增键（默认值）：
- `alignA/alignB: boolean`（默认 true——开 = 叠加层锚定虚拟时间 T）
- `offsetA/offsetB/offsetDiff: number`（秒，0 起步，0.5 步进；叠在事件 ts 上作手动微调/降级锚）
- `delayA/delayB/delayDiff` 降级为**兼容名**（旧配置读时映射为等效 offset 兜底），不清历史配置。

**协议/WS 扩展**（贯穿三层下发 URL > localStorage > 默认、config_update 广播、DIRECTOR state_sync 回放）：
- 新增配置键随 `config_update` 广播（现有白名单机制只加这几键）。
- 新增 `director_cmd` action（如 `frame_align`）用于**跨文档广播虚拟时间 T**（每列刷新一次，
  载荷 `{t_us, slot}` 或仅 `t_us`），供控制台/舞台不同页签（不同机器）共用同一 T（§1.2）。
  同文档共享实例则无需该广播。

---

## 7. 落地里程碑（1–2 天冒烟 → 2–3 天最小原型 → 收尾）

| 里程碑 | 内容 | 出口 |
|---|---|---|
| **M1 移植解析器** | `sei.ts`/`fmp4Demuxer.ts`/poller 从冒烟工具移植进 `src/scenes/align/`，Web Worker 包装，接入 Vite | 舞台/控制可用，接口与冒烟对拍字节级一致 |
| **M2 双路同帧 demo** | `FrameLockPlayer` A/B 同屏各 canvas、10 分钟缓冲、共用 T（`T≤S_慢−30s`）；同一倒计时人工复核 ≤1 帧 | 导演台硬解验证通过；软解/HEVC 降级路径可走 |
| **M2.5 速率控制** | 实现 §1.1 规则三：drift 满 30s → T 2 倍速追回 15s；断流重推后慢侧前沿跳帧、T 用 2x 贴回——人工看到两侧一起快进且仍互帧锁 | 速率控制数值对拍（drift/15s 追回），缓冲不因慢侧恢复而耗尽 |
| **M3 叠加层锚定 T（防剧透）** | 连续计时改外推到 `T/1000`；离散事件（完赛/成企信/选图/偏差条）入队按 `T/1000 ≥ ts` 门控揭示（latched）；`useDelayedRef` 退役；director store 给 `subsegment_gap`/`lastResult`/round 变更绑 `recvAt`；配置 `align*/offset*` + config_update 广播 + WS 广播 T（跨文档）全接通 | 同画面上计时与选手动作同刻；人为断流 2× 追回时计时随之加速无剧透；控制台与舞台像素一致 |
| **M4 收尾与边界** | 断流 5s 重推 ≤1s 恢复、NTP 断(`n=false`)回落 offset、30min 漂移、OBS 窗口采集播出链路冒烟 | 长稳通过；功能开关默认关闭（保守上线） |

默认开关：推进时新路径默认 **off**（仍走 MSE+手动），控制端一键开启验证——避免上线即变。

---

## 8. 已知风险与回退（沿用 feasibility §5/§6）

| 风险 | 应对 |
|---|---|
| 2×1080p WebCodecs 软解吃力（硬解不可用） | 每侧独立探测 → 退 MSE 兜底 + 提示；不拖垮另一侧（对齐路径要求硬解，`chrome://gpu` 预检） |
| HEVC 依赖平台硬解 | `isConfigSupported` 探测；不可解按 §0.1 处理，不阻塞其他流 |
| 某侧抖动 > D（如偶发 500ms 卡顿） | 该侧重同步/停帧等齐并 UI 标 `lag_s`，不错位跳变 |
| 计时口径与 `live_time` 外推整合 | 叠加层锚定 T 只改**显示层**（外推锚换成 `T/1000`、事件按 `T/1000 ≥ ts` 门控），不改 director store 的原始计时语义 |
| CORS | MTX `hlsAllowOrigins:["*"]` 确认；承载页同源应对（现有冒烟已验证） |

## 9. 相关参考
- feasibility 全文 `docs/frame-align-hls-feasibility.md`（SEI 布局、时钟自锚、降级、边界）
- 冒烟工具 `public/tools/hls-sei-smoke.html`（demux+SEI 解析已验证逻辑，M1 直接移植）
- SEIInjector `tools/align_streams.py`（对齐原理与跨流测量口径的权威样例）
- 现状代码：`src/scenes/match/{MatchScene,StreamFrame,useDelayedRef}.vue|ts`、`src/scenes/composables/useDirectorConfig.ts`、`src/views/DirectorView.vue`