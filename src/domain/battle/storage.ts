import { byteLength, isJsonValue, isRecord } from "../capture";
import { emptyBattleStore, type BattleRecord, type BattleSnapshot, type BattleStore, type BattleSummary } from "./model";
import { MAX_BATTLE_BYTES, MAX_BATTLE_RECORDS, MAX_TURNS, MAX_ACTIONS, totalDamage, totalTaken } from "./reduce";

/** storage.local 内容跨 Service Worker 生命周期存在，必须按不可信外部数据重新校验。 */
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nullableNumber = (value: unknown): boolean => value === null || numeric(value);
const string = (value: unknown): value is string => typeof value === "string";
const nullableString = (value: unknown): boolean => value === null || string(value);
const date = (value: unknown): boolean => string(value) && Number.isFinite(Date.parse(value));
const nullableFlag = (value: unknown): boolean => value === null || typeof value === "boolean";
const totals = (value: unknown, keys: string[]): boolean => isRecord(value) && keys.every((key) => numeric(value[key]));
const buffs = (value: unknown): boolean => Array.isArray(value) && value.length <= 200 && value.every((item: unknown) => isRecord(item) &&
  string(item.id) && string(item.name) && string(item.detail) && nullableString(item.remaining) && typeof item.debuff === "boolean");

/**
 * 深度校验持久化战斗的完整结构和嵌套上限。
 * schemaVersion 只说明格式代际，不能代替字段、数值和容量校验。
 */
export function isBattleRecord(value: unknown): value is BattleRecord {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isJsonValue(value)) return false;
  return string(value.raidId) && value.raidId.length > 0 && value.raidId.length <= 200 && string(value.questId) && string(value.name) &&
    date(value.startedAt) && date(value.updatedAt) && date(value.timerUpdatedAt) && date(value.specialUpdatedAt) && ["active", "won", "lost", "finished"].includes(String(value.outcome)) &&
    numeric(value.turn) && Number.isSafeInteger(value.turn) && nullableNumber(value.startTimer) && nullableNumber(value.timer) &&
    numeric(value.contribution) && numeric(value.received) && nullableNumber(value.genesis) && nullableNumber(value.specialRemaining) &&
    nullableNumber(value.members) && nullableNumber(value.memberLimit) && nullableFlag(value.solo) &&
    [value.reloaded, value.incomplete, value.timelineTruncated].every((item) => typeof item === "boolean") &&
    totals(value.unattributed, ["attack", "ability", "special", "other"]) && totals(value.unattributedTaken, ["attack", "super", "other"]) &&
    Array.isArray(value.players) && value.players.length > 0 && value.players.length <= 12 && value.players.every((player: unknown, index: number) => isRecord(player) &&
      player.index === index && string(player.id) && string(player.name) && string(player.imageId) && string(player.attribute) &&
      typeof player.npc === "boolean" && typeof player.alive === "boolean" && nullableNumber(player.hp) && nullableNumber(player.maxHp) && numeric(player.shield) &&
      numeric(player.abilityUses) && numeric(player.chargeAttacks) && buffs(player.buffs) && totals(player.damage, ["attack", "ability", "special", "other"]) &&
      totals(player.taken, ["attack", "super", "other"]) && totals(player.attacks, ["total", "sa", "da", "ta"])) &&
    Array.isArray(value.bosses) && value.bosses.length > 0 && value.bosses.length <= 10 && value.bosses.every((boss: unknown, index: number) => isRecord(boss) &&
      boss.index === index && string(boss.name) && string(boss.imageId) && string(boss.level) && string(boss.attribute) && nullableNumber(boss.hp) && nullableNumber(boss.maxHp) && buffs(boss.buffs)) &&
    Array.isArray(value.formation) && value.formation.length <= 6 && value.formation.every((pos: unknown) => numeric(pos) && Number.isSafeInteger(pos) && pos < (value.players as unknown[]).length) &&
    Array.isArray(value.summons) && value.summons.length <= 7 && value.summons.every((summon: unknown) => isRecord(summon) && string(summon.name) && nullableString(summon.cooldown) && typeof summon.supporter === "boolean") &&
    Array.isArray(value.participants) && value.participants.length <= 100 && value.participants.every((member: unknown) => isRecord(member) && numeric(member.slot) &&
      string(member.rank) && string(member.attribute) && string(member.jobId) && nullableFlag(member.dead) && nullableFlag(member.host) && nullableNumber(member.group)) &&
    Array.isArray(value.fingerprints) && value.fingerprints.length <= 256 && value.fingerprints.every(string) &&
    Array.isArray(value.turns) && value.turns.length <= MAX_TURNS && value.turns.every((turn: unknown) => isRecord(turn) &&
      numeric(turn.turn) && nullableNumber(turn.hpPercent) && Array.isArray(turn.omens) && turn.omens.every(string) && typeof turn.cancelled === "boolean" &&
      nullableFlag(turn.chargeAttackEnabled) && Array.isArray(turn.guards) && turn.guards.every((guard: unknown) => isRecord(guard) && numeric(guard.player) && nullableFlag(guard.enabled)) &&
      (turn.attack === null || totals(turn.attack, ["hits", "total", "ability", "special", "chain"])) && Array.isArray(turn.actions) && turn.actions.length <= MAX_ACTIONS &&
      turn.actions.every((action: unknown) => isRecord(action) && ["attack", "ability", "summon", "fatal-chain", "item", "recovery", "opening"].includes(String(action.kind)) &&
        string(action.label) && nullableNumber(action.actor) && nullableString(action.abilityId) && date(action.at) && numeric(action.damage) && numeric(action.taken)));
}

/**
 * 将仓库压到 2 MiB 预算内。顺序为：淘汰旧战斗 → 裁剪当前战斗旧回合 →
 * 清空行动和状态说明 → 清空状态列表。若异常单场仍超限，则拒绝保存该记录。
 */
export function fitBattleStore(store: BattleStore): BattleStore {
  const result = { ...store, records: store.records.slice(0, MAX_BATTLE_RECORDS) };
  // 优先保留 currentId 对应战斗，通常也是 records[0]；其余从最旧记录开始淘汰。
  while (result.records.length > 1 && byteLength(result) > MAX_BATTLE_BYTES) {
    let index = result.records.length - 1;
    while (index >= 0 && result.records[index]?.raidId === result.currentId) index -= 1;
    result.records.splice(index < 0 ? result.records.length - 1 : index, 1);
  }
  if (byteLength(result) > MAX_BATTLE_BYTES && result.records[0]) {
    // 后续会原地裁剪，因此先克隆，避免容量检查修改调用方持有的战斗对象。
    const battle = structuredClone(result.records[0]);
    result.records[0] = battle;
    while (battle.turns.length > 1 && byteLength(result) > MAX_BATTLE_BYTES) { battle.turns.shift(); battle.timelineTruncated = true; }
    if (byteLength(result) > MAX_BATTLE_BYTES) {
      for (const turn of battle.turns) turn.actions = [];
      for (const entity of [...battle.players, ...battle.bosses]) for (const buff of entity.buffs) buff.detail = "";
      battle.timelineTruncated = true;
    }
    for (const entity of [...battle.players, ...battle.bosses]) {
      if (byteLength(result) <= MAX_BATTLE_BYTES) break;
      entity.buffs = [];
    }
    if (byteLength(result) > MAX_BATTLE_BYTES) {
      result.records = [];
      result.currentId = null;
      result.error = "战斗记录超过容量限制，已忽略异常记录；可重新进入战斗恢复统计。";
    }
  }
  return result;
}

/** 从 storage.local 恢复、去除无效/重复 raid，并再次执行当前容量策略。 */
export function restoreBattleStore(value: unknown): BattleStore {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) return emptyBattleStore();
  const result: BattleStore = {
    ...emptyBattleStore(), records: value.records.filter(isBattleRecord),
    currentId: typeof value.currentId === "string" ? value.currentId : null,
    tabId: numeric(value.tabId) && Number.isSafeInteger(value.tabId) ? value.tabId : null
  };
  result.records = result.records.filter((battle, index, records) => records.findIndex((other) => other.raidId === battle.raidId) === index);
  if (!result.records.some((battle) => battle.raidId === result.currentId)) result.currentId = null;
  return fitBattleStore(result);
}

/** 生成列表与广播所需摘要；跑速单位为百万伤害/分钟。 */
export function summarizeBattle(battle: BattleRecord): BattleSummary {
  const seconds = battle.startTimer !== null && battle.timer !== null && battle.startTimer >= battle.timer ? battle.startTimer - battle.timer : null;
  const damage = totalDamage(battle);
  return {
    raidId: battle.raidId, name: battle.name, startedAt: battle.startedAt, updatedAt: battle.updatedAt,
    turn: battle.turn, outcome: battle.outcome, damage, taken: totalTaken(battle), contribution: battle.contribution,
    seconds, speed: seconds !== null && seconds > 0 ? damage / seconds * 60 / 1_000_000 : null, solo: battle.solo, incomplete: battle.incomplete
  };
}

/** 广播只包含摘要，避免把角色数组和时间线复制到每次 STATE_UPDATED。 */
export function battleSnapshot(store: BattleStore): BattleSnapshot {
  return { currentId: store.currentId, records: store.records.map(summarizeBattle), error: store.error };
}

/** 消息指纹属于内部去重元数据，不进入用户导出的 JSON。 */
export function exportBattle(battle: BattleRecord): Omit<BattleRecord, "fingerprints"> {
  const { fingerprints: _fingerprints, ...result } = battle;
  return result;
}
