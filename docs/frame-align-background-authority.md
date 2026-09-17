# 后台页面与主 T 调度

2026-09-17；前端基线 601a138；只读核对后端 a71d2bf。

## 当前前端修复

旧 useFrameAlign.start 依赖 rAF；document.hidden 时仅每秒调用一次 tickLoop，
而 tickLoop 与 planCatchup 的单步 elapsed 上限均为 100ms。这使隐藏页面的主 T
至多约 0.1x 前进。director.ts 的 400ms 广播定时器也可能被后台策略节流。

PlaybackDriver 现在组合：可见时 rAF；隐藏时 dedicated Worker 每 25ms 发消息；
未报告 hidden 但 rAF 已停时，在距上次 tick 80ms 后采用后台唤醒。使用消息接收时
本页 performance.now，不跨 Worker 时钟域，也不根据积压消息数量补走时间。
8ms 内重复唤醒去重，旧 generation 回调在 stop/restart 后无效。
Worker 不可用时保留主线程定时器兜底，并输出明确警告；CSP 必须允许 blob Worker
才能使用此后台路径，否则回退仍可能受节流。未修改系统或服务器配置。

主时钟广播既由播放驱动触发，也保留原心跳定时器，统一以 performance 时间限制为
最多每 400ms 一次。选举、seq、已共同呈现 T、缺帧冻结和安全边界保持原语义。
控制台与舞台使用相同引擎，因此此修复不依赖哪种页面被选为主。

失去焦点不等于隐藏，不使用 blur 事件暂停播放或切换 authority。
Worker 只提供唤醒，不把解码、canvas 或 WebSocket 移到 Worker。
该路径能降低 rAF 停止的影响，但不能保证浏览器后台线程、消息队列永不节流。
整个页面冻结、进程挂起、休眠或网络中断时，前端仍无法发布新锚点。

参考 Chrome 官方说明：
https://developer.chrome.com/blog/timer-throttling-in-chrome-88

## 给后端 agent 的明确任务（本轮未实现）

目标：主页面挂起时，其他仍活跃且具备双路或降级播放能力的页面能被服务端选为主，
不要求原页面断开 WebSocket，不允许多个页面自行抢主。

请先阅读 connection_manager.py 的 _select_oldest（约 501 行）、
_expire_align（约 1205 行）、_freeze_align、_announce_authority 与 frame_align 校验。
当前 _expire_align 只冻结 T，不替换仍保持连接的失活 owner，最早连接还可能未拉流。

1. 定义有类型的客户端状态/租约消息：connection_id、递增 client seq、可生产 T 的
   capability、visibility、最近实际播放进度、媒体/解码可用状态。消息必须绑定认证
   连接及 account_id/match_id，接收时间用服务端时钟，不信任客户端 wall time。
   前端本轮尚未发送此新消息，需要双方约定 action 与字段后接入。
2. 仅在 capability 成立且租约新鲜的连接中选主；优先可见且持续推进的候选。
   不以 blur 单独撤权；加入稳定期避免窗口切换造成频繁选举。
3. 即使旧 WebSocket 未断，owner 租约超时也必须重新选举；无可用候选才冻结。
   区分因媒体故障主动冻结和进程不再执行；不能因比赛双断流而不断换主。
4. 先递增 epoch 并撤销旧发布权限，广播角色；给新主发送带单调 T 下限和完整
   active_sides/waiting_sides 的接管锚点。新主确认解码可用后续播，旧主恢复后
   旧 epoch/seq 的所有写入必须被拒绝。已有冻结快照/晚加入重放需保留扩展字段。
5. 定义接管时限、候选无解码能力时的拒绝/放弃主角色行为；租约与冻结理由加入日志。
6. 测试：三页中 owner 停止执行但连接未断；从页晋升；旧主恢复不能抢写；全员
   hidden 但仍能推进不误判失活；全员挂起后冻结；无能力页不占主；不同账号/比赛隔离。

不要求后端改传输层或自行解码媒体。若所有浏览器都被系统暂停，只能冻结等待；
要在这种情况下仍持续生产权威时钟，必须另设不依赖浏览器生命周期的常驻服务。

## 验证边界

确定性 fixture 覆盖无 rAF、无主线程定时器时的十秒主 T 推进与广播回调，
可见但 rAF 停止、重复调度、旧回调隔离、Worker 不可用兜底。
这是调度/引擎验证，不是真实 OBS、浏览器长时间最小化或系统休眠验收。
