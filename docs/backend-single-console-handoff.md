# 后端任务：最新控制台独占主 T，取消就绪租约选主

用户已明确允许现在修改后端。请在 TwilightCupBackend 实施、测试并报告结果；不要修改 TwilightCupFrontend。请先核对当前 HEAD、工作树与项目协作要求，保留用户其他修改。本文是交接提示词，完成阅读和交接后由用户安排删除，不要顺手改前端仓库。

## 目标语义（用户已确认）

- 同一导播作用域只允许一个有效控制台。沿用现有 `(account_id, match_id)` 隔离；不要未经确认扩大成跨账号全比赛互踢。
- `seat=DIRECTOR&align_client=console` 鉴权、成员校验成功后，立即成为 publisher；以服务端接受注册的先后顺序为准，不依赖客户端 Date.now、帧是否就绪、解码进度或页面可见性。
- 后注册的控制台原子替换旧控制台。旧连接即刻失效，收到现有 displaced 通知并以 4001 关闭，不允许旧连接在途的 frame_align、reset、ack 或其他控制消息继续生效。旧连接的迟到清理不能撤销新 owner。
- stage 及未声明 console 的接收者永不参选。新控制台不得断开任何舞台连接，单控制台、多机器舞台继续受支持。
- 缺帧、解码停顿、media_wait、后台节流不改变 publisher 所有权。只有新控制台接管、连接退出、权限失效等连接生命周期事件可取消所有权。
- publisher 真正退出后变成无主，不复活已被顶掉的旧控制台。保留最后画面/无画面提示由前端控制。
- 不再做最老候选竞争、ready eligibility、接管超时确认或因进度不增长而轮换 owner。系统时钟误差允许总计约 5 秒，优先流畅，不引入严格校时失败即停播。

## 当前前端状态与可复用协议

前端当前已推送 `d0ae4bd`；单控制台临时方案来自 `a9fbe7c`：

- 控制台连接使用现有 `exclusive=1&align_client=console`。
- 舞台使用非 exclusive 的 `align_client=stage`。当前后端 exclusive 会误踢舞台，前端临时实现了舞台收到 displaced/4001 后非独占重连；旧控制台仍终止重连。
- 本次后端应将 DIRECTOR 控制台的 exclusive 范围收窄到同作用域的 console，并让新 console 默认独占，即使没带 exclusive=1；选手/裁判原有 exclusive 语义保持。
- 前端没有上线 `align_mode=single_console` 字段，不要依赖这个不存在的协商。优先复用 auth_ok / state_sync / align_authority。
- `auth_ok` 首包就给新 console：connection_id、align_role="publisher"、align_authority_src=自身连接 id、authority_epoch、timeline_version、align_lease_required=false。必须在生成 auth_ok 前完成原子 owner 切换。
- `align_authority` 按收件人填写 connection_id 和 role，并携带 src、epoch、lease_required=false、t_floor_us（可以 null 但不要省略）、timeline_version、reset、account_id、match_id。
- `state_sync` 与握手保持同一版本/owner/epoch。无 owner 时显式给 align_authority_src=null；有 frame_align 时 src/epoch 也必须一致。
- 前端仍可能发送 frame_align_status。将它作为可选诊断，不要求先有 status 才接纳 frame_align 或 reset，不因 media_wait/relinquish/旧 readiness 状态退选，也不再按这些状态周期广播 freeze。
- 前端会在画面暂时冻结时发 paused/frozen/rate=0 的锚点，后端仍转发合法 owner 的状态；不要据此换 owner。

## 必须同时检查的实现位置

以当前仓库实际代码为准，重点为 connection_manager.py：

1. 注册流程、_add_director、exclusive 清理：只替换 console，保护 stage；所有权变更与消息处理互斥，避免并发注册出现双主。
2. _select_oldest、_set_align_owner、_reconcile_align_lease、定时 watchdog：取消上述租约选主分支，不要只把 lease_mode 改为 false 而留下旧分支重新选主。
3. _adopt_align：只接受当前有效 owner + 正确 connection/作用域/epoch/timeline_version 的包，保留 seq 去重与乱序过滤；不再要求媒体就绪租约。
4. _handle_align_reset：去掉 LEASE_INVALID 对 status/capability/received_ms/takeover_deadline 的依赖；仍检查当前有效 console owner、作用域、epoch、版本、request_id 和输入数值。
5. 清理和断线：旧连接迟到的 onclose、超时任务、reset ack 必须不能伤及新 owner；无主时只发一致的无主快照。
6. 避免重复 freeze 日志刷屏：状态变化记一次，持续状态限频统计。日志降噪不能代替解决租约导致的冻结。

## T 与 reset 的约束不得破坏

- 所有管线绝对时间用 UTC/Unix epoch 数值。t_us/target_t_us/t_floor_us 是微秒；effective_at_ms/server_now_ms 是毫秒。经过时长和超时使用单调时钟。时区仅由前端显示处理。
- 主 T 仍由当前 console 提供，后端只校验、排序、转发，不擅自按墙钟生成新的播放 T。
- 接管推进 authority epoch，使旧包永久无效。保留 timeline_version 的现有 fence；普通接管不要伪装成用户 reset。
- 旧主进行中的 reset 在被替换时明确终结为 OWNER_LOST；旧 reset 的失败/准备状态不得使新主永久无法发布或 reset。
- 保留显式 reset 的 preparing/completed/failed 回执、幂等 request_id、旧版本拒绝和实际呈现 ack 约束（当前 target 到 target+1 秒，以实际协议核对）。取消租约前置条件不等于伪造呈现成功。
- 当前默认 deltaT=15 秒；前端遇到双路仍收数据但画面 4 秒不推进时可重拉双路并请求 reset，30 秒冷却。后端无需新增自动 reset，也不要恢复 10→20 秒自动回退。
- 不扩大所有匹配窗口，不更改前端已有的 3 秒画面匹配容差。

## 必须通过的测试与验收

- 第一个 console 无任何解码/状态包，也立即收到 publisher 握手；未有 T 时舞台等待，绝不伪造画面就绪。
- 多个 stage 保持连接，第二个 console 注册只顶掉第一个 console；stage 无 displaced/4001，收到新 owner 后继续跟随。
- 老 console 的迟到 frame_align/status/reset/ack/close 均无效；不能触发重新选主或清空新 owner。
- 两个 console 并发注册：按服务端确定的总顺序，最后一个唯一有效，无双主。
- 不带 exclusive 的新 console 仍接管；stage 带异常 exclusive 参数也不能顶掉主 console（拒绝或忽略该参数，并测试）。
- 长时间 media_wait、无 status、paused/frozen、后台节流不会轮换 owner；连接真正关闭后清为无主。
- reset 在无租约状态下可请求并完成；超时、拒绝、重复 ack、旧 owner ack、接管中断均有正确终态。
- auth_ok/state_sync/align_authority 的 connection_id、owner、epoch、timeline_version 始终一致；scope 隔离与权限校验不回退。
- 用当前前端做单机 console + 多机 stage、刷新 console、旧页恢复前台的联调。若必须调整前端协议，请给出精确字段与样例，不要直接修改前端。

完成报告：后端 commit/分支、测试结果、协议样例、是否需要前端后续适配，以及部署后核验步骤。不要把仅关闭日志或仅修改角色文案当成任务完成。
