# Tarou 战斗模块迁移

本次根据用户要求，将本机 `D:\gbf\Chrome-Extension-Tarou-main` 的战斗详情和战斗记录逻辑适配到当前 React 扩展。参考日期为 2026-10-20，接口形状来自本机源代码与类型声明，未用真实账号响应作为测试数据。

## 源码对应

| Tarou 参考模块 | 当前实现 |
| --- | --- |
| `src/composables/useDataCenter.ts` 的战斗响应分发 | `src/domain/battle/reduce.ts` 的接口匹配，经现有后台串行链路调用 |
| `src/composables/useBattleLog.ts` 的 start/scenario/伤害/回合处理 | `src/domain/battle/parse.ts`、`reduce.ts` 和 `model.ts` |
| `types/modules/source.d.ts` 的战斗响应类型 | unknown 输入、窄字段投影、数字/数组/布尔守卫；不直接信任外部类型 |
| `src/views/sidePanel/views/combat/` 的 BossCard、BossBuff、BattleAnalysis、PlayerStatus、DamageRecord、DamageTaken、NormalAttackInfo、ActionList | `src/panel/battle/BattleDetail.tsx` |
| `useBattleLog.ts` 的最近 10 场战斗及详情复用 | `src/domain/battle/storage.ts` 与 `src/panel/battle/BattlePanel.tsx`，本地持久化 |
| `src/views/popup/components/ExportRecord.vue` 的记录查看与导出用途 | 独立历史详情、单场/全部 JSON 导出；本项目 schemaVersion 1 格式 |
| `src/composables/useImage.ts` 的游戏静态资源地址 | `src/panel/battle/format.ts` 白名单资源路径与图片失败占位 |

当前框架、四个入口、TypeScript strict、React 和现有 Debug 沿用基础项目；没有引入 Vue、Element Plus、Pinia 或 Tarou 的全局业务状态。

页面按 Tarou `sidePanel/main.vue` 和 `useUtils.ts` 的 WindowPanel 窄窗口布局适配：默认 360×800，右侧 40px 导航，内容卡片约 300px。Boss 使用环形 HP，状态图标紧凑排列，角色统计使用头像和进度条，历史使用纵向统计卡片并可返回列表。宽窗口中仍保持卡片宽度，Debug 则可展开为左右两栏。未使用独立 combatPanel 的 1500×1000 默认布局或可拖拽模块。

## 响应入口

只观察游戏自行发起并收到的响应，不触发以下接口：

- `/rest/(raid|multiraid)/start.json`
- 同目录的 `normal_attack_result.json`、`ability_result.json`、`group_gauge_action_result.json`
- `summon_result.json`、`fatal_chain_result.json`
- `temporary_item_result.json`、`event_temporary_item_result.json`、`user_recovery.json`
- `guard_setting.json`、`special_skill_setting`：仅在响应明确给出状态时更新
- `/result(multi)/content/(index|skip_raid)/<Raid ID>`：匹配已知战斗并存在结果对象时标记结束，不推断胜利

接口路径是源项目实现的本地适配依据，后续游戏响应形状变化需补充人工样本再调整解析。

## 保留与适配

- Boss HP、状态效果、角色状态/护盾、召唤冷却、特殊量表与倒计时。
- 普攻/反击、技能、奥义、其他伤害；普攻/特动/其他承伤，保留无法归属的合计。
- 技能事件次数、奥义次数及有效 SA/DA/TA 样本；击杀中断的非 TA 样本不计入连击比率，沿用源逻辑。
- 每回合行动、伤害/承伤、普攻响应的 Hit/技伤/奥义/Chain 汇总，预兆和解除标记。
- 最近 10 场、同 Raid ID 刷新合并、按需读取历史详情、搜索和本地 JSON 导出/删除。
- 多 Boss 分别追踪；中途加入或重进提示统计缺失；总容量与回合/行动明细设有上限。

召唤与 Fatal Chain 伤害统一归入主人公“其他”，包含其响应中额外的伤害事件；这与 Tarou 对部分召唤追加伤害记入技能的实现有所区别。未找到可信角色归属的伤害不会丢弃，而是显示“未归属”。

## 当前边界

Tarou 原实现部分行动日志读取请求参数，包括技能目标/子选项、回复道具具体目标与奥义开关。当前项目保持响应监听边界：不读取请求体，响应未提供时显示通用行动或未知状态，不保证这些细节逐项一致。

Tarou 通过 debugger/WebSocket 获得的他人实时伤害、MVP、聊天、参战变化与部分 Boss 实时更新没有迁入。当前 Boss 与角色状态以已捕获 JSON 为准，参战者只显示最近一次进入时的匿名快照。个人状态效果不按用户 ID 筛选。

未迁入队伍/武器盘、构筑分享、云端记录、截图导出、通知、掉落、账号信息或游戏操作。记录以本地 JSON 导出，不与 Tarou 的持久化 schema 或云端格式互通；现有 Tarou 历史数据不会自动导入。

本机源项目未发现明确许可证文件，当前包保持 private / UNLICENSED；发布或再分发前应确认原项目授权条件。
