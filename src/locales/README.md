# 本地化（i18n）贡献指南 / Localization Contributor Guide

本目录存放 Twilight Cup 前端的所有界面文案翻译。应用基于
[vue-i18n](https://vue-i18n.intlify.dev/)，**简体中文（`zh-CN`）是源语言（权威 schema）**，
`en-US` 为仓库内提供的完整英文翻译。任何语言缺失的键会在运行时自动回退到 `zh-CN`。

## 文件格式

每个语言一个文件：`src/locales/<BCP47-tag>.ts`（如 `en-US.ts`、`ja-JP.ts`）。
文件 `export default` 一个**扁平对象**，键是带点分命名空间的字符串，值是字符串：

```ts
import type { MessageSchema } from "./zh-CN";

const messages: MessageSchema = {
  "common.save": "Save",
  "admin.matches.count": "{n} matches",
};

export default messages;
```

规则：

- **扁平键 + 点分命名空间**：`namespace.someKey`。不要嵌套对象——扁平结构最易编写、
  diff、排序与审查。
- **值是字符串**；含变量用 **命名插值** `{name}`，例如 `"胜方：{name}"`。
  变量名必须与源语言（`zh-CN.ts`）一致。
- **类型约束**：`import type { MessageSchema } from "./zh-CN"` 并标注
  `const messages: MessageSchema`，这样缺键/多键会在 `npm run typecheck` 时报错，
  保证各语言文件与源 schema 同构。
- 多行文本（如长说明）直接在字符串里用 `\n` 换行。
- 引号、标点、占位符不要随意增删；只翻译人类语言部分。

## 命名空间一览

| 前缀 | 用途 |
| --- | --- |
| `common.*` | 跨文件复用词（取消 / 保存 / 刷新 / 删除 / 编辑 / 操作 / 加载中 / 未知 …） |
| `seat.*` `phase.*` `playerStatus.*` `verdict.*` `matchStatus.*` `pickType.*` `scoring.*` `attemptStatus.*` `roundSource.*` `accountType.*` `tournamentStatus.*` `tourneyFormat.*` `fixtureStatus.*` `categoryKind.*` `ctTag.*` | 枚举→标签（集中在 `src/utils/format.ts` 使用） |
| `brand.*` `language.*` `theme.*` `conn.*` `role.*` | 品牌 / 语言切换 / 主题 / 连接状态 / 角色切换 |
| `login.*` `account.*` `settings.*` | 登录 / 账号菜单 / 账号设置 |
| `referee.*` `director.*` `directorView.*` `player.*` `pending.*` `authFail.*` `matchView.*` | 各端页面 |
| `matchHeader.*` `prep.*` `verdictPanel.*` `playerStatusCard.*` `countdown.*` `counter.*` `chat.*` `history.*` `banpick.*` `overlay.*` | 裁判端组件 / 叠加层 |
| `admin.*` `accountForm.*` `matchForm.*` `matchDetail.*` `mappoolEditor.*` `mappoolForm.*` `pickEditor.*` `tourneyForm.*` `members.*` `bracket.*` `fixtureAssign.*` `fixtureMatch.*` | 管理员端 |
| `toast.*` | Pinia store 里的命令式提示（`ElMessage` / `ElMessageBox`） |

## 如何新增一种语言

1. **复制** `en-US.ts`（或 `zh-CN.ts`）→ 重命名为 `<tag>.ts`（如 `ja-JP.ts`）。
   `<tag>` 用 [BCP47](https://www.rfc-editor.org/rfc/rfc5646) 语言标签。
2. **翻译** 所有值（保留键名与 `{var}` 不变）。
3. **注册**：打开 `./index.ts`，
   - 把 `<tag>` 加入 `SUPPORTED_LOCALES` 与 `LOCALES`（含 Element Plus locale 文件名 `ep`
     与下拉展示名 `label`）。
   - 在 `i18n` 的 `messages` 里 `import` 并登记。
4. （可选）**Element Plus 内置文案**：Element Plus 自带组件（分页、日期选择器、空状态等）
   会随语言切换。其 locale 文件位于 `element-plus/es/locale/lang/<ep>`；若该语言 EP 未提供，
   可保留 `ep` 为 `en` 或 `zh-cn` 兜底。
5. 运行 `npm run typecheck`（确保无缺键）与 `npm run build`，再 `npm run dev` 切到新语言验收。

## 校验

- `npm run typecheck`：`MessageSchema` 约束保证你的文件与 `zh-CN.ts` 同构（键齐全）。
- 开发模式下（`npm run dev`）控制台会对**缺失键**打印 `missingWarn`，对**回退**打印
  `fallbackWarn`——上线前请清零。

## 提交

欢迎以 Pull Request 贡献新语言。请在 PR 描述里注明语言标签、是否完整覆盖，以及（若适用）
Element Plus locale 来源。
