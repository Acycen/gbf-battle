import assert from "node:assert/strict";
import { createPayload } from "../../src/domain/capture";
import type { CapturePayload } from "../../src/domain/model";

// 人工构造的最小协议样本；字段形状取自 Tarou types/modules/source.d.ts。
export function startBody(raidId = "1001"): Record<string, unknown> {
  return {
    raid_id: raidId, quest_id: "synthetic-quest", turn: 1, timer: 600, multi: 1, limit_number: "6", special_skill_flag: "1",
    nickname: "private-player", user_id: "private-id",
    boss: { param: [{ name: { ja: "検証用の敵" }, monster: "人工样本副本", cjs: "enemy_fixture", Lv: "1", attribute: "1", hp: "100000", hpmax: 100000, condition: { buff: [{ status: "synthetic-buff", detail: "测试状态", remain: 2 }] } }] },
    player: { param: Array.from({ length: 6 }, (_, index) => ({
      pid: `fixture${index}_01`, pid_image: `fixture${index}_01`, cjs: index ? "npc_fixture" : "leader_fixture", name: index ? `検証キャラ${index}` : "private-player",
      alive: 1, hp: 1000, hpmax: 1000, attr: "1", condition: { buff: [], coating_value: 0 }
    })) },
    ability: Object.fromEntries(Array.from({ length: 4 }, (_, index) => [index, { pos: index, list: {} }])),
    multi_raid_member_info: [{ user_id: "private-member", nickname: "private-member" }],
    summon: [{ name: "検証召喚", recast: "3" }], supporter: { name: "検証支援", recast: "0" },
    special_skill_indicate: [{ interrupt_display_text: ["测试预兆"] }]
  };
}

let sequence = 0;
export function battleCapture(route: string, body: unknown, overrides: Partial<CapturePayload> = {}): CapturePayload {
  const payload = createPayload(`https://game.granbluefantasy.jp/rest/raid/${route}.json`, 200, body, "POST", "xhr", "synthetic-session");
  assert.ok(payload);
  sequence += 1;
  return { ...payload, capturedAt: new Date(Date.UTC(2026, 9, 20, 0, 0, sequence)).toISOString(), ...overrides };
}

export function actionBody(scenario: unknown[], status: Record<string, unknown> = {}): Record<string, unknown> {
  return { scenario, status: { timer: 590, turn: 2, ...status } };
}
