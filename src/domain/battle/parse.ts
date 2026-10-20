import { isRecord } from "../capture";
import type { BattleBoss, BattleBuff, BattleParticipant, BattlePlayer, BattleSummon, BattleTurn } from "./model";
import { emptyDamage, emptyTaken } from "./model";

export const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const rows = (value: unknown): Record<string, unknown>[] => list(value).filter(isRecord);
export function text(value: unknown, max = 200): string {
  return typeof value === "string" || typeof value === "number" ? String(value).slice(0, max) : "";
}
export function number(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= Number.MAX_SAFE_INTEGER ? result : null;
}
export function integer(value: unknown): number | null {
  const result = number(value);
  return result !== null && Number.isSafeInteger(result) ? result : null;
}
export function flag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}
export function name(value: unknown): string { return text(record(value).ja || record(value).en || value); }
export function percent(hp: number | null, max: number | null): number | null {
  return hp !== null && max !== null && max > 0 ? Math.min(100, Math.max(0, Math.ceil(hp / max * 10_000) / 100)) : null;
}

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

export function parseBosses(value: unknown): BattleBoss[] {
  return rows(record(value).param).slice(0, 10).map((boss, index) => ({
    index, name: name(boss.name) || text(boss.monster) || `敌人 ${index + 1}`,
    imageId: text(boss.cjs).split("_")[1] ?? "", level: text(boss.Lv), attribute: text(boss.attribute ?? boss.attr),
    hp: number(boss.hp), maxHp: number(boss.hpmax), buffs: parseBuffs(boss.condition)
  }));
}

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

export function parseFormation(value: unknown, abilities: unknown, playerCount: number): number[] {
  const fromAbility = Object.values(record(abilities)).map((item) => record(item).pos);
  const candidates = Array.isArray(value) ? value : fromAbility.length ? fromAbility : Array.from({ length: Math.min(4, playerCount) }, (_, index) => index);
  return [...new Set(candidates.map(integer).filter((pos): pos is number => pos !== null && pos < playerCount))].slice(0, 6);
}

export function parseOmens(value: unknown): string[] {
  return rows(value).flatMap((item) => list(item.interrupt_display_text).map((entry) => text(entry, 500))).filter(Boolean).slice(0, 10);
}

export function parseSummons(summons: unknown, supporter: unknown): BattleSummon[] {
  return [...rows(summons).slice(0, 6).map((item) => ({ name: name(item.name) || "召唤石", cooldown: text(item.recast) || null, supporter: false })),
    ...(isRecord(supporter) ? [{ name: name(supporter.name) || "支援召唤", cooldown: text(supporter.recast) || null, supporter: true }] : [])];
}

export function parseParticipants(value: unknown): BattleParticipant[] {
  return rows(value).slice(0, 100).map((item, slot) => ({
    slot, rank: text(item.level), attribute: text(item.pc_attribute), jobId: text(item.job_id),
    dead: flag(item.is_dead), host: flag(item.is_host), group: integer(item.group_num)
  }));
}

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

export const sumHits = (value: unknown): number => damageHits(value).reduce((total, hit) => total + hit.value, 0);
