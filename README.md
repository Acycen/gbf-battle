# GBF Battle

基于 `../gbf-solomonis-assist` 基础架构搭建的 Chrome Manifest V3 扩展，迁入 `../Chrome-Extension-Tarou-main` 的战斗详情与记录逻辑，并保留被动 JSON 响应监听和独立 Debug 面板。

技术栈沿用 Node.js 20（至少 20.9）、npm、TypeScript strict、Webpack 5、React 19。依赖版本沿用原项目的 lockfile；四个独立入口保持 `background.js`、`content.js`、`page.js`、`panel.js`。

## 当前能力

- 点击游戏页上的扩展图标，开始监听并打开/聚焦独立面板。
- 默认窗口为 360×800，采用 Tarou 窄面板风格：右侧导航、约 300px 卡片、Boss 血量环和紧凑伤害条；监听设置可折叠。已有窗口关闭后重开应用新默认尺寸。
- 面板中选择游戏标签页、开始/停止监听；切换来源清空旧标签页 Debug，并等待新来源的战斗初始响应，历史战斗保留。
- 战斗详情：多个 Boss 的 HP 与状态效果、角色状态与护盾、召唤冷却、匿名参战快照。
- 统计角色普攻/反击、技能、奥义、其他伤害及承伤，显示技能/奥义次数和有效 SA/DA/TA 样本。
- 按回合查看技能、攻击、召唤、Fatal Chain、回复行动及伤害、Hit、预兆和 Guard/奥义状态；未知字段不推断。
- 本地保留最近 10 场战斗，支持搜索、重看详情、单场/全部 JSON 导出、删除和清空；刷新同一战斗保留已捕获统计。
- 被动观察两个允许域名下的 fetch / XMLHttpRequest JSON 响应，战斗以外的响应仍可在 Debug 查看。
- 查看时间、路径、方法、HTTP 状态、来源和 JSON 正文，按路径、来源、状态筛选。
- 导出单条或全部脱敏 Debug 记录，单独清空 Debug 会话记录。
- 使用 `storage.session` 恢复 Service Worker 状态；刷新游戏页后通过握手恢复监听。
- 关闭来源标签页或跳转到其他域名后停止监听；停止时保留已有记录。
- 保存失败时继续使用内存实时监听，并在面板显示错误。

迁移范围与 Tarou 模块对应关系见 [迁移说明](docs/TAROU_MIGRATION.md)。队伍/武器盘、掉落、聊天/MVP、云上传及游戏操作不在本次范围内。

## 开发与构建

```bash
npm ci
npm run dev       # 开发构建并监听文件变化
npm run check     # 测试、类型检查、生产构建
npm run package   # 完整检查和不含 sourcemap 的发布 ZIP
```

`dist/` 为可直接加载的扩展目录；发布包为 `release/gbf-battle-v0.1.0.zip`。

1. 在 Chrome 111 或更高版本打开 `chrome://extensions`，启用开发者模式。
2. 选择“加载已解压的扩展程序”，加载本项目 `dist/`。
3. 刷新已打开的 GBF 游戏页，再点击扩展图标；也可在面板中选择来源后开始监听。
4. 开始监听后进入或刷新战斗页，收到 `start.json` 后初始化战斗详情；在游戏内手动操作后更新统计。
5. 右侧图标切换“战斗详情 / 战斗记录 / 数据 Debug”；记录卡片点击后进入详情，可返回列表。未捕获初始响应时，先刷新战斗页。

修改源码后等待重新构建，在扩展管理页重新加载扩展，再刷新游戏页。只刷新面板不会更新已注入页面的采集器。

## 监听与数据边界

仅允许 `https://game.granbluefantasy.jp/*`、`https://gbf.game.mbga.jp/*`，覆盖其所有路径，不保留 Solomonis 专属的路由筛选。

采集器不主动发请求，不自动点击，不读取请求头、请求体或 Cookie，不修改游戏 DOM。React 仅运行于扩展页面。面板 CSP 禁止 fetch/WebSocket 等连接；角色、Boss 和状态图标仅使用源项目中的游戏静态图片地址，没有远程代码和遥测。图片不可用时显示占位。

原始 JSON 在 MAIN world 内先复制脱敏，跨 world 和后台两次校验；不改变游戏收到的原始响应。URL 去除 query/hash，常见认证字段及用户标识按字段名递归遮盖。字段脱敏无法保证任意响应完全匿名，个人导出请留在本机，不要提交账号响应或 HAR。

Debug 最多保留最新 100 条且序列化历史约不超过 700 KB；脱敏正文超过 512 KB 时只保留元数据。Fetch 克隆读取超过 2 MiB 时跳过；XHR 文本超过约 2 MiB 时跳过。非 JSON、二进制、流式响应、深度超过 64 层或节点过多的对象会忽略。只捕获启用之后发起且在同一监听会话内完成的请求；不补取历史数据。关闭面板不停止监听，浏览器重启清空 Debug 会话。

战斗记录使用独立的 `storage.local`，浏览器重启后仍保留，最多 10 场且总预算 2 MiB。每场最多保留 200 回合、1000 条行动，必要时省略旧明细，累计伤害保留。超出总预算优先淘汰旧战斗。记录只保存必要战斗字段，不保存参战者昵称、用户 ID、请求参数或完整原始响应。统计仅涵盖已观察到的响应；中途加入、刷新或停止监听期间的缺失行动不会补算。JSON 导出是本项目格式，不支持直接导入 Tarou 的旧记录。

## 权限

只声明 `storage` 和上述两个主机范围。`storage.session` 用于 Debug 临时会话，`storage.local` 用于战斗历史；主机授权及 content matches 用于注入采集器，并读取匹配游戏标签页的 URL。窗口创建/聚焦和 tab 消息使用 Chrome 已有 API，不申请额外的 `tabs`、`windows`、`webRequest`、`debugger` 或 `cookies` 权限。

Chrome API 参考：[content scripts / MAIN world](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)、[storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage)、[windows](https://developer.chrome.com/docs/extensions/reference/api/windows)。

## 目录

```text
src/page/        MAIN world：被动采集和首次脱敏
src/content/     ISOLATED world：消息校验与转发、握手
src/background/  Service Worker：监听来源、写队列、会话、窗口
src/panel/       React 战斗详情、历史和 Debug 面板
src/panel/battle/ 战斗视图、记录列表与导出
src/domain/      纯 TypeScript：数据模型、脱敏、预算和守卫
src/domain/battle/ 战斗模型、响应解析、统计、历史恢复与预算
src/shared/      跨执行环境消息协议
public/          Manifest
scripts/         发布打包
tests/           人工构造数据的监听、战斗统计与生命周期测试
docs/            架构和手工验收步骤
```

详见 [架构说明](docs/ARCHITECTURE.md)。
