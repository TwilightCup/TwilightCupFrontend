# 共享直播链接（前端）

后端契约基线：TwilightCupBackend `074a82f`，见其 docs/stream-links.md。
四个原始地址 hlsA/hlsB/embedA/embedB 按比赛持久化；T、延迟、显隐、刷新次数和外观不进入该模型。

- 导播编辑草稿，PUT /me/matches/{match_id}/stream-links，提交 expected_version 和四字段。响应成功才提示已保存服务器并应用规范值。
- 409 stream_links_version_conflict 保留草稿，GET 最新配置，不自动重试覆盖；“读取服务器（放弃草稿）”重新开始编辑。match_read_only 不作为版本冲突处理。
- 裁判和舞台只读；裁判重拉播放器的 nonce 仅本页使用。播放代理使用当前页面自己的 token，不保存导播代理 JWT。
- WS stream_links_update + 鉴权/重连 GET + 前台/focus GET 恢复；按当前认证账号、比赛及版本隔离，旧响应和重复版本不倒退。
- 相同地址的新版本不改变播放器 URL，也不增加刷新 nonce。流变化后通过现有播放器 URL watch 更新，不额外 reset T。
- 服务器 version=0 是未配置，默认不播放旧缓存。仅导播可明确确认“导入本机旧地址”，采用 expected_version=0 保存；非零版本即使空串也覆盖旧URL/缓存。新生成的舞台链接不携带流地址。
- 仅无稳定错误码的 404 Not Found 识别为旧后端路由不支持：可保留本页旧地址兼容播放，清楚标记未云端保存；403/401/match_not_found 不走缓存兜底。既有授权快照在短时网络/503异常中保留，权限拒绝则清空。
- 新前端过滤旧 config_update/state_sync.config 的四字段，不经旧 WS 重复写链接；非链接操控保持原路径。

边界：后端实时通知仅单worker，后台页面不会轮询；重连和回前台GET补偿，持续前台的跨worker即时广播尚需后端pubsub。旧console无版本写仍可能覆盖新配置，需统一升级。地址可保存不代表签名永久有效或流可播放。

验证：npm test、npm run typecheck、npm run build、git diff --check。自动化覆盖冷启动读取、清空、并发冲突、GET/WS乱序、账号/比赛切换、拒绝权限、旧路由识别、草稿保留、裁判WS只读和本地重拉、舞台重挂载及地址不变不刷新。
尚需真实导播/裁判/舞台三机联调及线上后端部署验证；不使用Computer Use。
