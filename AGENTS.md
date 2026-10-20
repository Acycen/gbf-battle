# GBF Battle

本仓库包含 Chrome MV3 基础框架、被动 JSON 监听 Debug，以及从 `Chrome-Extension-Tarou-main` 适配的战斗详情与本地记录。技术栈沿用 `gbf-solomonis-assist`：Node.js 20、npm、TypeScript strict、Webpack 5、React 19。

- 先读 README.md、docs/ARCHITECTURE.md 与 docs/TAROU_MIGRATION.md。新增其他业务模块需用户明确要求。
- `page` 最小采集；`content` 校验桥接；`background` 生命周期与会话；`panel` 独立 UI；`domain` 纯函数；`shared` 协议。
- 不主动调用游戏接口，不自动操作游戏，不修改游戏 DOM。
- 不读取请求体、请求头和 Cookie，不记录认证信息，不提交真实账号响应或 HAR。
- 原始正文在 MAIN 中脱敏后才能跨边界。来源、消息、会话与容量校验必须同步维护。
- 外部数据使用 unknown 和类型守卫；不得使用 any 绕过检查。
- 保持四个 Webpack 入口及最小权限，不引入远程代码、eval、遥测或额外包管理器。
- 修改监听或协议时验证全链路，测试使用人工构造的脱敏数据。
- 战斗解析保持纯函数；未知字段用 null，无法归属的伤害单列。请求参数缺失时不能推断目标、子选项或开关值。
- Debug 使用 storage.session，战斗历史独立使用 storage.local。广播摘要、按需获取详情；维护最近 10 场、容量与明细限制，清空 Debug 不得清空战斗历史。
- 完成后运行 `npm run check`；打包使用 `npm run package`。
- 浏览器手工验收步骤见 docs/ARCHITECTURE.md；未实际执行时不能宣称通过。
