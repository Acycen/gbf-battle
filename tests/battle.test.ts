import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { byteLength } from "../src/domain/capture";
import { emptyBattleStore, type BattleRecord } from "../src/domain/battle/model";
import { battleRoute, MAX_BATTLE_BYTES, MAX_BATTLE_RECORDS, reduceBattle, totalDamage, totalTaken } from "../src/domain/battle/reduce";
import { battleSnapshot, exportBattle, fitBattleStore, isBattleRecord, restoreBattleStore, summarizeBattle } from "../src/domain/battle/storage";
import { BattleDetail, ActionTimeline } from "../src/panel/battle/BattleDetail";
import { assetUrl, duration } from "../src/panel/battle/format";
import { actionBody, battleCapture, startBody } from "./fixtures/battle";

function started() { return reduceBattle(emptyBattleStore(), battleCapture("start", startBody())); }
function current(store: ReturnType<typeof started>): BattleRecord { assert.ok(store.records[0]); return store.records[0]; }

test("从 start 初始化战斗、Boss、角色与预兆，不迁入账号信息", () => {
  const store = started();
  const battle = current(store);
  assert.equal(store.currentId, "1001");
  assert.equal(battle.name, "人工样本副本");
  assert.equal(battle.bosses[0]?.name, "検証用の敵");
  assert.equal(battle.bosses[0]?.hp, 100000);
  assert.equal(battle.players.length, 6);
  assert.deepEqual(battle.formation, [0, 1, 2, 3]);
  assert.deepEqual(battle.turns[0]?.omens, ["测试预兆"]);
  assert.equal(battle.turns[0]?.chargeAttackEnabled, false);
  assert.ok(battle.turns[0]?.guards.every((guard) => guard.enabled === null));
  assert.equal(battle.players[0]?.name, "主人公");
  assert.equal(JSON.stringify(store).includes("private"), false);
  assert.ok(isBattleRecord(battle));
  assert.equal(battleRoute("https://game.granbluefantasy.jp/rest/multiraid/ability_result.json"), "ability_result");
});

test("普攻、技能、奥义、连锁、召唤、循环伤害及承伤按 Tarou 规则累计", () => {
  const initial = started();
  const store = reduceBattle(initial, battleCapture("normal_attack_result", actionBody([
    { cmd: "attack", from: "player", num: 0, total_attack_num: 1, damage: [[{ value: 100, hp: 99900, pos: 0 }]] },
    { cmd: "normal_attack_end" },
    { cmd: "ability", num: 1, name: { ja: "検証技能" }, ability_id: "fixture-ability" },
    { cmd: "damage", to: "boss", list: [{ value: "200" }] },
    { cmd: "special_npc", num: 2, list: [{ damage: [{ value: 300 }] }], total: [{ split: ["300"] }] },
    { cmd: "chain_cutin" }, { cmd: "damage", to: "boss", list: [{ value: 400 }] },
    { cmd: "summon", list: [{ damage: [{ value: 500 }] }] },
    { cmd: "wait" }, { cmd: "damage", to: "boss", list: [{ value: 50 }] },
    { cmd: "ability", num: 3, name: "循环技能" }, { cmd: "loop_damage", to: "boss", list: [[{ value: 60 }, { value: 70 }]] },
    { cmd: "contribution", amount: 123.5 },
    { cmd: "turn", mode: "boss" },
    { cmd: "attack", from: "boss", damage: [[{ pos: 1, value: 30, hp: 970 }]] },
    { cmd: "super", target: "player", list: [{ damage: [{ pos: 2, value: 40 }] }] },
    { cmd: "damage", to: "player", list: [{ pos: 3, value: 50 }] },
    { cmd: "boss_gauge", pos: 0, hp: 90000, name: { ja: "検証用の敵" } },
    { cmd: "condition", to: "player", pos: 0, condition: { buff: [{ status: "fixture-new", name: "测试增益" }], coating_value: 100 } }
  ], { formation: ["1", "2", "3", "4"] })));
  const battle = current(store);
  assert.equal(totalDamage(battle), 1680);
  assert.equal(totalTaken(battle), 120);
  assert.deepEqual(battle.players[0]?.damage, { attack: 100, ability: 0, special: 0, other: 900 });
  assert.equal(battle.players[1]?.damage.ability, 200);
  assert.equal(battle.players[2]?.damage.special, 300);
  assert.equal(battle.players[3]?.damage.ability, 130);
  assert.equal(battle.unattributed.other, 50);
  assert.equal(battle.players[1]?.taken.attack, 30);
  assert.equal(battle.players[2]?.taken.super, 40);
  assert.equal(battle.players[3]?.taken.other, 50);
  assert.equal(battle.players[1]?.shield, 100);
  assert.equal(battle.players[1]?.buffs[0]?.name, "测试增益");
  assert.equal(battle.players[1]?.abilityUses, 1);
  assert.equal(battle.players[2]?.chargeAttacks, 1);
  assert.equal(battle.players[0]?.attacks.sa, 1);
  assert.equal(battle.turns[0]?.actions[0]?.label, "攻击");
  assert.equal(battle.turns[0]?.attack?.total, 1680);
  assert.equal(battle.turns[0]?.attack?.hits, 8);
  assert.equal(battle.turns[1]?.turn, 2);
  assert.equal(battle.contribution, 123.5);
  assert.equal(summarizeBattle(battle).seconds, 10);
  assert.equal(totalDamage(current(initial)), 0);
  assert.ok(isBattleRecord(battle));
});

test("重复消息去重、相同数值的新行动计入，刷新仅合并状态", () => {
  let store = started();
  const payload = battleCapture("ability_result", actionBody([
    { cmd: "ability", num: 1 }, { cmd: "damage", to: "boss", list: [{ value: 200 }] }
  ], { turn: 1 }));
  store = reduceBattle(store, payload);
  assert.equal(reduceBattle(store, payload), store);
  store = reduceBattle(store, { ...payload, capturedAt: "2026-10-20T02:00:00.000Z" });
  assert.equal(totalDamage(current(store)), 400);
  const reload = { ...startBody(), turn: 2, timer: 580, scenario: [{ cmd: "damage", to: "boss", list: [{ value: 999 }] }] };
  store = reduceBattle(store, battleCapture("start", reload));
  assert.equal(store.records.length, 1);
  assert.equal(current(store).reloaded, true);
  assert.equal(current(store).incomplete, true);
  assert.equal(totalDamage(current(store)), 400);
  assert.ok(isBattleRecord(current(store)));
});

test("多 Boss 单体死亡不结算整场，胜利/全灭/结果页正确标记", () => {
  const body = startBody();
  const boss = body.boss as { param: unknown[] };
  boss.param.push({ name: { ja: "第二个测试敌人" }, cjs: "enemy_fixture2", hp: "20000", hpmax: 20000 });
  let store = reduceBattle(emptyBattleStore(), battleCapture("start", body));
  store = reduceBattle(store, battleCapture("normal_attack_result", actionBody([{ cmd: "die", to: "boss", pos: 1 }])));
  assert.equal(current(store).bosses[0]?.hp, 100000);
  assert.equal(current(store).bosses[1]?.hp, 0);
  assert.equal(current(store).outcome, "active");
  const won = reduceBattle(store, battleCapture("normal_attack_result", actionBody([{ cmd: "win", is_last_raid: true }])));
  assert.equal(current(won).outcome, "won");
  const lost = reduceBattle(store, battleCapture("normal_attack_result", actionBody([{ cmd: "lose" }])));
  assert.equal(current(lost).outcome, "lost");
  const finished = reduceBattle(store, battleCapture("ignored", { option: { result_data: {} } }, { url: "https://game.granbluefantasy.jp/resultmulti/content/index/1001" }));
  assert.equal(current(finished).outcome, "finished");
});

test("换位前阵型用于承伤；死亡、复活、Guard、奥义和预兆解除可更新", () => {
  let store = started();
  const previousTimerAt = current(store).timerUpdatedAt;
  const previousSpecialAt = current(store).specialUpdatedAt;
  store = reduceBattle(store, battleCapture("guard_setting", { guard_status: { 0: { target_num: 0, is_guard_status: 1 } } }));
  assert.equal(current(store).turns[0]?.guards[0]?.enabled, true);
  assert.equal(current(store).timerUpdatedAt, previousTimerAt);
  assert.equal(current(store).specialUpdatedAt, previousSpecialAt);
  store = reduceBattle(store, battleCapture("special_skill_setting", { value: 0 }));
  assert.equal(current(store).turns[0]?.chargeAttackEnabled, true);
  store = reduceBattle(store, battleCapture("normal_attack_result", actionBody([
    { cmd: "attack", from: "boss", damage: [[{ pos: 0, value: 20 }]] },
    { cmd: "die", to: "player", index: 0 }, { cmd: "special_skill_interrupt" }
  ], { formation: ["4", "1", "2", "3"], special_skill_indicate: [{ interrupt_display_text: ["下一回合预兆"] }] })));
  assert.equal(current(store).players[0]?.taken.attack, 20);
  assert.equal(current(store).players[4]?.taken.attack, 0);
  assert.equal(current(store).players[0]?.alive, false);
  assert.equal(current(store).turns[0]?.cancelled, true);
  assert.deepEqual(current(store).turns[0]?.omens, ["测试预兆"]);
  assert.deepEqual(current(store).turns[1]?.omens, ["下一回合预兆"]);
  assert.notEqual(current(store).timerUpdatedAt, previousTimerAt);
  store = reduceBattle(store, battleCapture("user_recovery", actionBody([{ cmd: "resurrection", index: 0 }])));
  assert.equal(current(store).players[0]?.alive, true);
});

test("多段承伤保持响应顺序，以最后一段明确的 HP 更新角色状态", () => {
  const store = reduceBattle(started(), battleCapture("normal_attack_result", actionBody([
    { cmd: "attack", from: "boss", damage: { 0: [{ pos: 1, value: 100, hp: 900 }, { pos: 1, value: 200, hp: 700 }], 1: [{ pos: 1, value: 300, hp: 400 }] } }
  ])));
  assert.equal(current(store).players[1]?.taken.attack, 600);
  assert.equal(current(store).players[1]?.hp, 400);
  assert.equal(current(store).players[1]?.alive, true);
});

test("未捕获 start、错误响应、非战斗响应、截断正文和不匹配战斗均忽略", () => {
  const store = started();
  assert.equal(reduceBattle(emptyBattleStore(), battleCapture("normal_attack_result", actionBody([]))).records.length, 0);
  assert.equal(reduceBattle(store, battleCapture("ignored", {})), store);
  assert.equal(reduceBattle(store, battleCapture("normal_attack_result", actionBody([]), { status: 500 })), store);
  assert.equal(reduceBattle(store, battleCapture("normal_attack_result", null, { truncated: true })), store);
  assert.equal(reduceBattle(store, battleCapture("normal_attack_result", { ...actionBody([]), raid_id: "not-captured" })), store);
  assert.equal(reduceBattle(store, battleCapture("normal_attack_result", {})), store);
  assert.equal(reduceBattle(store, battleCapture("start", { raid_id: "1002", boss: {}, player: {} })), store);
});

test("历史限 10 场，持久化守卫、容量、导出和轻量摘要", () => {
  let store = emptyBattleStore();
  for (let index = 0; index < 12; index += 1) store = reduceBattle(store, battleCapture("start", startBody(String(1000 + index))));
  assert.equal(store.records.length, MAX_BATTLE_RECORDS);
  assert.equal(store.currentId, "1011");
  const restored = restoreBattleStore(JSON.parse(JSON.stringify(store)) as unknown);
  assert.equal(restored.records.length, 10);
  assert.equal(restored.currentId, "1011");
  assert.equal(restoreBattleStore({ ...store, records: [{ ...current(store), players: null }] }).records.length, 0);
  assert.equal(restoreBattleStore(null).records.length, 0);
  const summary = battleSnapshot(restored);
  assert.equal("players" in summary.records[0]!, false);
  assert.equal("fingerprints" in exportBattle(current(store)), false);
  const large = structuredClone(store);
  for (const battle of large.records) for (const player of battle.players) player.buffs = Array.from({ length: 100 }, (_, index) => ({ id: `fixture${index}`, name: "测试", detail: "a".repeat(1000), remaining: null, debuff: false }));
  const fitted = fitBattleStore(large);
  assert.ok(byteLength(fitted) <= MAX_BATTLE_BYTES);
  assert.ok(fitted.records.some((battle) => battle.raidId === large.currentId));
  const single = structuredClone(started());
  for (const entity of [...current(single).players, ...current(single).bosses]) entity.buffs = Array.from({ length: 200 }, () => ({
    id: "测".repeat(200), name: "试".repeat(200), detail: "样".repeat(1000), remaining: "本".repeat(200), debuff: false
  }));
  const compacted = fitBattleStore(single);
  assert.ok(byteLength(compacted) <= MAX_BATTLE_BYTES);
  assert.equal(compacted.currentId, single.currentId);
  assert.equal(totalDamage(current(compacted)), totalDamage(current(single)));
});

test("React 战斗详情与行动明细可渲染，未知值和资源路径有界", () => {
  const store = reduceBattle(started(), battleCapture("normal_attack_result", actionBody([{ cmd: "win", is_last_raid: true }])));
  const battle = current(store);
  const html = renderToStaticMarkup(createElement(BattleDetail, { battle }));
  assert.match(html, /人工样本副本/u);
  assert.match(html, /伤害统计/u);
  assert.match(html, /主人公/u);
  assert.doesNotMatch(html, /NaN|Infinity|private/u);
  assert.match(renderToStaticMarkup(createElement(ActionTimeline, { battle })), /第 1 回合/u);
  assert.equal(assetUrl("enemy", "../unsafe"), null);
  assert.equal(duration(null), "—");
  assert.equal(duration(65), "01:05");
});
