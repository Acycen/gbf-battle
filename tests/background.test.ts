import assert from "node:assert/strict";
import test from "node:test";
import { createPayload } from "../src/domain/capture";
import type { DebugCapture, DebugSnapshot } from "../src/domain/model";
import type { ListenerControl } from "../src/shared/protocol";
import type { BattleRecord } from "../src/domain/battle/model";
import { battleCapture, startBody, actionBody } from "./fixtures/battle";

type RuntimeListener = Parameters<typeof chrome.runtime.onMessage.addListener>[0];
type ActionListener = Parameters<typeof chrome.action.onClicked.addListener>[0];
type RemovedListener = Parameters<typeof chrome.tabs.onRemoved.addListener>[0];
type UpdatedListener = Parameters<typeof chrome.tabs.onUpdated.addListener>[0];

async function harness(options: { stored?: Record<string, unknown>; local?: Record<string, unknown>; failStorage?: boolean; failLocal?: boolean } = {}) {
  const handlers: { runtime?: RuntimeListener; action?: ActionListener; removed?: RemovedListener; updated?: UpdatedListener } = {};
  const controls: Array<{ tabId: number; message: ListenerControl }> = [];
  const broadcasts: unknown[] = [];
  const stored = options.stored ?? {};
  const local = options.local ?? {};
  let windows = 0;
  let connectionFailure = false;
  const panelUrl = "chrome-extension://test/panel.html";
  const tabs = new Map([[7, "https://game.granbluefantasy.jp/"], [8, "https://gbf.game.mbga.jp/"], [9, "https://example.com/"]]);
  const mock = {
    runtime: {
      id: "test", getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: { addListener: (listener: RuntimeListener) => { handlers.runtime = listener; } },
      sendMessage: async (message: unknown) => { broadcasts.push(message); }
    },
    storage: { local: {
      get: async () => { if (options.failLocal) throw new Error("unavailable"); return structuredClone(local); },
      set: async (value: Record<string, unknown>) => { if (options.failLocal) throw new Error("quota"); Object.assign(local, structuredClone(value)); }
    }, session: {
      get: async () => { if (options.failStorage) throw new Error("unavailable"); return structuredClone(stored); },
      set: async (value: Record<string, unknown>) => { if (options.failStorage) throw new Error("quota"); Object.assign(stored, structuredClone(value)); }
    } },
    tabs: {
      get: async (id: number) => { if (!tabs.has(id)) throw new Error("closed"); return { id, url: tabs.get(id) }; },
      query: async () => [...tabs].map(([id, url]) => ({ id, url })),
      sendMessage: async (tabId: number, message: ListenerControl) => { if (connectionFailure) throw new Error("not connected"); controls.push({ tabId, message }); },
      onRemoved: { addListener: (listener: RemovedListener) => { handlers.removed = listener; } },
      onUpdated: { addListener: (listener: UpdatedListener) => { handlers.updated = listener; } }
    },
    action: { onClicked: { addListener: (listener: ActionListener) => { handlers.action = listener; } } },
    windows: {
      getAll: async () => windows ? [{ id: 1, tabs: [{ url: panelUrl }] }] : [],
      create: async () => { windows += 1; }, update: async () => undefined
    }
  };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: mock });
  delete require.cache[require.resolve("../src/background/index")];
  await import("../src/background/index");
  const panel: chrome.runtime.MessageSender = { id: "test", url: panelUrl };
  const content = (id = 7): chrome.runtime.MessageSender => ({ id: "test", url: tabs.get(id), tab: { id } as chrome.tabs.Tab });
  const send = (message: unknown, sender: chrome.runtime.MessageSender = panel): Promise<unknown> => new Promise((resolve) => {
    const asyncResponse: unknown = handlers.runtime?.(message, sender, resolve);
    if (asyncResponse !== true) resolve(false);
  });
  const get = async () => await send({ type: "GET_SNAPSHOT" }) as DebugSnapshot;
  const capture = async (sessionId: string, tabId = 7) => {
    const payload = createPayload("https://game.granbluefantasy.jp/debug/example?token=private", 200, { value: 1, token: "private" }, "GET", "fetch", sessionId);
    assert.ok(payload);
    await send({ type: "AJAX_CAPTURED", payload }, content(tabId));
    return get();
  };
  return { handlers, controls, broadcasts, stored, local, panel, content, send, get, capture, windows: () => windows, failConnection: () => { connectionFailure = true; } };
}

test("开始/停止、标签切换、刷新握手、清空、导出和关闭来源", async () => {
  const app = await harness();
  assert.equal((await app.get()).listening, false);
  assert.deepEqual(await app.send({ type: "GET_GAME_TABS" }), [{ id: 7, host: "game.granbluefantasy.jp" }, { id: 8, host: "gbf.game.mbga.jp" }]);
  await app.send({ type: "START_LISTENING", tabId: 7 });
  const control = await app.send({ type: "PAGE_BRIDGE_READY" }, app.content()) as ListenerControl;
  assert.equal(control.command, "START");
  assert.ok(control.sessionId);
  assert.equal((await app.capture(control.sessionId)).captures.length, 1);
  const first = (await app.get()).captures[0]!;
  const detail = await app.send({ type: "GET_CAPTURE", id: first.id }) as DebugCapture;
  assert.deepEqual(detail.body, { value: 1, token: "[已脱敏]" });
  assert.equal((await app.send({ type: "GET_CAPTURE_EXPORT" }) as DebugCapture[]).length, 1);
  assert.equal(JSON.stringify(app.broadcasts).includes('"body":'), false);
  await app.send({ type: "STOP_LISTENING" });
  assert.equal((await app.capture(control.sessionId)).captures.length, 1);
  assert.equal((await app.get()).listening, false);
  await app.send({ type: "START_LISTENING", tabId: 7 });
  const restart = await app.send({ type: "PAGE_BRIDGE_READY" }, app.content()) as ListenerControl;
  assert.notEqual(restart.sessionId, control.sessionId);
  assert.equal((await app.capture(control.sessionId)).captures.length, 1);
  await app.send({ type: "CLEAR_CAPTURES" });
  assert.equal((await app.get()).captures.length, 0);
  await app.capture(restart.sessionId!);
  await app.send({ type: "START_LISTENING", tabId: 8 });
  assert.equal((await app.get()).captures.length, 0);
  assert.equal((await app.get()).tabId, 8);
  assert.equal((await app.capture(restart.sessionId!)).captures.length, 0);
  assert.ok(app.controls.some((item) => item.tabId === 7 && item.message.command === "STOP"));
  app.handlers.removed?.(8, { windowId: 1, isWindowClosing: false });
  assert.equal((await app.get()).tabId, null);
});

test("拒绝页面控制、非法 sender、无关接口和畸形消息", async () => {
  const app = await harness();
  assert.equal(await app.send({ type: "START_LISTENING", tabId: 7 }, app.content()), false);
  assert.equal(await app.send({ type: "GET_CAPTURE_EXPORT" }, app.content()), false);
  assert.equal(await app.send({ type: "START_LISTENING", tabId: -1 }), false);
  assert.equal(await app.send(null), false);
  await app.send({ type: "START_LISTENING", tabId: 7 });
  const control = await app.send({ type: "PAGE_BRIDGE_READY" }, app.content()) as ListenerControl;
  const payload = createPayload("https://game.granbluefantasy.jp/debug/example", 200, {}, "GET", "fetch", control.sessionId!);
  assert.ok(payload);
  for (const sender of [app.panel, { ...app.content(), id: "other" }, { ...app.content(), url: "https://example.com" }]) await app.send({ type: "AJAX_CAPTURED", payload }, sender);
  await app.send({ type: "AJAX_CAPTURED", payload: { ...payload, url: "https://example.com" } }, app.content());
  await app.send({ type: "AJAX_CAPTURED", payload: { ...payload, url: "https://gbf.game.mbga.jp/debug/example" } }, app.content());
  assert.equal((await app.get()).captures.length, 0);
  await app.send({ type: "START_LISTENING", tabId: 9 });
  assert.equal((await app.get()).tabId, 7);
  app.handlers.updated?.(7, { url: "https://example.com" }, { id: 7 } as chrome.tabs.Tab);
  const detached = await app.get();
  assert.equal(detached.listening, false);
  assert.equal(detached.battle.currentId, null);
});

test("worker 重启恢复会话和记录；断连与 storage 失败不阻塞后续查询", async () => {
  const first = await harness();
  await first.send({ type: "START_LISTENING", tabId: 7 });
  const control = await first.send({ type: "PAGE_BRIDGE_READY" }, first.content()) as ListenerControl;
  await first.capture(control.sessionId!);
  const restored = await harness({ stored: first.stored });
  assert.equal((await restored.get()).listening, true);
  assert.equal((await restored.get()).captures.length, 1);
  assert.deepEqual(await restored.send({ type: "PAGE_BRIDGE_READY" }, restored.content()), control);
  restored.failConnection();
  await restored.send({ type: "START_LISTENING", tabId: 8 });
  assert.equal((await restored.get()).listening, false);
  assert.match((await restored.get()).error!, /无法连接/u);

  const degraded = await harness({ failStorage: true });
  await degraded.send({ type: "START_LISTENING", tabId: 7 });
  const active = await degraded.send({ type: "PAGE_BRIDGE_READY" }, degraded.content()) as ListenerControl;
  const result = await degraded.capture(active.sessionId!);
  assert.equal(result.listening, true);
  assert.equal(result.captures.length, 1);
  assert.match(result.error!, /会话保存失败/u);
  await degraded.send({ type: "CLEAR_CAPTURES" });
  assert.equal((await degraded.get()).captures.length, 0);
});

test("扩展图标复用独立窗口，非游戏页打开时保留原监听", async () => {
  const app = await harness();
  app.handlers.action?.({ id: 7, url: "https://game.granbluefantasy.jp/" } as chrome.tabs.Tab);
  await app.get();
  app.handlers.action?.({ id: 9, url: "https://example.com/" } as chrome.tabs.Tab);
  await app.get();
  assert.equal(app.windows(), 1);
  assert.equal((await app.get()).tabId, 7);
});

test("战斗响应全链路、Debug 独立清空、历史持久化和浏览器新会话恢复", async () => {
  const app = await harness();
  await app.send({ type: "START_LISTENING", tabId: 7 });
  const control = await app.send({ type: "PAGE_BRIDGE_READY" }, app.content()) as ListenerControl;
  const sendBattle = async (route: string, body: unknown) => {
    await app.send({ type: "AJAX_CAPTURED", payload: battleCapture(route, body, { sessionId: control.sessionId! }) }, app.content());
    return app.get();
  };
  await sendBattle("start", startBody());
  const updated = await sendBattle("normal_attack_result", actionBody([
    { cmd: "attack", from: "player", num: 0, damage: [[{ value: 250 }]] }
  ]));
  assert.equal(updated.battle.currentId, "1001");
  assert.equal(updated.battle.records[0]?.damage, 250);
  assert.equal("players" in updated.battle.records[0]!, false);
  const detail = await app.send({ type: "GET_BATTLE_RECORD", raidId: "1001" }) as BattleRecord;
  assert.equal(detail.players[0]?.damage.attack, 250);
  assert.equal(JSON.stringify(app.local).includes("private"), false);
  assert.equal(await app.send({ type: "GET_BATTLE_EXPORT" }, app.content()), false);
  await app.send({ type: "CLEAR_CAPTURES" });
  assert.equal((await app.get()).captures.length, 0);
  assert.equal((await app.get()).battle.records.length, 1);
  const restored = await harness({ stored: app.stored, local: app.local });
  assert.equal((await restored.get()).battle.currentId, "1001");
  assert.equal((await restored.get()).battle.records[0]?.damage, 250);
  const freshBrowser = await harness({ local: app.local });
  assert.equal((await freshBrowser.get()).battle.records.length, 1);
  assert.equal((await freshBrowser.get()).battle.currentId, null);
  assert.equal((await freshBrowser.get()).captures.length, 0);
  const exported = await freshBrowser.send({ type: "GET_BATTLE_EXPORT" }) as Array<Record<string, unknown>>;
  assert.equal(exported.length, 1);
  assert.equal("fingerprints" in exported[0]!, false);
  await freshBrowser.send({ type: "DELETE_BATTLE_RECORD", raidId: "1001" });
  assert.equal((await freshBrowser.get()).battle.records.length, 0);
});

test("切换来源隔离当前战斗；本地记录保存失败时 Debug 和统计继续", async () => {
  const app = await harness({ failLocal: true });
  await app.send({ type: "START_LISTENING", tabId: 7 });
  const control = await app.send({ type: "PAGE_BRIDGE_READY" }, app.content()) as ListenerControl;
  await app.send({ type: "AJAX_CAPTURED", payload: battleCapture("start", startBody(), { sessionId: control.sessionId! }) }, app.content());
  const state = await app.get();
  assert.equal(state.listening, true);
  assert.equal(state.captures.length, 1);
  assert.equal(state.battle.records.length, 1);
  assert.match(state.battle.error!, /保存失败/u);
  await app.send({ type: "START_LISTENING", tabId: 8 });
  const switched = await app.get();
  assert.equal(switched.battle.currentId, null);
  assert.equal(switched.battle.records.length, 1);
  await app.send({ type: "CLEAR_BATTLE_RECORDS" });
  assert.equal((await app.get()).battle.records.length, 0);
});

test("来源关闭后撤销战斗关联，复用相同 tab ID 不续接旧战斗", async () => {
  const app = await harness();
  await app.send({ type: "START_LISTENING", tabId: 7 });
  const control = await app.send({ type: "PAGE_BRIDGE_READY" }, app.content()) as ListenerControl;
  await app.send({ type: "AJAX_CAPTURED", payload: battleCapture("start", startBody(), { sessionId: control.sessionId! }) }, app.content());
  assert.equal((await app.get()).battle.currentId, "1001");

  app.handlers.removed?.(7, { windowId: 1, isWindowClosing: false });
  const detached = await app.get();
  assert.equal(detached.battle.currentId, null);
  assert.equal(detached.battle.records.length, 1);

  await app.send({ type: "START_LISTENING", tabId: 7 });
  assert.equal((await app.get()).battle.currentId, null);
});
