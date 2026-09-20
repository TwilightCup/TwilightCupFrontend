# 转交后端 agent 的提示词

请只修改 TwilightCupBackend，实现“只有导播控制台可竞争主 T，舞台只能接收”的服务端约束。前端已修改，请以以下协议和验收场景对接；无需修改前端。不得未经用户明确授权提交或推送到 main。

## 前端已实现的契约

- 导播控制台 WebSocket 连接带 `align_client=console`；舞台、独立场景页和控制台内嵌场景预览带 `align_client=stage`。`seat=DIRECTOR`、原有认证 token、`match` 不变，不使用 `exclusive` 顶掉其他连接。自动重连保留该参数。
- 控制台才会根据真实媒体/解码就绪状态发送有资格的 `frame_align_status`，并在后端授予角色及完成接管确认后发布 `frame_align`。
- 舞台在现有租约协议中发送 `capability=false, media_ready=false, decode_ready=false, state=media_wait, active_sides=[], waiting_sides=[A,B]`，始终拒绝本地发布和候选预解码，即使旧协议最初错误授予了 publisher。
- 为兼容当前严格的 FrameAlignStatus 模型，前端没有在状态 payload 中增加新字段。`align_client` 只在连接 query 中声明。
- 舞台没有有效锚点、收到 `src=null`、收到 `stale=true`、锚点超时或 WebSocket 断线时遮住视频，显示等待信号；接到有效新主锚点并完成解码后恢复。新任期的 `waiting_publisher` 冻结快照不是新主已开始播放的证据。

## 后端需要补强的行为

1. 在 WebSocket 握手读取并校验 `align_client=console|stage`，将用途固定到 Connection。该参数只区分已通过原认证/授权的连接用途，不能扩大账号或比赛权限。
2. 只有 `Seat.DIRECTOR` 且明确声明 console 的连接可参与选举和发布 T。stage 或未声明用途的连接默认仅接收；从最初握手、旧连接顺序选举路径到租约选举、接管确认和 frame_align 校验，都不得将它们设为有效 publisher。不能仅凭 stage 自报 capability=true 就允许参与。
3. 同账号、同比赛可以同时存在一个或多个控制台、任意多个舞台。健康主控制台不被新加入的控制台抢占；新控制台先跟随并准备接管，不修改现有 epoch/source，不中断舞台广播。舞台加入或离开不触发换主。
4. 主控制台正常关闭时，只从就绪且租约合格的其他 console 中接任；异常断联按租约失效处理。没有合格 console 时立即进入无主状态，广播新任期的 `src=null` 冻结锚点，绝不选舞台兜底。后续 console 就绪后可恢复选主。
5. 保持后端唯一选主、先通知新来源再广播锚点、`epoch/seq` fencing、`t_floor_us` 和接管确认顺序。新主 T 不得低于旧主最后已采纳的 T，旧主迟到消息不得恢复旧任期，也不得越过前端的媒体安全边界。
6. 明确推广兼容策略：未携带 align_client 的旧页面不能继续竞争；新版控制台/舞台需一起刷新。不能为了兼容旧舞台恢复默认最早 DIRECTOR 当主的路径。
7. 另请检查媒体等待时的锚点保活：目前 publisher 的 media_wait 状态会使后端只广播一次冻结，随后不再接受 frame_align，而前端 1.5 秒后认为锚点失联。请区分“主仍在线但媒体等待”和“主已失联”，保持冻结 T 的状态通知，不以推进 T 伪造活跃，也不要产生反复换主。

## 必须验证的场景

- 只有多台 stage（包括 stage 先连）：全程无主、无 T 发布、等待信号。
- 一台 console + 多台 stage：仅 console 为主，各 stage 收到相同权威来源/任期。
- 正常播出时第二台电脑登录同账号同比赛的 console：旧主不变，epoch 不变，原舞台播放不中断。
- 关闭旧 console：新 console 在符合就绪条件后正确接任，T 不倒退，stage 不参与竞争。
- 关闭所有 console：即使 stage 仍有完整媒体缓冲、解码正常，也保持无主。重新打开 console 后正常恢复。
- 主异常失联、候选未就绪、旧主迟到 frame_align、旧 epoch/seq、stage 伪报 capability、缺失/非法 align_client、账号或比赛不匹配均有明确测试。
- 兼容当前前端的严格 frame_align_status 字段和同一 WebSocket 上先报告就绪、再发送 frame_align 的顺序。

请输出后端修改、测试结果、部署顺序和仍存在的限制。不要宣称模拟测试等于跨机器 OBS 实机验收。
