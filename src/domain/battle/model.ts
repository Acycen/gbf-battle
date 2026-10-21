/**
 * 战斗领域层的持久化模型。
 *
 * 这里的类型是从游戏响应投影出的最小数据集，同时供 reducer、storage 和 panel 使用。
 * `null` 表示响应没有提供可信值；不要用默认值替代未知状态。
 */
export type DamageKind = "attack" | "ability" | "special" | "other";
export type TakenKind = "attack" | "super" | "other";
export type DamageTotals = Record<DamageKind, number>;
export type TakenTotals = Record<TakenKind, number>;

/** Boss 或角色身上最近一次观察到的状态效果。 */
export interface BattleBuff {
  id: string;
  name: string;
  detail: string;
  remaining: string | null;
  debuff: boolean;
}

/** Boss 数组中的稳定索引用于匹配 scenario 的 `pos`。 */
export interface BattleBoss {
  index: number;
  name: string;
  imageId: string;
  level: string;
  attribute: string;
  hp: number | null;
  maxHp: number | null;
  buffs: BattleBuff[];
}

/** 单个角色的当前状态及监听期间累计统计。 */
export interface BattlePlayer {
  /** 与 players 数组位置相同；scenario 的 `num` 通过它归属角色。 */
  index: number;
  id: string;
  name: string;
  imageId: string;
  npc: boolean;
  attribute: string;
  alive: boolean;
  hp: number | null;
  maxHp: number | null;
  shield: number;
  buffs: BattleBuff[];
  /** 伤害和承伤只累计已观察到的响应，不代表服务端最终结算。 */
  damage: DamageTotals;
  taken: TakenTotals;
  abilityUses: number;
  chargeAttacks: number;
  /** 仅保存满足有效样本规则的单攻/双攻/三攻次数。 */
  attacks: { total: number; sa: number; da: number; ta: number };
}

/** 一次普通攻击响应中，玩家阶段的命中与伤害摘要。 */
export interface AttackSummary {
  hits: number;
  total: number;
  ability: number;
  special: number;
  chain: number;
}

/** 时间线中的一次请求级行动；damage/taken 是该响应造成的统计增量。 */
export interface BattleAction {
  kind: "attack" | "ability" | "summon" | "fatal-chain" | "item" | "recovery" | "opening";
  label: string;
  actor: number | null;
  abilityId: string | null;
  at: string;
  damage: number;
  taken: number;
}

/**
 * 回合快照。行动先记入发起它的回合，响应中的新 turn 用于创建下一回合。
 * Guard、奥义开关和预兆缺失时保留 `null` 或上一回合状态，不主动推断。
 */
export interface BattleTurn {
  turn: number;
  hpPercent: number | null;
  omens: string[];
  cancelled: boolean;
  guards: Array<{ player: number; enabled: boolean | null }>;
  chargeAttackEnabled: boolean | null;
  actions: BattleAction[];
  attack: AttackSummary | null;
}

/** 召唤冷却只按响应中最后一次明确值更新。 */
export interface BattleSummon { name: string; cooldown: string | null; supporter: boolean }
/** 匿名参战快照，不保存昵称、用户 ID 或其他账号标识。 */
export interface BattleParticipant { slot: number; rank: string; attribute: string; jobId: string; dead: boolean | null; host: boolean | null; group: number | null }

/** 一场战斗的完整本地记录，也是 storage.local 中的持久化单元。 */
export interface BattleRecord {
  schemaVersion: 1;
  /** raidId 是刷新合并、结果页匹配和去重记录的主键。 */
  raidId: string;
  questId: string;
  name: string;
  startedAt: string;
  updatedAt: string;
  outcome: "active" | "won" | "lost" | "finished";
  turn: number;
  startTimer: number | null;
  timer: number | null;
  /** timer 本身是倒计时；更新时间用于面板在两次响应间继续显示倒计时。 */
  timerUpdatedAt: string;
  players: BattlePlayer[];
  bosses: BattleBoss[];
  formation: number[];
  summons: BattleSummon[];
  participants: BattleParticipant[];
  /** turns/actions 受容量上限约束；累计统计不会随旧时间线裁剪而减少。 */
  turns: BattleTurn[];
  /** 无法从 scenario 可靠定位角色的数值必须保留在未归属桶。 */
  unattributed: DamageTotals;
  unattributedTaken: TakenTotals;
  contribution: number;
  members: number | null;
  memberLimit: number | null;
  solo: boolean | null;
  /** reloaded 表示同 raid 再次收到 start；incomplete 表示统计存在观察缺口。 */
  reloaded: boolean;
  incomplete: boolean;
  timelineTruncated: boolean;
  received: number;
  /** 最近消息指纹仅用于运行时去重，导出时会移除。 */
  fingerprints: string[];
  genesis: number | null;
  specialRemaining: number | null;
  specialUpdatedAt: string;
}

/** 广播给面板列表的轻量摘要，不包含角色、状态和行动明细。 */
export interface BattleSummary {
  raidId: string;
  name: string;
  startedAt: string;
  updatedAt: string;
  turn: number;
  outcome: BattleRecord["outcome"];
  damage: number;
  taken: number;
  contribution: number;
  seconds: number | null;
  speed: number | null;
  solo: boolean | null;
  incomplete: boolean;
}

/** 面板可见的战斗状态；详情必须按 raidId 单独请求。 */
export interface BattleSnapshot { currentId: string | null; records: BattleSummary[]; error: string | null }
/** 后台内存及 storage.local 的顶层结构；tabId 仅表示当前来源关联。 */
export interface BattleStore { schemaVersion: 1; currentId: string | null; tabId: number | null; records: BattleRecord[]; error: string | null }

/** 每次创建独立对象，避免不同角色或战斗共享可变累计值。 */
export const emptyDamage = (): DamageTotals => ({ attack: 0, ability: 0, special: 0, other: 0 });
export const emptyTaken = (): TakenTotals => ({ attack: 0, super: 0, other: 0 });
export const emptyBattleStore = (): BattleStore => ({ schemaVersion: 1, currentId: null, tabId: null, records: [], error: null });
