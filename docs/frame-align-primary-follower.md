# 主 T / 从 T：后端选举，前端呈现

此文取代此前“所有前端只能 follower”的设计。2026-09-17 按用户新要求接入后端
连接顺序选举实现。开始核查时该实现尚在未提交工作树中；完成时已复核后端提交
`a71d2bf`（fix(ws): elect frame publisher by connection order）及对应协议文档。
前端没有修改后端文件。

## 协议与职责

- 后端 `(account_id, match_id)` 范围内最早的 DIRECTOR 连接成为 publisher。
  不是 Stage 固定优先，也不是哪个页面先发 T 就选谁。
- auth_ok 下发 connection_id、align_role、align_authority_src、authority_epoch。
- 主连接断开，后端选最早的剩余连接，增加 epoch，通过 align_authority 向每条连接
  分别下发 connection_id、role、src、epoch、account_id、match_id。
- 前端仅接受本连接 id 的角色消息，拒绝旧 epoch、同 epoch 的角色/src 冲突、
  publisher src 与本连接不一致。旧后端不提供角色时安全保持 follower。
- state_sync 的 align_role/connection_id/frame_align.epoch 可以补充角色；新连接
  重新接受握手，不能沿用原 publisher 权限或旧时钟。
- 断线/显式 disconnect 立即清理发布定时器及角色，冻结本页。重连不抢主。

## 主 T

由后端指定的 publisher 使用现有双路 SEI 连续覆盖和共同呈现引擎推进 T。
初始目标为最慢连续前沿减 33 秒；运行目标为最慢连续前沿减 31.2 秒，包含至少
30 秒防剧透缓冲及从页最多 1 秒、1.08x 外推和选帧误差余量。初始多预留 2 秒分片更新空间。

沿用现有 500ms/100ms 软追赶滞回、最高 1.08x、5 秒硬跳转与双侧解码重建。
两侧候选都可呈现才提交主 T。流断开、目标无公共覆盖时冻结。接任必须遵守收到的
旧主 T 下限；新流覆盖未追上时等待，不发布倒退时间。

director store 每 400ms 通过不排队的 socket.send 发布 frame_align，字段为
整数 t_us、本任期 epoch、独立递增输入 seq、src/source_id=connection_id、
scene=shared-playback、account_id/match_id、rate、paused/frozen、ready_a/b。
发送的是已共同提交的 T；冻结时仍发 rate=0 的锚点。服务端负责最终 epoch/seq
和服务器时间字段，并拒绝非主连接发布。

## 从 T

从连接不自行启动时钟，只使用后端转发的主锚点连续投影。保留旧 epoch/seq/T
过滤、1 秒最大外推、1.5 秒 stale、共同硬跳转和缺帧冻结。控制台就绪徽标读取本页
实际 presented 状态，不用远端主页面的 ready 字段替代本页解码证据。

模块单例只在同一文档内共享；不同页面、不同浏览器仍独立拉流与解码。不承诺
跨浏览器绝对同帧，后台节流、传输延迟和各自解码能力可能使从页短暂落后。

## 部署与验证边界

必须部署后端 a71d2bf 或兼容的新版本；旧 83b33be 是服务端媒体采集方案，不提供当前角色握手。
后端当前单进程选举/跨重启 epoch 的限制由后端 agent 负责。主页面必须有启用的
对齐流并保持运行；若最早连接是未拉流的独立信息页，将无法生产主 T，后端后续应
明确参与选举的 capability 或提供放弃主角色协议，不让页面自行冒充接管。

先补失败测试后实现。测试覆盖三页唯一 publisher、旧角色通知、断线撤权、重连 id
隔离、主时钟无外部锚点启动、从页等待及同步、接任 T 下限。继续运行全部原测试、
typecheck、build、diff --check。模拟解码/消息测试不等于真实 OBS 与部署后端联调。
