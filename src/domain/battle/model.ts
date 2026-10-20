export type DamageKind = "attack" | "ability" | "special" | "other";
export type TakenKind = "attack" | "super" | "other";
export type DamageTotals = Record<DamageKind, number>;
export type TakenTotals = Record<TakenKind, number>;

export interface BattleBuff {
  id: string;
  name: string;
  detail: string;
  remaining: string | null;
  debuff: boolean;
}

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

export interface BattlePlayer {
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
  damage: DamageTotals;
  taken: TakenTotals;
  abilityUses: number;
  chargeAttacks: number;
  attacks: { total: number; sa: number; da: number; ta: number };
}

export interface AttackSummary {
  hits: number;
  total: number;
  ability: number;
  special: number;
  chain: number;
}

export interface BattleAction {
  kind: "attack" | "ability" | "summon" | "fatal-chain" | "item" | "recovery" | "opening";
  label: string;
  actor: number | null;
  abilityId: string | null;
  at: string;
  damage: number;
  taken: number;
}

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

export interface BattleSummon { name: string; cooldown: string | null; supporter: boolean }
export interface BattleParticipant { slot: number; rank: string; attribute: string; jobId: string; dead: boolean | null; host: boolean | null; group: number | null }

export interface BattleRecord {
  schemaVersion: 1;
  raidId: string;
  questId: string;
  name: string;
  startedAt: string;
  updatedAt: string;
  outcome: "active" | "won" | "lost" | "finished";
  turn: number;
  startTimer: number | null;
  timer: number | null;
  timerUpdatedAt: string;
  players: BattlePlayer[];
  bosses: BattleBoss[];
  formation: number[];
  summons: BattleSummon[];
  participants: BattleParticipant[];
  turns: BattleTurn[];
  unattributed: DamageTotals;
  unattributedTaken: TakenTotals;
  contribution: number;
  members: number | null;
  memberLimit: number | null;
  solo: boolean | null;
  reloaded: boolean;
  incomplete: boolean;
  timelineTruncated: boolean;
  received: number;
  fingerprints: string[];
  genesis: number | null;
  specialRemaining: number | null;
  specialUpdatedAt: string;
}

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

export interface BattleSnapshot { currentId: string | null; records: BattleSummary[]; error: string | null }
export interface BattleStore { schemaVersion: 1; currentId: string | null; tabId: number | null; records: BattleRecord[]; error: string | null }

export const emptyDamage = (): DamageTotals => ({ attack: 0, ability: 0, special: 0, other: 0 });
export const emptyTaken = (): TakenTotals => ({ attack: 0, super: 0, other: 0 });
export const emptyBattleStore = (): BattleStore => ({ schemaVersion: 1, currentId: null, tabId: null, records: [], error: null });
