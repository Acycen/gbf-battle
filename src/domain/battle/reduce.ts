import { isRecord } from "../capture";
import type { CapturePayload } from "../model";
import { emptyDamage, emptyTaken, type AttackSummary, type BattleAction, type BattleRecord, type BattleStore, type BattleTurn, type DamageKind, type TakenKind } from "./model";
import { damageHits, flag, integer, list, name, newTurn, number, parseBosses, parseBuffs, parseFormation, parseOmens, parseParticipants, parsePlayers, parseSummons, percent, record, rows, sumHits, text } from "./parse";

export const MAX_BATTLE_RECORDS = 10;
export const MAX_BATTLE_BYTES = 2 * 1024 * 1024;
export const MAX_TURNS = 200;
export const MAX_ACTIONS = 1000;
const RESULT_ROUTES: Record<string, BattleAction["kind"]> = {
  normal_attack_result: "attack", ability_result: "ability", group_gauge_action_result: "ability",
  summon_result: "summon", fatal_chain_result: "fatal-chain", temporary_item_result: "item",
  event_temporary_item_result: "item", user_recovery: "recovery"
};

export function battleRoute(url: string): string | null {
  const path = new URL(url).pathname;
  return /^\/rest\/(?:raid|multiraid)\/([a-z_]+?)(?:\.json)?$/u.exec(path)?.[1] ?? null;
}

function fingerprint(payload: CapturePayload): string {
  const input = JSON.stringify(payload.body);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `${payload.capturedAt}:${new URL(payload.url).pathname}:${hash >>> 0}`;
}

function actorIndex(value: unknown, battle: BattleRecord): number | null {
  const index = integer(value);
  return index !== null && battle.players[index] ? index : null;
}

function damageOwner(scenario: Record<string, unknown>[], index: number, battle: BattleRecord): { actor: number | null; kind: DamageKind } {
  let effectActor: number | null = null;
  for (let offset = index - 1; offset >= 0; offset -= 1) {
    const previous = scenario[offset]!;
    if (previous.cmd === "wait") break;
    if (["ability", "special", "special_npc"].includes(text(previous.cmd)) && previous.to !== "boss") return { actor: actorIndex(previous.num, battle), kind: "ability" };
    if (previous.cmd === "chain_cutin") return { actor: battle.formation[0] ?? null, kind: "other" };
    if (previous.cmd === "windoweffect") {
      const id = text(previous.kind).split("_")[2];
      const candidate = battle.players.findIndex((player) => player.id === id);
      if (candidate >= 0 && effectActor === null) effectActor = candidate;
    }
    if (["damage", "loop_damage"].includes(text(previous.cmd)) && effectActor !== null) return { actor: effectActor, kind: "ability" };
  }
  return { actor: null, kind: "other" };
}

function addDamage(battle: BattleRecord, actor: number | null, kind: DamageKind, amount: number): void {
  const totals = actor === null ? battle.unattributed : battle.players[actor]?.damage ?? battle.unattributed;
  totals[kind] += amount;
}

function addTaken(battle: BattleRecord, value: unknown, kind: TakenKind): void {
  for (const hit of damageHits(value)) {
    const player = hit.pos === null ? null : battle.players[battle.formation[hit.pos] ?? -1];
    (player?.taken ?? battle.unattributedTaken)[kind] += hit.value;
    if (player && hit.hp !== null) { player.hp = hit.hp; player.alive = hit.hp > 0; }
  }
}

export function totalDamage(battle: BattleRecord): number {
  return [...battle.players.map((player) => player.damage), battle.unattributed].reduce((total, damage) => total + Object.values(damage).reduce((sum, value) => sum + value, 0), 0);
}
export function totalTaken(battle: BattleRecord): number {
  return [...battle.players.map((player) => player.taken), battle.unattributedTaken].reduce((total, taken) => total + Object.values(taken).reduce((sum, value) => sum + value, 0), 0);
}

function applyScenario(battle: BattleRecord, scenario: Record<string, unknown>[], kind: BattleAction["kind"], turn: BattleTurn): AttackSummary {
  const summary: AttackSummary = { hits: 0, total: 0, ability: 0, special: 0, chain: 0 };
  let playerPhase = true;
  const abilityUses = new Set<string>();
  for (const [index, action] of scenario.entries()) {
    const cmd = text(action.cmd);
    if (cmd === "turn" && action.mode === "boss") playerPhase = false;
    if (cmd === "contribution") battle.contribution += number(action.amount) ?? 0;
    if (cmd === "ability" && action.to !== "boss") {
      const actor = actorIndex(action.num, battle);
      const key = `${actor}:${text(action.ability_id) || name(action.name)}`;
      if (actor !== null && !abilityUses.has(key)) { battle.players[actor]!.abilityUses += 1; abilityUses.add(key); }
    }
    let outgoing = 0;
    let damageKind: DamageKind = "other";
    let hits = 0;
    if (cmd === "attack" && action.from === "player") {
      const actor = actorIndex(action.num, battle);
      outgoing = sumHits(action.damage); damageKind = "attack";
      hits = damageHits(action.damage).filter((hit) => hit.value > 0).length;
      addDamage(battle, actor, damageKind, outgoing);
      if (actor !== null && !action.effect && scenario[index + 1]?.cmd === "normal_attack_end") {
        const attacks = integer(action.total_attack_num);
        const alive = damageHits(action.damage).every((hit) => hit.hp !== 0);
        if ((alive || attacks === 3) && attacks !== null && attacks >= 1 && attacks <= 3) {
          const stats = battle.players[actor]!.attacks;
          stats.total += 1;
          if (attacks === 1) stats.sa += 1;
          if (attacks === 2) stats.da += 1;
          if (attacks === 3) stats.ta += 1;
        }
      }
    } else if ((cmd === "special" || cmd === "special_npc") && action.from !== "boss" && action.to !== "player") {
      const actor = actorIndex(action.num, battle);
      outgoing = sumHits(action.list); damageKind = "special";
      hits = rows(action.total).length ? rows(action.total).filter((item) => list(item.split)[0] !== "0").length : damageHits(action.list).filter((hit) => hit.value > 0).length;
      if (actor !== null) battle.players[actor]!.chargeAttacks += 1;
      addDamage(battle, actor, damageKind, outgoing);
      if (playerPhase) summary.chain += 1;
    } else if ((cmd === "damage" || cmd === "loop_damage") && action.to === "boss") {
      const owner = kind === "summon" || kind === "fatal-chain" ? { actor: 0, kind: "other" as const } : damageOwner(scenario, index, battle);
      outgoing = sumHits(action.list); damageKind = owner.kind;
      hits = damageHits(action.list).filter((hit) => hit.value > 0).length;
      addDamage(battle, owner.actor, owner.kind, outgoing);
    } else if (cmd === "summon") {
      outgoing = sumHits(action.list);
      addDamage(battle, 0, "other", outgoing);
      hits = damageHits(action.list).filter((hit) => hit.value > 0).length;
    }
    if (playerPhase) {
      summary.hits += hits; summary.total += outgoing;
      if (damageKind === "ability") summary.ability += outgoing;
      if (damageKind === "special") summary.special += outgoing;
    }
    if (cmd === "attack" && action.from === "boss") addTaken(battle, action.damage, "attack");
    if (cmd === "super" && action.target === "player") addTaken(battle, action.list, "super");
    if ((cmd === "damage" || cmd === "loop_damage") && action.to === "player") addTaken(battle, action.list, "other");
    if (cmd === "boss_gauge") {
      const boss = battle.bosses[integer(action.pos) ?? 0];
      if (boss) {
        boss.hp = number(action.hp) ?? boss.hp;
        boss.maxHp = number(action.hpmax) ?? boss.maxHp;
        boss.name = name(action.name) || boss.name;
      }
    }
    if (cmd === "die" && action.to === "boss") {
      const boss = battle.bosses[integer(action.pos) ?? 0];
      if (boss) boss.hp = 0;
    }
    if ((cmd === "die" || cmd === "die_back") && action.to === "player" || cmd === "resurrection") {
      const player = battle.players[integer(action.index) ?? -1];
      if (player) { player.alive = cmd === "resurrection"; player.hp = player.alive ? number(action.hp) : 0; }
    }
    if (cmd === "resurrection_back" && battle.players[0]) battle.players[0].alive = true;
    if (cmd === "rematch") for (const player of battle.players) player.alive = true;
    if (cmd === "unique_gauge") battle.genesis = number(action.value) ?? battle.genesis;
    if (cmd === "special_skill_interrupt") turn.cancelled = true;
    if (cmd === "win" && flag(action.is_last_raid) === true) {
      battle.outcome = "won";
      for (const boss of battle.bosses) boss.hp = 0;
    }
    if (cmd === "lose") battle.outcome = "lost";
  }
  return summary;
}

function applyStatus(battle: BattleRecord, status: Record<string, unknown>, scenario: Record<string, unknown>[], turn: BattleTurn, at: string): void {
  const timer = number(status.timer);
  if (timer !== null) { battle.timer = timer; battle.timerUpdatedAt = at; }
  battle.turn = integer(status.turn) ?? battle.turn;
  battle.members = integer(status.fellow) ?? battle.members;
  if (battle.members !== null && battle.members > 1) battle.solo = false;
  const specialRemaining = number(record(status.unique_gauge_time_limit).rest_time);
  if (specialRemaining !== null) { battle.specialRemaining = specialRemaining; battle.specialUpdatedAt = at; }
  if (status.formation !== undefined) battle.formation = parseFormation(status.formation, null, battle.players.length);
  for (const action of scenario) {
    if (action.cmd === "condition") {
      if (action.to === "boss") {
        const boss = battle.bosses[integer(action.pos) ?? -1];
        if (boss) boss.buffs = parseBuffs(action.condition);
      }
      if (action.to === "player") {
        const player = battle.players[battle.formation[integer(action.pos) ?? -1] ?? -1];
        if (player) { player.buffs = parseBuffs(action.condition); player.shield = number(record(action.condition).coating_value) ?? 0; }
      }
    }
  }
  if (status.special_skill_indicate !== undefined && turn.turn === battle.turn) turn.omens = parseOmens(status.special_skill_indicate);
  const charge = flag(status.special_skill_flag);
  if (charge !== null && turn.turn === battle.turn) turn.chargeAttackEnabled = !charge;
  if (Array.isArray(status.is_guard_status) && turn.turn === battle.turn) turn.guards = battle.formation.map((player, slot) => ({ player, enabled: flag(record(list(status.is_guard_status)[slot]).is_guard_status) }));
  for (const [index, summon] of rows(status.summon).entries()) {
    const previous = battle.summons.filter((item) => !item.supporter)[index];
    if (previous && "recast" in summon) previous.cooldown = text(summon.recast) || null;
  }
  const supporter = battle.summons.find((item) => item.supporter);
  if (supporter && isRecord(status.supporter) && "recast" in status.supporter) supporter.cooldown = text(status.supporter.recast) || null;
}

function createBattle(body: Record<string, unknown>, at: string): BattleRecord | null {
  const raidId = text(body.raid_id);
  const bosses = parseBosses(body.boss);
  const players = parsePlayers(body.player);
  if (!raidId || raidId === "0" || !bosses.length || !players.length) return null;
  const formation = parseFormation(record(body.status).formation, body.ability, players.length);
  const turn = integer(body.turn) ?? 1;
  const status = { ...body, ...record(body.status) };
  const members = Array.isArray(body.multi_raid_member_info) ? body.multi_raid_member_info.length : null;
  return {
    schemaVersion: 1, raidId, questId: text(body.quest_id), name: text(record(rows(record(body.boss).param)[0]).monster) || bosses[0]!.name,
    startedAt: at, updatedAt: at, outcome: "active", turn, startTimer: number(body.timer), timer: number(body.timer), timerUpdatedAt: at,
    players, bosses, formation, summons: parseSummons(body.summon, body.supporter), participants: parseParticipants(body.multi_raid_member_info),
    turns: [newTurn(turn, bosses, formation, status)], unattributed: emptyDamage(), unattributedTaken: emptyTaken(),
    contribution: 0, members, memberLimit: integer(body.limit_number),
    solo: flag(body.multi) === false ? true : members === null ? null : members === 1,
    reloaded: false, incomplete: turn > 1, timelineTruncated: false, received: 0, fingerprints: [],
    genesis: record(body.unique_gauge).id === "genesis" ? number(record(body.unique_gauge).value) : null,
    specialRemaining: number(record(body.unique_gauge_time_limit).rest_time), specialUpdatedAt: at
  };
}

function refreshBattle(battle: BattleRecord, body: Record<string, unknown>): void {
  const freshPlayers = parsePlayers(body.player);
  const freshBosses = parseBosses(body.boss);
  if (freshBosses.length) battle.bosses = freshBosses;
  for (const fresh of freshPlayers) {
    const previous = battle.players[fresh.index];
    if (previous) Object.assign(previous, { alive: fresh.alive, hp: fresh.hp, maxHp: fresh.maxHp, buffs: fresh.buffs, shield: fresh.shield });
    else battle.players.push(fresh);
  }
  battle.reloaded = true;
  battle.incomplete = true;
  battle.turn = integer(body.turn) ?? battle.turn;
  battle.timer = number(body.timer) ?? battle.timer;
  battle.formation = parseFormation(record(body.status).formation, body.ability, battle.players.length);
  battle.summons = parseSummons(body.summon, body.supporter);
  battle.participants = parseParticipants(body.multi_raid_member_info);
}

function limitTimeline(battle: BattleRecord): void {
  while (battle.turns.length > MAX_TURNS) { battle.turns.shift(); battle.timelineTruncated = true; }
  let total = battle.turns.reduce((sum, turn) => sum + turn.actions.length, 0);
  for (const turn of battle.turns) {
    if (total <= MAX_ACTIONS) break;
    const count = Math.min(total - MAX_ACTIONS, turn.actions.length);
    turn.actions.splice(0, count); total -= count; battle.timelineTruncated = true;
  }
  battle.fingerprints = battle.fingerprints.slice(-256);
}

/** 迁移 Tarou 的 start / scenario 处理；外部输入始终经过窄投影，不保存账号资料。 */
export function reduceBattle(store: BattleStore, payload: CapturePayload): BattleStore {
  if (payload.status < 200 || payload.status >= 300 || payload.truncated || !isRecord(payload.body)) return store;
  const resultId = /^\/result(?:multi)?\/content\/(?:index|skip_raid)\/([0-9]+)(?:\/|$)/u.exec(new URL(payload.url).pathname)?.[1];
  if (resultId && isRecord(record(payload.body.option).result_data)) {
    const previous = store.records.find((battle) => battle.raidId === resultId);
    if (!previous || previous.outcome !== "active") return store;
    return { ...store, records: store.records.map((battle) => battle.raidId === resultId ? { ...battle, outcome: "finished", updatedAt: payload.capturedAt } : battle) };
  }
  const route = battleRoute(payload.url);
  if (!route || (route !== "start" && route !== "guard_setting" && route !== "special_skill_setting" && !RESULT_ROUTES[route])) return store;
  const body = payload.body;
  if (route === "start" && (!parseBosses(body.boss).length || !parsePlayers(body.player).length)) return store;
  const key = fingerprint(payload);
  const requestedId = text(body.raid_id ?? record(body.status).raid_id);
  let previous = store.records.find((battle) => battle.raidId === (requestedId || store.currentId));
  if (previous?.fingerprints.includes(key)) return store;
  if (route === "start" && !requestedId) return store;
  const created = route === "start" && !previous ? createBattle(body, payload.capturedAt) : null;
  if (!previous && !created) return store;
  if (route !== "start" && !Array.isArray(body.scenario) && route !== "guard_setting" && route !== "special_skill_setting") return store;
  const battle = created ?? structuredClone(previous!);
  const status = record(body.status);
  if (route === "start" && previous) refreshBattle(battle, body);
  const effectiveStatus = route === "start" ? { ...body, ...status } : status;
  let turn = battle.turns.at(-1);
  if (!turn || turn.turn !== battle.turn) {
    turn = newTurn(battle.turn, battle.bosses, battle.formation, effectiveStatus, turn);
    battle.turns.push(turn);
  }
  const scenario = rows(body.scenario);
  const kind = RESULT_ROUTES[route] ?? "opening";
  const before = totalDamage(battle);
  const beforeTaken = totalTaken(battle);
  if (!(route === "start" && previous)) {
    const attack = applyScenario(battle, scenario, kind, turn);
    if (kind === "attack") turn.attack = attack;
  }
  applyStatus(battle, effectiveStatus, scenario, turn, payload.capturedAt);
  if (route === "guard_setting") {
    for (const guard of Object.values(record(body.guard_status))) {
      const item = record(guard);
      const player = actorIndex(item.target_num, battle);
      const found = turn.guards.find((entry) => entry.player === player);
      if (found) found.enabled = flag(item.is_guard_status);
    }
  }
  if (route === "special_skill_setting") {
    const setting = flag(body.value);
    if (setting !== null) turn.chargeAttackEnabled = !setting;
  }
  if (RESULT_ROUTES[route] || route === "start" && !previous && scenario.length) {
    const marker = kind === "ability" ? scenario.find((action) => action.cmd === "ability" && action.to !== "boss") : kind === "summon" ? scenario.find((action) => action.cmd === "summon") : undefined;
    const labels: Record<BattleAction["kind"], string> = { attack: "攻击", ability: "技能", summon: "召唤", "fatal-chain": "Fatal Chain", item: "回复道具", recovery: "复活", opening: "开幕行动" };
    const action: BattleAction = {
      kind, label: name(marker?.name) || labels[kind], actor: actorIndex(marker?.num, battle),
      abilityId: text(marker?.ability_id) || null, at: payload.capturedAt, damage: totalDamage(battle) - before, taken: totalTaken(battle) - beforeTaken
    };
    turn.actions.push(action);
  }
  if (battle.turn !== turn.turn && battle.outcome === "active") battle.turns.push(newTurn(battle.turn, battle.bosses, battle.formation, effectiveStatus, turn));
  const boss = battle.bosses.find((item) => item.hp !== 0) ?? battle.bosses[0];
  if (boss) battle.turns.at(-1)!.hpPercent = percent(boss.hp, boss.maxHp);
  battle.updatedAt = payload.capturedAt;
  battle.received += 1;
  battle.fingerprints.push(key);
  limitTimeline(battle);
  return {
    ...store, currentId: route === "start" ? battle.raidId : store.currentId,
    records: [battle, ...store.records.filter((item) => item.raidId !== battle.raidId)].slice(0, MAX_BATTLE_RECORDS)
  };
}
