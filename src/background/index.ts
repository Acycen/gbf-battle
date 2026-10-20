import { GAME_MATCHES, isCapturePayload, isDebugCapture, isGameUrl, isRecord, redactValue, retainCaptures, sanitizeUrl, snapshot } from "../domain/capture";
import { emptySession, type DebugCapture, type DebugSession } from "../domain/model";
import { emptyBattleStore } from "../domain/battle/model";
import { reduceBattle } from "../domain/battle/reduce";
import { battleSnapshot, exportBattle, fitBattleStore, restoreBattleStore } from "../domain/battle/storage";
import { isPanelRequest, type GameTabInfo, type ListenerControl, type PanelRequest, type RuntimeMessage } from "../shared/protocol";

const STORAGE_KEY = "gbfBattleDebugSession";
const BATTLE_STORAGE_KEY = "gbfBattleRecords";
const STOP: ListenerControl = { type: "LISTENER_CONTROL", command: "STOP", sessionId: null };
let session: DebugSession = emptySession();
let battles = emptyBattleStore();
const createSnapshot = () => snapshot(session, battleSnapshot(battles));

async function restoreDebug(): Promise<void> {
  try {
    const stored: unknown = (await chrome.storage.session.get(STORAGE_KEY))[STORAGE_KEY];
    if (!isRecord(stored)) return;
    const captures: DebugCapture[] = Array.isArray(stored.captures) ? stored.captures.filter(isDebugCapture).map((capture) => ({
      ...capture, body: redactValue(capture.body), url: sanitizeUrl(capture.url)
    })) : [];
    session.captures = retainCaptures(captures);
    session.revision = Number.isSafeInteger(stored.revision) && Number(stored.revision) >= 0 ? Number(stored.revision) : 0;
    if (stored.listening === true && typeof stored.sessionId === "string" && stored.sessionId.length > 0 && stored.sessionId.length <= 100 &&
      Number.isSafeInteger(stored.tabId) && Number(stored.tabId) >= 0) {
      const tab = await chrome.tabs.get(Number(stored.tabId)).catch(() => null);
      if (isGameUrl(tab?.url)) {
        session.listening = true;
        session.tabId = Number(stored.tabId);
        session.sessionId = stored.sessionId;
      }
    }
  } catch { session.error = "会话恢复失败，已使用内存状态继续。"; }
}

async function restore(): Promise<void> {
  await restoreDebug();
  try {
    const stored: unknown = (await chrome.storage.local.get(BATTLE_STORAGE_KEY))[BATTLE_STORAGE_KEY];
    battles = restoreBattleStore(stored);
    if (battles.tabId !== session.tabId || session.tabId === null) battles.currentId = null;
  } catch { battles.error = "战斗记录恢复失败，当前仍可继续统计。"; }
}

async function persistBattles(): Promise<void> {
  battles = fitBattleStore({ ...battles, error: null });
  try { await chrome.storage.local.set({ [BATTLE_STORAGE_KEY]: battles }); }
  catch { battles.error = "战斗记录保存失败，当前仍可查看；后台重启后可能丢失本次更新。"; }
}

async function publish(): Promise<void> {
  session.revision += 1;
  session.captures = retainCaptures(session.captures);
  try { await chrome.storage.session.set({ [STORAGE_KEY]: session }); }
  catch { session.error = "会话保存失败，当前仍可实时监听；后台重启后可能丢失记录。"; }
  await chrome.runtime.sendMessage({ type: "STATE_UPDATED", snapshot: createSnapshot() } satisfies RuntimeMessage).catch(() => undefined);
}

// 控制、采集、查询和 tab 事件均串行，读取不会落在写入中间。
let queue: Promise<unknown> = restore();
function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
  const task = queue.then(work);
  queue = task.catch(() => undefined);
  return task;
}

async function sendControl(tabId: number, control: ListenerControl): Promise<void> {
  await chrome.tabs.sendMessage(tabId, control);
}

async function start(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isGameUrl(tab?.url)) {
    session.error = "请选择 GBF 游戏标签页。";
    await publish();
    return;
  }
  if (session.tabId !== null && session.tabId !== tabId) await sendControl(session.tabId, STOP).catch(() => undefined);
  if (session.tabId !== tabId) session.captures = [];
  if (battles.tabId !== tabId) battles.currentId = null;
  battles.tabId = tabId;
  const sessionId = session.listening && session.tabId === tabId && session.sessionId ? session.sessionId : crypto.randomUUID();
  session = { ...session, tabId, sessionId, listening: true, error: null };
  try { await sendControl(tabId, { type: "LISTENER_CONTROL", command: "START", sessionId }); }
  catch {
    session = { ...session, tabId: null, sessionId: null, listening: false, error: "无法连接游戏页。请重新加载扩展后刷新游戏页，再开始监听。" };
  }
  await persistBattles();
  await publish();
}

async function stop(): Promise<void> {
  const tabId = session.tabId;
  session = { ...session, listening: false, sessionId: null, error: null };
  if (tabId !== null) await sendControl(tabId, STOP).catch(() => undefined);
  await publish();
}

async function openPanel(): Promise<void> {
  const url = chrome.runtime.getURL("panel.html");
  const windows = await chrome.windows.getAll({ populate: true });
  const existing = windows.find((item) => item.tabs?.some((tab) => tab.url === url));
  if (existing?.id !== undefined) await chrome.windows.update(existing.id, { focused: true });
  else await chrome.windows.create({ url, type: "popup", width: 360, height: 800, focused: true });
}

async function panelRequest(message: PanelRequest): Promise<unknown> {
  switch (message.type) {
    case "GET_GAME_TABS": {
      const tabs = await chrome.tabs.query({ url: GAME_MATCHES });
      return tabs.flatMap((tab): GameTabInfo[] => tab.id !== undefined && isGameUrl(tab.url) ? [{ id: tab.id, host: new URL(tab.url).host }] : []);
    }
    case "START_LISTENING": await start(message.tabId); return createSnapshot();
    case "STOP_LISTENING": await stop(); return createSnapshot();
    case "GET_SNAPSHOT": return createSnapshot();
    case "GET_CAPTURE": return session.captures.find((capture) => capture.id === message.id) ?? null;
    case "GET_CAPTURE_EXPORT": return session.captures;
    case "GET_BATTLE_RECORD": return battles.records.find((battle) => battle.raidId === message.raidId) ?? null;
    case "GET_BATTLE_EXPORT": return battles.records.map(exportBattle);
    case "DELETE_BATTLE_RECORD":
      battles.records = battles.records.filter((battle) => battle.raidId !== message.raidId);
      if (battles.currentId === message.raidId) battles.currentId = null;
      await persistBattles(); await publish(); return createSnapshot();
    case "CLEAR_BATTLE_RECORDS":
      battles = { ...emptyBattleStore(), tabId: battles.tabId };
      await persistBattles(); await publish(); return createSnapshot();
    case "CLEAR_CAPTURES": session.captures = []; session.error = null; await publish(); return createSnapshot();
  }
}

function isContentSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab?.id !== undefined && isGameUrl(sender.url);
}

function isPanelSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("panel.html");
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!isRecord(message)) return false;
  if (isContentSender(sender) && message.type === "PAGE_BRIDGE_READY") {
    void enqueue(() => session.listening && session.tabId === sender.tab?.id && session.sessionId ?
      { type: "LISTENER_CONTROL", command: "START", sessionId: session.sessionId } satisfies ListenerControl : STOP)
      .then(respond).catch(() => respond(STOP));
    return true;
  }
  if (isContentSender(sender) && message.type === "AJAX_CAPTURED" && isCapturePayload(message.payload)) {
    const payload = message.payload;
    void enqueue(async () => {
      if (!session.listening || sender.tab?.id !== session.tabId || payload.sessionId !== session.sessionId) return;
      // 页面协议本身不可信；后台再次校验和脱敏，永不广播正文。
      const capture: DebugCapture = { ...payload, url: sanitizeUrl(payload.url), body: redactValue(payload.body), id: crypto.randomUUID(), tabId: session.tabId };
      session.captures = retainCaptures([capture, ...session.captures]);
      try {
        const next = reduceBattle(battles, capture);
        if (next !== battles) { battles = next; await persistBattles(); }
      } catch { battles.error = "本次战斗响应无法解析，已保留上一份统计；原始数据仍可在 Debug 查看。"; }
      session.error = null;
      await publish();
    });
    return false;
  }
  if (!isPanelSender(sender) || !isPanelRequest(message)) return false;
  void enqueue(() => panelRequest(message)).then(respond).catch(() => respond(null));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  void enqueue(async () => {
    try { if (tab.id !== undefined && isGameUrl(tab.url)) await start(tab.id); }
    finally { await openPanel(); }
  }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    if (session.tabId !== tabId) return;
    session = { ...session, listening: false, tabId: null, sessionId: null };
    await publish();
  });
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || isGameUrl(change.url)) return;
  void enqueue(async () => {
    if (session.tabId !== tabId) return;
    await sendControl(tabId, STOP).catch(() => undefined);
    session = { ...session, listening: false, tabId: null, sessionId: null };
    await publish();
  });
});
