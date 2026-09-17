# 服务端权威与 follower 软追赶（取代旧 2x 设计）

## 实际协议核查

只读检查后端 HEAD `f62ace5`，没有修改或运行会写入后端的测试。

- `src/twilightcupbackend/connection_manager.py:863`：暂存 key 是
  `(account_id, match_id)`，同账号多页面共享，不以连接 id 隔离。
- `:889-913`：采用第一个页面传来的 src；当前 src 可以持续写 T；静默超过
  5 秒允许其他 src 接任。T 来自 `payload.t_us`，不由服务器时钟推进。
  没有校验 epoch、seq、T 单调或 rate。一个进程内选中一个发布者，并不是
  服务端权威时钟；进程内字典也不能证明多 worker 唯一。
- `:594-609`：采纳的 payload 原样转发，然后通知 align_authority；排除发送者。
- `:939-948`：晚加入 state_sync 只保留 t_us/ready_a/ready_b 和独立 src。
  实时消息里的 seq/rate/paused/时间扩展字段不进入回放；旧 T 不等于当前 T。
- `:952-976`：按比赛 director 集合及相同 account_id 广播，多个 Stage 都能收到。
- `protocol.py:266`、`docs/ws-protocol.md:336,704` 描述的是页面发布者选举。
- `tests/test_director_command.py:303,435,472,495,508` 覆盖转发、补发、唯一
  src、5 秒接管、无 src 拒绝；不是服务端时钟/epoch/多 worker 测试。

## 本轮前端行为

所有 Stage/Director 都仅 follower：删除 setAuthority、舞台 heartbeat 发布及
store 的 frame_align 发送接口。无锚点显示“等待后端权威时间”，绝不改用本地 T。
**因此只有新版前端 + 当前后端的全新会话不能自行开始对齐播放**。这需要后端完成
下述服务端时间权威；普通非对齐播放路径保留。旧页面实时转发仍可兼容跟随，但不
将其称为服务端生成的时钟，也拒绝旧 2x 速率（本轮支持 0..1.08）。

ExternalClock 接受可选 epoch/seq/rate/paused/frozen/effective_at_ms/server_now_ms、
account_id/match_id/scene/source_id。账号/比赛与认证会话核对；同 epoch 内
scene/source_id 不可变化。epoch 增大允许 seq 重置，但 T 仍不得倒退。
旧 epoch、旧/缺 seq（已经启用 seq 后）、倒退输入 T 均拒绝。换 epoch/src
取消未完成跳转并准备新的共同恢复。服务端先通知 src 再下发该 src 的锚点。

锚点使用本地 performance 时间连续投影；只相减同一服务端的两个时间戳，
不把 Date.now 与 performance 混用。最大外推 1 秒，1.5 秒无新鲜锚点则 stale。
旧 state_sync 缺少锚点时间，立即标 stale；有完整新字段的回放可以立即投影。
网络单程延迟依然未知，不声称跨浏览器绝对同帧。冻结后从不退回旧本地时钟。

## 纯函数策略及共同恢复

`rateControl.ts` 集中 CATCHUP 常量、planCatchup 与 recoveryGate。

- 后端投影为 authorityUs；本地已提交的显示时间为 tUs，两者不混为新权威。
- 共同安全上限：`min(authorityUs, min(A.continuousTo,B.continuousTo)-30s)`。
  下界是双方 continuousFrom 的最大值。区间为空或需要倒退则等待。
- 常速跟随后端 rate；正常 rate=1 时，小误差保持 1x。
- error >=500ms 进入 soft；降至 <=100ms 退出（滞回）。额外速率随误差
  比例变化，1.01..1.08x；总速率封顶 1.08，无 2x。一次推进最多计 100ms，
  页面后台长暂停不直接以大 elapsed 播穿队列。
- 偏差 >=5s、首次呈现、旧 T 不在连续区间或累计缺帧 2s 时准备 seek。
  取上述共同安全上限作为同一个目标，先确认双方有可解码目标 GOP。
  同步关闭双方旧 decoder、清 decoded queue、取消旧配置回调、重置 decPos
  到目标之前的关键帧，以正确历史 codec/description 重建参考链。
- pendingSeek 固定目标，不能每个 rAF 都重置解码。目标失效或连续解不出 2s
  才重新选择。双方 nearest 误差各 <=40ms、A/B 差 <=40ms；连续 250ms
  合格后才共同提交 T/画面，之前叠加层仍读旧已提交 T。任何缺帧重置恢复滞回。
- 普通播放候选缺帧也共同冻结，速率归零，不用加速掩盖。恢复时从正常状态重新评估。
- 新 epoch/source 的重建同样经过双侧门控。不可解码/无公共窗口继续等待。

30 秒是防剧透缓冲下限，不是 chase 阈值。大偏差跳转为前向跳过内容，事件层按
同一个已提交 T 查询历史；未收到历史时等待，不补造事件。它不是每个浏览器可随意
选择的权威 seek：本地目标只能落后于后端 T，不能超过它。全页同时精确 seek 尚需
后端共同生效锚点和就绪协调。

## 给后端 agent 的明确任务（本次未实施）

1. 在服务端建立 `(account_id,match_id)` 的唯一时间 authority；若业务要求所有导播
   账号同播，则改为 match/channel 级并明确授权。跨 worker 使用统一持有者/存储，
   重启和接管必须增加持久单调 epoch；不要由前端先发 src 来决定 T。
2. frame_align 完整字段：`epoch,seq,t_us,rate,paused,frozen,effective_at_ms,
   server_now_ms,account_id,match_id,scene,source_id,src`。scene 建议固定为
   broadcast 时间线；切视觉场景不重置时间，换源必须提高 epoch。单位明确为
   epoch 微秒 T、服务器 epoch 毫秒生效/发送时间。正常 rate=1，冻结 rate=0。
3. 服务端基于可信 A/B 连续可解码前沿（服务端媒体元数据或有验证的观测报告），
   保持 T <=最慢前沿-30s；管理暂停、恢复和共同重锚。前端只可报告覆盖/就绪，
   不可用报告直接覆盖 T。当前前端尚无此新观测接口，需协议确定后接入。
4. 向全部同范围连接广播（无页面发布者例外），建议 <=400ms 心跳。认证后必须
   原子补发当前完整锚点，包含新鲜服务端时间；不能仅回放旧 t_us。先发送 authority
   身份通知，再发送锚点；所有 epoch 内 seq 单调。支持断线后无新媒体事件也补发。
5. 增加三个以上 Stage/Director、多账号/比赛隔离、跨 worker、重启、晚加入、
   暂停、旧 epoch/seq 拒绝与 30s 安全边界测试。多页面真实收敛验收后再宣称完成。
6. 事件仍需 SEI 同时钟域时间、event_id/round_id、历史补发及 timer running/rate。
   这些是上一轮留下的依赖，本轮没有修改事件协议。

MediaMTX/SEIInjector 不改：仍须实际确认 SEI、完整 fMP4、关键帧、CORS/auth、窗口
和重试保留时间。当前未取得真流验收证据。

## 验证与参考依据

先补测试并观察失败，再实现。Node fixtures 覆盖多页投影、不自选权威、旧消息拒绝、
软追赶收敛/滞回、共同 seek、旧游标重置、缺帧冻结、恢复滞回、回放新鲜度及范围隔离。
执行 npm test、npm run typecheck、npm run build、git diff --check。
这不是 OBS/真实 WebCodecs/后端部署/真实双流长时间验收。

工程原则参考（参数由本项目测试选择，并非复制其他产品默认值）：

- [hls.js API](https://github.com/video-dev/hls.js/blob/master/docs/API.md)：
  liveSyncPosition、maxLiveSyncPlaybackRate 与最大延迟分别控制目标、追赶速率和 seek。
- [hls.js maxLatency](https://hlsjs.video-dev.org/api-docs/hls.js.hls.maxlatency)：
  超出最大延迟 seek 回 liveSyncPosition。
- 请求的 [dash.js wiki](https://github.com/Dash-Industry-Forum/dash.js/wiki/Live-Stream-Catchup)
  此次读取失败；改查 [dash.js 官方说明](https://dashif.org/dash.js/pages/usage/low-latency.html)，
  验证 bounded playbackRate 与 maxDrift seek 的分工。
- [YouTube 官方说明](https://support.google.com/youtube/answer/7444635?hl=en)：
  延迟与抗缓冲能力的取舍；本项目保留高延迟安全缓冲，不追求贴直播边缘。

没有采用或声称掌握 Bilibili 内部多端同步实现。
