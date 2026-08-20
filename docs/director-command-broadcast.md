# 导播控制台 → 舞台 WS 广播指令

## 背景

导播控制台运行在 Chrome 浏览器，导播舞台运行在 OBS 内置 CEF 浏览器控件中——两个独立进程，
localStorage + StorageEvent 跨进程不同步。需要通过后端 WS 广播实现：

1. **场景切换**：控制台切场景 → 舞台即时响应
2. **Coming Soon 倒计时操控**：控制台开始/暂停/重置 → 舞台实时响应

## 约束

- 每个导播只能控制**自己的**舞台（同 `account_id` + `DIRECTOR` 座位的其他连接）
- 不广播给裁判/选手（仅 `seat == DIRECTOR` 且 `account_id == sender.account_id` 的其他连接）
- 消息格式遵循现有 `protocol.py` pydantic v2 discriminator 联合类型约定

## 需要的后端改动

### 1. `protocol.py` — 新增消息类型

**客户端 → 服务端：**

```python
class ClientDirectorCommand(BaseModel):
    """导播控制台发往同账号其他导播连接（OBS 舞台）的指令。"""
    model_config = _cfg
    type: Literal["director_command"] = "director_command"
    # 指令类别
    action: Literal["switch_scene", "soon_start", "soon_pause", "soon_reset", "soon_set_target"]
    # 指令载荷（按 action 不同含义）
    payload: dict[str, Any] = Field(default_factory=dict)
    # switch_scene:   {"scene": "soon"}              — SceneKey 字符串
    # soon_start:     {}                              — 从 paused 恢复或首次启动
    # soon_pause:     {}                              — 暂停倒计时
    # soon_reset:     {}                              — 重置为 idle
    # soon_set_target: {"target_ms": 300000}           — 改目标毫秒数
```

将 `ClientDirectorCommand` 加入 `ClientMessage` 联合类型。

**服务端 → 客户端（广播用）：**

```python
class SrvDirectorCommand(BaseModel):
    """服务端广播给同账号其他导播连接的指令（原样转发 ClientDirectorCommand 的 action+payload）。"""
    model_config = _cfg
    type: Literal["director_cmd"] = "director_cmd"
    action: str       # 同上
    payload: dict[str, Any] = Field(default_factory=dict)
```

将 `SrvDirectorCommand` 加入 `ServerMessage` 联合类型。

### 2. `stores.py` MatchStore — 新增广播方法

在 `MatchStore` 类中新增方法：

```python
def broadcast_to_other_directors(self, sender: Connection, msg: ServerMessage) -> None:
    """将消息广播给同 match 的其他 DIRECTOR 连接（排除 sender 本身）。"""
    for conn in self.directors:
        if conn is not sender:
            # 可选：按 account_id 过滤（只给同账号的其他连接）
            # if conn.account_id != sender.account_id:
            #     continue
            asyncio.create_task(conn.send(msg))
```

> **注意**：当前需求是"每个导播控制自己的舞台"，所以应该加 `account_id` 过滤：
> 只广播给 `conn.account_id == sender.account_id 且 conn is not sender` 的连接。

### 3. `connection_manager.py` 或消息处理链 — 处理 `director_command`

在 handle 方法中增加对 `ClientDirectorCommand` 的 case 分支：

```python
# 在消息分发处（handle 或 match_fsm 或 wherever client messages are dispatched）
if isinstance(msg, ClientDirectorCommand):
    srv_msg = SrvDirectorCommand(action=msg.action, payload=msg.payload)
    conn.match_store.broadcast_to_other_directors(conn, srv_msg)
    return  # 不需要回复 sender
```

## 验证方式

1. Chrome 开导播控制台（连某场比赛的 director WS）
2. OBS 开舞台页（同一账号、同比赛的 director WS）
3. 控制台点「待开始」场景按钮 → OBS 舞台应立即切到 Coming Soon 场景
4. 控制台设倒计时 60s → 开始 → OBS 舞台应显示倒计时数字
5. 控制台暂停 → OBS 舞台应显示暂停态
6. 用另一个导播账号连同一比赛 → 操作不应影响第一个导播的舞台（account_id 隔离）

## 不需要的

- 不需要持久化到数据库（指令是实时的瞬时操作）
- 不需要 REST API（纯 WS 指令）
- 不需要改 auth_ok 或握手流程
