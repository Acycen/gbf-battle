import { isRecord } from "../capture";
import type { BattleBoss, BattleBuff, BattleParticipant, BattlePlayer, BattleSummon, BattleTurn } from "./model";
import { emptyDamage, emptyTaken } from "./model";

/**
 * 从 unknown 游戏数据提取有限字段的窄投影工具。
 * 所有函数都容忍字段缺失和类型漂移，并对字符串、数组及数值设置上限。
 */
export const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const rows = (value: unknown): Record<string, unknown>[] => list(value).filter(isRecord);

/** 接受游戏常见的字符串/数字混用，并截断展示文本。 */
export function text(value: unknown, max = 200): string {
  return typeof value === "string" || typeof value === "number" ? String(value).slice(0, max) : "";
}

/** 只接受有限、非负且可安全保存的数值。 */
export function number(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= Number.MAX_SAFE_INTEGER ? result : null;
}

/** 数组位置、回合数等索引字段必须是安全整数。 */
export function integer(value: unknown): number | null {
  const result = number(value);
  return result !== null && Number.isSafeInteger(result) ? result : null;
}

/** 将游戏常见的 boolean、0/1 和 "0"/"1" 统一为三态值。 */
export function flag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}
/** 优先日文名、再取英文名；两者都不存在时接受标量名称。 */
export function name(value: unknown): string { return text(record(value).ja || record(value).en || value); }
/** HP 百分比向上保留两位，并限制在进度条可显示的 0–100。 */
export function percent(hp: number | null, max: number | null): number | null {
  return hp !== null && max !== null && max > 0 ? Math.min(100, Math.max(0, Math.ceil(hp / max * 10_000) / 100)) : null;
}

/** 合并 buff/debuff 并按状态 ID 去重，避免同一图标重复展示。 */
export function parseBuffs(value: unknown): BattleBuff[] {
  const condition = record(value);
  const result: BattleBuff[] = [];
  for (const [items, debuff] of [[condition.buff, false], [condition.debuff, true]] as const) {
    for (const item of rows(items).slice(0, 100)) {
      const id = text(item.status);
      if (!id || result.some((buff) => buff.id === id)) continue;
      result.push({ id, name: name(item.name) || id, detail: text(item.detail, 1000), remaining: text(item.remain) || null, debuff });
    }
  }
  return result;
}

/** 从 start 响应的 boss.param 投影最多十个 Boss。 */
export function parseBosses(value: unknown): BattleBoss[] {
  return rows(record(value).param).slice(0, 10).map((boss, index) => ({
    index, name: name(boss.name) || text(boss.monster) || `敌人 ${index + 1}`,
    imageId: text(boss.cjs).split("_")[1] ?? "", level: text(boss.Lv), attribute: text(boss.attribute ?? boss.attr),
    hp: number(boss.hp), maxHp: number(boss.hpmax), buffs: parseBuffs(boss.condition)
  }));
}

/** 从 start 响应建立角色基线；累计统计在此统一归零。 */
export function parsePlayers(value: unknown): BattlePlayer[] {
  return rows(record(value).param).slice(0, 12).map((player, index) => {
    const id = text(player.pid).split("_")[0] ?? "";
    return {
      index, id, name: index === 0 && !text(player.cjs).startsWith("npc") ? "主人公" : name(player.name) || `角色 ${index + 1}`,
      imageId: text(player.pid_image) || `${id}_01`, npc: text(player.cjs).startsWith("npc"), attribute: text(player.attr),
      alive: flag(player.alive) ?? number(player.hp) !== 0, hp: number(player.hp), maxHp: number(player.hpmax),
      shield: number(record(player.condition).coating_value) ?? 0, buffs: parseBuffs(player.condition),
      damage: emptyDamage(), taken: emptyTaken(), abilityUses: 0, chargeAttacks: 0, attacks: { total: 0, sa: 0, da: 0, ta: 0 }
    };
  });
}

/**
 * 阵型优先使用 status.formation，其次使用 ability 中的 pos，最后才按前四名回退。
 * 候选值会去重并限制在已知角色范围内，绝不根据缺失参数猜测换位。
 */
export function parseFormation(value: unknown, abilities: unknown, playerCount: number): number[] {
  const fromAbility = Object.values(record(abilities)).map((item) => record(item).pos);
  const candidates = Array.isArray(value) ? value : fromAbility.length ? fromAbility : Array.from({ length: Math.min(4, playerCount) }, (_, index) => index);
  return [...new Set(candidates.map(integer).filter((pos): pos is number => pos !== null && pos < playerCount))].slice(0, 6);
}

/** 预兆文本可能分散在多个条目中；扁平化后限制数量和单条长度。 */
export function parseOmens(value: unknown): string[] {
  return rows(value).flatMap((item) => list(item.interrupt_display_text).map((entry) => text(entry, 500))).filter(Boolean).slice(0, 10);
}

/** 保存最多六颗自有召唤和一颗支援召唤，不保留额外原始字段。 */
export function parseSummons(summons: unknown, supporter: unknown): BattleSummon[] {
  return [...rows(summons).slice(0, 6).map((item) => ({ name: name(item.name) || "召唤石", cooldown: text(item.recast) || null, supporter: false })),
    ...(isRecord(supporter) ? [{ name: name(supporter.name) || "支援召唤", cooldown: text(supporter.recast) || null, supporter: true }] : [])];
}

/** 参战者仅保留匿名展示所需字段，数组位置作为本地 slot。 */
export function parseParticipants(value: unknown): BattleParticipant[] {
  return rows(value).slice(0, 100).map((item, slot) => ({
    slot, rank: text(item.level), attribute: text(item.pc_attribute), jobId: text(item.job_id),
    dead: flag(item.is_dead), host: flag(item.is_host), group: integer(item.group_num)
  }));
}

/**
 * 创建回合快照。响应没有明确给出预兆或奥义开关时沿用上一回合，
 * Guard 则按当前阵型逐项读取，缺失项保持未知。
 */
export function newTurn(turn: number, bosses: BattleBoss[], formation: number[], status: Record<string, unknown>, fallback?: BattleTurn): BattleTurn {
  const boss = bosses.find((item) => item.hp !== 0) ?? bosses[0];
  const flagValue = flag(status.special_skill_flag);
  return {
    turn, hpPercent: boss ? percent(boss.hp, boss.maxHp) : null,
    omens: status.special_skill_indicate !== undefined ? parseOmens(status.special_skill_indicate) : fallback?.omens.slice() ?? [],
    cancelled: false,
    guards: formation.map((player, slot) => ({ player, enabled: flag(record(list(status.is_guard_status)[slot]).is_guard_status) })),
    chargeAttackEnabled: flagValue === null ? fallback?.chargeAttackEnabled ?? null : !flagValue,
    actions: [], attack: null
  };
}

/** 单段伤害的窄投影；pos 是前排槽位而非 players 数组索引。 */
export interface DamageHit { value: number; pos: number | null; hp: number | null }
/** 只遍历已确认的伤害容器，遇到 value 叶子即停止，避免把额外汇总字段重复累计。 */
export function damageHits(value: unknown): DamageHit[] {
  const hits: DamageHit[] = [];
  const pending: unknown[] = [value];
  while (pending.length && hits.length < 20_000) {
    const current = pending.pop();
    if (Array.isArray(current)) { for (let index = current.length - 1; index >= 0; index -= 1) pending.push(current[index]); continue; }
    if (!isRecord(current)) continue;
    if ("value" in current) {
      const amount = number(current.value);
      if (amount !== null) hits.push({ value: amount, pos: integer(current.pos), hp: number(current.hp) });
    } else {
      const children = Object.values(current);
      for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]);
    }
  }
  return hits;
}

/** 对同一伤害容器复用 damageHits 的叶子规则，避免汇总字段重复相加。 */
export const sumHits = (value: unknown): number => damageHits(value).reduce((total, hit) => total + hit.value, 0);
