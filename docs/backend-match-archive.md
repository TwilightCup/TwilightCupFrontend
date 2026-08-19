# 需求:比赛归档(archived_at)后端支持

> 本文档是转交给后端 agent 的需求提示词。前端管理端已实现「归档已结束比赛」的完整
> 前端契约(归档/取消归档按钮、归档筛选、分页、搜索,见 TwilightCupFrontend
> `src/views/admin/MatchesView.vue`),只等以下后端能力上线。

背景:前端管理端比赛列表已实现「归档已结束比赛」功能的前端契约(归档/取消归档按钮、
筛选、分页),需要后端提供持久化字段与两个端点。归档是纯列表整理功能,与比赛状态机
完全正交,**不要新增 MatchStatus 枚举值**。

## 1. 数据模型

- Match 增加 `archived_at: datetime | null = None`(NULL = 未归档)。旧数据无需迁移。
- MatchOut schema 增加 `archived_at` 字段(ISO 8601 字符串或 null),在所有
  /admin/matches 响应中携带(list / get / patch / 新端点)。

## 2. 新端点(权限守卫与现有 /admin/matches/{id}/end 一致)

- `POST /admin/matches/{id}/archive`:仅 status == ENDED 允许(否则 400);置
  archived_at = now;重复归档返回 400;返回更新后的 MatchOut。
- `POST /admin/matches/{id}/unarchive`:仅已归档(archived_at 非空)允许,否则 400;
  置 archived_at = None;返回更新后的 MatchOut。
- 404 处理与现有 end 端点一致;错误响应带 msg/detail(前端会直接弹后端消息)。

## 3. 列表行为

- `GET /admin/matches` 保持返回全部比赛(含已归档,带 archived_at),无需查询参数
  —— 前端在客户端做筛选/分页,且「已归档」筛选项需要这些行来展示与取消归档。
- `GET /me/matches`(裁判/导播「我的比赛」)默认排除已归档比赛(archived_at IS NULL)
  —— MatchSummary 无 archived_at 字段,选手/裁判/导播无需再看到已归档比赛。

## 4. 约束

- archived_at 不得影响 MatchStatus、match_log、fixture 推进、选手占用
  (playerBusy)等任何状态机逻辑;归档的比赛仅是列表展示层面的收纳。
- 更新 docs/openapi.json 与相关文档。

## 5. 验收

- POST /admin/matches/{ended_id}/archive → 200,MatchOut.archived_at 非空;
  GET /admin/matches 包含该行且带 archived_at;GET /me/matches 不再包含该行。
- 对非 ENDED 比赛 archive → 400;重复 archive → 400;unarchive → 200 且
  archived_at 为 null,GET /me/matches 重新包含该行。
