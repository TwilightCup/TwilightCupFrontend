# 基于真实时间戳（SEI realtime_us）的帧级对齐 —— HLS 链路可行性调研

> **2026-09-12 更新**：本文为**可行性论证**（能否 + 边界）。落地到当前仓库舞台/控制
> 两界面的**具体实现计划**见 → `docs/frame-align-implementation.md`（依赖 SEIInjector 已发布的
> `tools/align_streams.py` 同款对齐原理，把手动 delayA/B/delayDiff 升级为自动实测跟随）。

> 背景：交接文档 v1（《比赛多玩家直播 → 帧级对齐 → 导播视角对外直播》）预设"SEI
> Gateway 桥 + WebSocket"作为前端取帧通道；但本项目**已验证 MediaMTX HLS 能直接
> 拉到当前导播页面**（hls.js/MSE 双 `<video>` 已跑通）。本文调研：**放弃网关、直接
> 在 HLS 链路上做基于 SEI `realtime_us` 的帧级对齐，是否可行**。
> 结论先行：**可行**，且 HLS（尤其 LL-HLS/fMP4）几乎是浏览器端做逐帧对齐的"最顺"
> 现成通道；代价是播放器架构需从 `hls.js + MSE <video>` 换成 `fetch 段 → demux →
> WebCodecs → canvas 帧锁排程`。交接文档的 SEI Gateway 由此降级为**可选**（不阻塞）。
> 前提见 §7 的 5 分钟实测清单（SEI 确实在段里、WebCodecs 能解当前编码）。

### 0.1 选型决策记录（2026，与需求方确认后更新）

| 决策项 | 结论 | 对架构的影响 |
|---|---|---|
| 播出方式 | **OBS 窗口采集网页**（非浏览器源/非 WHIP） | 帧锁合成页在**导演控制台真实 Chrome** 全屏运行，OBS 只采像素 → **网页内无需二次编码、无需 WHIP**（可选保留）；不依赖 OBS CEF |
| 运行位置 | 导演控制台 Chrome（必要时独立输出 Chrome 窗口） | WebCodecs 解码按真实 Chrome 能力设计（含 HEVC 硬解探测） |
| 编码支持 | **H.264 与 H.265/HEVC 双支持**（HEVC 为省码率） | 解码路径双 codec 自适应：`VideoDecoder.isConfigSupported` 探测；HEVC 不可解时按 §2.4 降级策略 |
| 路数/时延 | ≤3 路（以 2 路为主）；时延按常规直播口径 | D≈400ms 起步；LL-HLS(part 200ms) 足够 |

由此推荐 **A 方案（浏览器直取 MTX HLS → WebCodecs → 帧锁合成 → 上屏，OBS 窗口采集）**，
SEI Gateway 与页内 WHIP 均不进入关键路径。

---

## 1. 问题界定与结论链

要做的事：多路（A/B/C）选手画面按 **同一真实时刻**（各机 NTP 同步、SEI 帧内
`realtime_us`）逐帧对齐，供导播台同屏/切换合成。
要把 HLS 当取帧通道，需要回答三个问题：

| # | 问题 | 结论 |
|---|---|---|
| Q1 | SEI（含 `realtime_us`）会随 MediaMTX HLS 到达浏览器吗？ | **会**。MTX 及它的 HLS 库对每个 Access Unit 原样透传，无任何 SEI 过滤（§2.1，已查源码） |
| Q2 | 现有 `hls.js + MSE <video>` 播放路径能用这些时间戳做帧锁吗？ | **不能**。MSE 把帧交给合成器后 JS 拿不到逐帧与原始 NAL；两路 `<video>` 各自缓冲、各自起播，无共享逐帧时钟（§2.2） |
| Q3 | 绕开 MSE 后，浏览器能否自取 HLS 段、解出逐帧 SEI 并按时排帧？ | **能**。fMP4 段样本本来就是 WebCodecs 想要的 AVCC 形态；demux + SEI 解析 + 排程全部有现成库/成熟做法（§2.3/§2.4/§4） |

所以：帧级对齐的**数据（逐帧真实时刻）和通道（已验证的 HLS）都已在手**，
缺的只是播放器架构升级 + 排帧器（即交接文档 §5 的算法落到 HLS 语义下）。

---

## 2. 关键事实核查（2026 现场版）

### 2.1 SEI 在 MediaMTX HLS 中逐帧保留（源码级证据）

MediaMTX 的 HLS 输出由其自研 [gohlslib](https://github.com/bluenviron/gohlslib) 完成，
H.264/H.265 写入路径（`muxer_segmenter.go` 的 `writeH264/writeH265`）：

- **fMP4 / LL-HLS（默认 `hlsVariant: lowLatency`）**：每个视频样本 = `AVCC(au).Marshal()`
  的**整段 Access Unit**（长度前缀 NAL 序列）。已核对 [mediacommon `avcc.go`](https://github.com/bluenviron/mediacommon/blob/main/pkg/codecs/h264/avcc.go)：
  `Marshal` 对 AU 内每个 NALU 原样加 4 字节长度前缀拷贝——**不剥 SPS/PPS，更不剥 SEI**。
- **`hlsVariant: mpegts`**：每个 PES 承载整段 AU（Annex-B 起始码形式），同样原样。
- gohlslib 全仓库**无任何 SEI 剥离/改写逻辑**（grep `sei` 零命中）；MediaMTX 只做
  协议互转不重编码，SRT→内部 unit→HLS 全程不触碰 SEI。

> 换句话说：插件打在每个编码帧里的 UUID + `realtime_us` 会**原样出现在浏览器 fetch
> 到的 HLS 段字节里**。这是整条可行性的地基（§7.1 仍需现场抽一段实证）。

### 2.2 为什么现有 MSE 路径做不到帧锁（这不是配置问题，是架构问题）

- MSE 解码后由浏览器合成器按**媒体时间轴 + 各自 buffer** 呈现，JS 侧拿不到：
  - 每帧的原始 NAL（SEI 已被剥掉/不可读）；
  - 帧何时真正上屏（`video.currentTime` 是秒级粗粒度、且受丢帧/seek/缓冲影响）。
- 两路独立 `<video>` 的端到端延迟差可到数百 ms（各自 segment 拉取节奏、`maxBufferLength`
  缓冲、断流恢复时机都独立），不存在"同一帧同一时刻上屏"的机制。
- 因此帧锁 = **不能走 MSE**，要对每条流走"自己能看见每一帧（含 SEI）与到达时刻"的解码路径。

### 2.3 锚点来源：HLS playlist 没有 PROGRAM-DATE-TIME，靠 SEI + 到达时刻

- 已核对 gohlslib playlist 生成代码：**不写 `EXT-X-PROGRAM-DATE-TIME`**。
  即无法用"段边界 ↔ 服务器墙钟"做锚，前端时钟估计（交接文档 §5.1）在 HLS 下的替代：
  **每流解码到达时刻 + 该帧 `rt` 建映射**（详见 §4.3），不需要任何新增服务。
- MediaMTX 默认 `hlsVariant: lowLatency`（LL-HLS）：`hlsPartDuration: 200ms`、
  segment 1s（示例配置 `mediamtx.yml` 实测确认），说明当前部署大概率已在出 LL-HLS parts，
  帧"到达粒度"约 200ms——远好于老式 1s 整段拉取，对帧锁的 D 预算有利（§5）。

### 2.4 浏览器解码侧现状（影响选型，不影响"可行"结论）

- **双编码（决策记录 §0.1）**：解码路径按实际 codec 走 `VideoDecoder.isConfigSupported`
  探测后初始化——
  - **H.264**：Chrome/Edge/Safari 全支持（软解兜底）；Firefox 近年已跟进但需现场确认。**兜底选择**。
  - **H.265/HEVC**：依赖平台硬解（Chrome/Edge 需 GPU 解码器；Safari 依赖 VideoToolbox；
    Firefox 不支持）。需 `hvcC` description——LL-HLS init 段里有。
  - **降级策略**：某流 HEVC 且本机不可解 → 提示该选手切 H.264 推流，或由服务端对
    该 path 转 H.264 出旁路（MTX 不转码，需 ffmpeg 中转/旁路发布），导演台不阻塞其他流。
- 走 WebCodecs 后，HEVC 不再受 MSE 支持矩阵限制（Chrome MSE 不能播 HEVC、WebCodecs 硬解可以）；
  但"能不能硬解"仍须在目标机实测（§7.3）。
- fMP4 形态恰好对齐 WebCodecs 偏好：init 段提供 `avcC/hvcC` 可作 `description`；
  样本 payload 是 AVCC 长度前缀（= 交接文档 §6.3 说的"前端要自己转 AVCC"，这里 MTX
  已替你转好，少一步）。mpegts variant 则是 Annex-B（WebCodecs 无 description 时可喂
  Annex-B，或按附录 A 思路转）。
- 现成库：HLS→demux→WebCodecs 有 [mediabunny](https://github.com/Vanilagy/mediabunny)
  （纯 TS、微秒精度、可读写 MP4/TS/HLS）；fMP4 分片级解析也可用 mp4box.js 类库；
  TS 解析可用 mux.js。逐帧 SEI 扫描是 ~30 行（按 Annex-B 起始码/AVCC 长度前缀切 NAL，
  匹配 H.264 type 5 / H.265 type 39 的 UUID `7e57c2ee-…`）。

### 2.5 实测：插件实现细节（读 SEIInjector 源码确认，前端解析器必须对齐）

已核对本地 `SEIInjector`（`src/sei-payload.{c,h}`、`src/sei-timestamp-encoder.c`、
`src/realtime-clock.c`、`tools/verify_sei.py`），对前端最关键的事实：

- **线上布局**（UUID 16B 之后，全大端）：`version(1)=1 | flags(1) | seq(4) |
  media_pts(8) | realtime_us(8)`，共 22B；`flags bit0=关键帧 bit1=NTP 校准`。
- **`realtime_us` 口径**：OBS 把帧交给编码器那一刻的**本地墙钟 + SNTP 常数偏移**
  （不是采集时刻，比采集晚约 1 帧、每台近似恒定；默认 `pool.ntp.org`、每 60s 重同步）。
  `n=false` = NTP 尚未同步/断网（启动后首次同步约 200ms 内）。
- **SEI NAL 形态**：Annex-B 4 字节起始码 + 头部（H264 1B type 6 / H265 2B type 39）
  + type/size 0xFF 链式变长编码 + **RBSP 反转义**（0x00 0x00 后跟 ≤0x03 前插 0x03）
  + 0x80 结束位。**UUID 本身无 0x00 字节**，可在段字节里直接搜索；但**字段区可能含
  0x00 被插入 0x03**，读字段必须先反转义。
- **关键帧**：插件在关键帧 AU **额外注入带内参数集**（Annex-B SPS/PPS(/VPS)），
  非关键帧只含 SEI+切片 → 前端可在任意关键帧起播（WebCodecs 无需 description 也可，
  fMP4 的 avcC/hvcC 另有）。
- **`frame_seq`**：u32 单调计数，**编码器重启（选手重推）归零** → 用作丢帧/重连检测；
  重推后等首关键帧重建锚即可（与交接文档 §7 一致）。
- **AVCC vs Annex-B**：MTX 默认 LL-HLS(fMP4) 样本是 **AVCC 长度前缀**（gohlslib 用
  `h264.AVCC(au).Marshal()`，源码已核对为逐 NALU 原样拷贝）；mpegts variant 是 Annex-B。
  本工具两形态都能解（见 §7.0）。

---

## 3. 目标链路（推荐 A：浏览器端帧锁，无需 SEI Gateway）

```
选手 A/B/C (OBS + SEI 插件, NTP) ── SRT ──► MediaMTX (playerA/B/C path)
                                              │  HLS 默认 LL-HLS(fMP4)，已验证可达
                                              ▼
当前前端导播页（改造后，仍只依赖 MediaMTX HLS + 浏览器）：
  每路 playerX:  轮询 m3u8 → fetch init + parts/segments
                 → demux 出逐帧 AVCC 样本 (+ avcC/hvcC description)
                 → 扫每帧 SEI 得 rt / key 标记 → WebCodecs VideoDecoder 逐帧解码
                 → 已解帧队列按 rt 升序 → 帧锁排程器按"目标 rt = 本地估计现在 + D"
                   同帧绘制到各流 canvas 图层
  导播 UI:       网格/单画面/画中画 = 对同一组已对齐帧的选择（切换零跳变）
  输出(主路径):  合成画面全屏上屏（含切换后的最终导播画面）
                 → OBS 窗口采集 → OBS 编码推平台（OBS 只采像素、不参与合成）
  输出(可选):    合成 canvas.captureStream → H.264 编码 → WHIP 回灌 MTX director
                 → ffmpeg 推平台（无 OBS 场景备用；页内需承担二次编码）
```

与原交接文档的关系：

- **SEI Gateway + WS（文档 §6）→ 变为可选**：当且仅当想"浏览器不承担 demux/decode"
  或 HLS 段太大不适合前端直取时才需要桥。纯 HLS 直取在段/part 粒度上反而更简单，
  因为 **MTX 已经把 SEI 送进普通 HTTP 资源**，不需要再开一个 WS 帧通道。
- 文档 §5 的排帧算法**原样适用**；唯一差异是把"Gateway tick"替换为"每流解码到达时刻
  自锚 + 公共目标 rt"（§4.3）。
- 文档 §8 的"服务端对齐引擎（备选 B）"仍然成立：引擎吃 MTX 的 RTSP/SRT 出 director path，
  前端只加一路监看；前端 UI 层切换指令语义不变。

---

## 4. 前端帧锁播放器设计要点（供实现 Agent 的任务书）

### 4.1 每流管线（模块）

```
HlsPoller(每 ~0.2–1s 拉 m3u8, 增量追 parts/segments)
  → SegmentFetcher(fetch init[首次] + 新 part/segment, ArrayBuffer)
  → Fmp4Demuxer(增量喂; 输出 {sample: AVCC字节, isKey, dts, pts, moof内序号})
  → SeiScanner(逐样本切 NAL; H264 type5/H265 type39 → {uuid, version, seq, pts, rt, ntpFlag})
  → VideoDecoder(codec: 'avc1…'/'hvc1…', description: avcC/hvcC; output→队列)
  → FrameQueue(按 rt 升序; 容量 ~ D + 余量)
```

- LL-HLS parts（200ms）建议**逐 part 追**（`#EXT-X-PRELOAD-HINT` 预取），帧的可用粒度
  更细、D 可更小；实现复杂度略增（fMP4 分片：每 part 是一个带独立 moof 的片段）。
  首版可退化为逐 1s segment 拉（帧粒度无损，只是 D 与恢复时间变大）。
- 关键帧判定：样本 isKey（moof `sdtp`/gohlslib `IsNonSyncSample`）+ SEI `flags.bit0` 双保险；
  首关键帧后初始化 decoder（description 用 init 段 avcC/hvcC，若解析不出则依赖带内参数集）。

### 4.2 帧锁排程（对接交接文档 §5.2/§5.3 原语义）

- 各流队列按 `rt` 升序（解码器输出 `VideoFrame.timestamp` 直接回填 `rt`，一路透传）。
- 目标时刻：`T = nowEstimate() + D`，`D ≈ 400ms` 起步（LL-HLS 下可试压到 250ms）。
- 每 rAF：对每路取 `|f.rt − T|` 最小帧 draw；把 `< T − 2×帧间隔` 的旧帧丢出队列
  （含 `VideoFrame.close()` 防显存泄漏）；跨关键帧不丢（若迟到区在关键帧前，跳到
  下个关键帧重同步）。
- **迟到处理**：若某路最长 rt 仍 `< T`（它整体滞后），则该路保持上一帧不动并记
  `lag_s`；`lag_s` 超过阈值说明该流管道异常（缓冲放大/断流），走重同步而不拖垮全场。

### 4.3 时钟锚定（tick 的替代：到达自锚）

浏览器无 NTP（文档 §5.1）。HLS 下对每流维持线性映射：

```
perf_to_rt_s(perf) = rt_latest_s + k_s · (perf − perf_latest_s)     // k_s≈1000 µs/ms
nowEstimate() = median_s( rt_latest_s − 1000·(perf_now − perf_latest_s) 的修正 )
```

要点：

- **rt 域是各选手共享的（NTP），perf 域是浏览器本地单调钟**，两者速率比 1000µs/ms 恒定；
  每流用"最近解码帧的 rt ↔ 其 output 回调时刻"建锚，等价于一条每秒多次的隐式 tick。
- 用**中位数/最早可用**聚合做公共"现在"，避免单流缓冲抖动把全体目标时刻带偏；
  跨流残余延迟差由 D 吸收，长时间系统性差（如某选手上行劣化）按文档 §3 做每流常数修正
  （可用 align 工具先测中位偏移，与文档口径一致）。
- 首帧锚定误差只影响绝对缓冲量（D 实际大小），**不影响多流相对对齐**——因为所有流
  共享同一个 rt 参考系。

### 4.4 与现有页面/舞台共存（降级策略）

- 帧锁渲染是新加的**对齐画面层**（导播合成/切换用），建议以**独立输出页**形态全屏运行
  （导演控制台 Chrome，OBS 窗口采集该页）。现有 StreamFrame（hls.js+MSE）保留为
  "监看/兜底"，或由新播放器组件替换。
- 主播出链（OBS 窗口采集）下网页**不做二次编码**——编码与推流仍是 OBS 职责，与现状一致；
  网页只需保证输出页以目标帧率稳定上屏。若未来去掉 OBS 改直推，再启用页内
  captureStream+VideoEncoder+WHIP（可选路径）。
- **OBS 窗口采集的注意点**：采集对整个输出是**均匀**额外延迟/可能的偶发掉帧，
  不构成 A/B 相对错位（帧锁已在页内完成）；输出页建议独占显示器/全屏并避免
  浏览器节能降帧，OBS 采集帧率对齐输出帧率。
- 切换/合成输出才需要帧锁路径；纯人工监看允许 MSE 粗同步，避免一上来就双解码三路
  1080p 的资源压力（CPU/GPU 预算见 §6）。

---

## 5. HLS 特有的误差与边界（对着文档 §5.4 增补）

| 环节 | HLS 链路上的预期 | 备注 |
|---|---|---|
| 每流到达粒度 | LL-HLS ~200ms part / 老式 1s segment | 只影响 D 与恢复时间，**不影响帧级精度**（帧是逐帧 demux 的） |
| 帧排程误差 | < 1 帧（≤33ms@30fps），rAF 量化 ~8–16ms | 队列按 rt 选取，与容器 PTS 无关 |
| 跨流对齐误差 | 主要受 NTP 残差 + 每流端到端延迟差 | 由 D + 常数修正吸收；实测用画面同帧倒计时人工复核 |
| 端到端时延 | 比 SRT/RTSP 路径大（segment 缓冲+播放 D ≈ 0.4–1s） | 对齐精度不受影响；对外直播的"实时性"是另一指标 |
| 断流重连 | 重推后等首关键帧 → 重建锚（§4.3）→ ≤1s 恢复 | 与文档 §7 行为一致 |
| 漂移 | rt 连续性与选手 NTP 质量绑定（`n=false` 即降级） | 长跑用 verify/align 工具复核，预算同文档 §5.4 |

**边界/风险**（决定可行上限，须实测）：
1. WebCodecs 解码并发 2–3 路 1080p：GPU 硬解 OK；软解 3 路会吃力 → 对齐路径务必
   硬解可用（H264 硬解 Chrome/Edge/Safari 常态支持；现场 `chrome://gpu` 验证）。
2. HEVC：可行但受硬解约束——按 §0.1 决策双编码支持，用 `isConfigSupported` 探测；
   不可解的机器按 §2.4 降级策略处理，不阻塞其他流。
3. 每流 fetch 的独立缓冲抖动若 > D（如某流偶发 500ms 卡顿），对齐会短暂劣化为
   该路"停帧等齐"，不会错位跳变——UI 上给 lag 指示即可。
4. CORS：MTX `hlsAllowOrigins` 默认 `["*"]`，同源/跨源均需确认实际配置。
5. 播出为 OBS 窗口采集时：采集是整体均匀延迟/偶发掉帧，不破坏页内 A/B 帧锁
   （§4.4）；需保证输出页不降帧。

---

## 6. 路线取舍（与交接文档 §8 对齐；决策记录 §0.1 已选 A）

| 方案 | 说明 | 何时选 |
|---|---|---|
| **A（已选，本文推荐）** 浏览器直取 MTX HLS → WebCodecs 帧锁合成 → 上屏 → OBS 窗口采集 | 复用已跑通链路、无新服务、无 OBS CEF/页内编码依赖；改动集中在前端播放器 | 导播画面 = 单画面切换 + 少量贴片/网格；2–3 路；导演控制台 Chrome |
| A'（退化）只对"输出合成"走帧锁，监看继续 MSE | 先上切换/合成价值，再整体替换 | 求快、或担心双解码资源 |
| B（文档 §8）服务端对齐引擎出 director path | 页面几乎不改（多一路监看）；帧锁在引擎 | 长期多路网格对外、或浏览器解码不确定（HEVC 全员硬解不保证时）|
| Gateway（文档 §6） | 仅在"浏览器不想吃 HLS demux"或需要服务端介入时 | 一般不需要 |

**建议**：先按 §7 做实测冒烟（1–2 天），通过后按 A 做最小可玩原型（2–3 天出
"双路同屏同帧"demo），再决定整体替换或 A'。

---

## 7. 落地前实测清单（5 分钟级冒烟 → 原型门槛）

### 7.0 冒烟工具（已交付：`public/tools/hls-sei-smoke.html`）

本仓库已实现一个**免依赖、单文件**的冒烟页，覆盖清单第 1–3 项的大部分：

- **用法**：`npm run dev` 后浏览器打开
  `http://localhost:5173/tools/hls-sei-smoke.html`（或任意静态服务器托管 public/）。
  填入 MTX 的 m3u8（如 `http://<mtx>:8888/playerA/index.m3u8`）→「拉流分析」；
  也可「本地文件解析」录屏（fMP4 / TS / Annex-B 均支持）。
- **功能**：拉 m3u8（兼容 LL-HLS parts/EXT-X-PRELOAD-HINT 与经典段）→ 抓 init+段 →
  解 fMP4（box/moof/trun/mdat，取 AVCC 样本 + avcC/hvcC）或 MPEG-TS（PES 重装）→
  逐样本解析插件 SEI → 输出：① UUID 命中证明（原始字节搜索）② 统计卡
  （帧数 / NTP 比例 / 关键帧 / 缺失 SEI / 帧间隔均值≈1/fps / min-max / seq 跳变）
  ③ 逐帧表（seq / K / N / media_pts / realtime UTC / dt_ms）。
- **自检**：页面加载即自检——用与 C 实现同算法的 JS 造帧再解析对拍；已用本地
  `tools/verify_sei.py --raw` 对拍验证 **字节级兼容**（H264/H265 各 5 帧全字段一致）。
- **已本地验证**：真实 fMP4（avcC/样本/关键帧标记）、真实 TS（PES→Annex-B）、
  真实 AVCC 样本内插入插件 SEI 后解析正确、Annex-B 基准 60/60 帧。
- **局限**：普通（非分片）mp4 录屏不解（HLS 恒为分片 fMP4）；m3u8 拉取受 MTX CORS
  （默认 `hlsAllowOrigins: ["*"]`）；页面只做 demux+SEI 解析，不含 WebCodecs 解码
  （解码冒烟见清单第 3 项，后续原型接）。

### 7.1 必须由你现场执行的冒烟

1. **SEI 确实在段里**（决定一切的实验，工具「拉流分析」一键完成）：
   拉 `http://<mtx>:8888/playerA/index.m3u8` → 看「① UUID 命中证明」是否显示命中。
   对拍：选手端录一段 + `tools/verify_sei.py` 看逐帧 rt 连续。
2. **确认当前 MTX 的 `hlsVariant`**：看 mediamtx.yml（默认 lowLatency→part 200ms）：
   - lowLatency/fMP4 → 按 §4.1 的 demux 路径（工具已支持）；
   - 若实际是 mpegts variant → Annex-B 解析（工具已支持）。
3. **WebCodecs 冒烟（双 codec）**：对工具解出的第一个关键帧样本 + init 段 avcC/hvcC，
   喂 `VideoDecoder`（`isConfigSupported` + 实际解码）→ 能出 `VideoFrame` 即通过；
   **H264 与 HEVC 都跑一遍**，记录本机 HEVC 是否硬解可用；顺带记录 decode 回调耗时
   分布（应 ~1–10ms）。
4. **双流帧锁原型验收**：同屏画面中同一倒计时/数字人工复核 ≤1 帧；人为断 A 5s 重推，
   A ≤1s 恢复且不影响 B。
5. **长稳**：30min 漂移观察 + `n=false`（NTP 断）行为。
6. **播出链路冒烟**：输出页全屏 → OBS 窗口采集 → 推流端确认 A/B 画面仍同帧
   （采集是整体均匀延迟，不应引入相对错位）。

---

## 8. 相关参考

- MediaMTX 配置示例（`hlsVariant/hlsPartDuration/hlsSegmentDuration/…`）：官方仓库 `mediamtx.yml`
- gohlslib HLS muxer 源码：`muxer_segmenter.go`（writeH264/writeH265 全 AU 透传）
- mediacommon `pkg/codecs/h264/avcc.go`（AVCC 长度前缀 = 原样逐 NALU 拷贝）
- mediabunny（浏览器端 HLS/fMP4/TS demux + WebCodecs，纯 TS）
- **SEIInjector（协议权威实现，本地已拉取）**：`~/Projects/C and Cpp/SEIInjector/`
  `src/sei-payload.{c,h}`（布局/变长/反转义）、`src/sei-timestamp-encoder.c`（注入行为、
  关键帧带内参数集）、`src/realtime-clock.c`（SNTP 常数偏移、60s 重同步）、
  `tools/verify_sei.py` / `tools/align_streams.py`（对拍与跨流测量）
- **冒烟工具（本仓库）**：`public/tools/hls-sei-smoke.html`（用法见 §7.0）
- 交接文档 v1 §3/§5/§6（SEI 载荷语义、排帧算法、Gateway 协议——本文沿用其语义）
