import { GAME_MATCHES, isCapturePayload, isDebugCapture, isGameUrl, isRecord, redactValue, retainCaptures, sanitizeUrl, snapshot } from "../domain/capture";
import { emptySession, type DebugCapture, type DebugSession } from "../domain/model";
import { emptyBattleStore } from "../domain/battle/model";
import { reduceBattle } from "../domain/battle/reduce";
import { battleSnapshot, exportBattle, fitBattleStore, restoreBattleStore } from "../domain/battle/storage";
import { isPanelRequest, type GameTabInfo, type ListenerControl, type PanelRequest, type RuntimeMessage } from "../shared/protocol";

/**
 * MV3 Service Worker：集中管理监听生命周期、两类存储和面板查询。
 * 所有可变状态都只在下方 queue 中访问，避免异步事件交错覆盖。
 */
const STORAGE_KEY = "gbfBattleDebugSession";
const BATTLE_STORAGE_KEY = "gbfBattleRecords";
const STOP: ListenerControl = { type: "LISTENER_CONTROL", command: "STOP", sessionId: null };
let session: DebugSession = emptySession();
let battles = emptyBattleStore();
/** 每次现算摘要，避免维护容易失配的第三份派生状态。 */
const createSnapshot = () => snapshot(session, battleSnapshot(battles));

/** 恢复临时 Debug 状态，并确认保存的来源标签页仍存在且仍是允许页面。 */
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

/** Debug 与战斗历史独立恢复；来源关联只有两边 tabId 一致时才有效。 */
async function restore(): Promise<void> {
  await restoreDebug();
  try {
    const stored: unknown = (await chrome.storage.local.get(BATTLE_STORAGE_KEY))[BATTLE_STORAGE_KEY];
    battles = restoreBattleStore(stored);
    if (battles.tabId !== session.tabId || session.tabId === null) {
      // tabId 只在当前浏览器会话内有意义；失配时同时撤销关联，防止 Chrome 复用旧 ID。
      battles = { ...battles, currentId: null, tabId: session.tabId };
    }
  } catch { battles.error = "战斗记录恢复失败，当前仍可继续统计。"; }
}

/** 保存前统一执行记录数和 2 MiB 容量约束，失败时保留内存统计。 */
async function persistBattles(): Promise<void> {
  battles = fitBattleStore({ ...battles, error: null });
  try { await chrome.storage.local.set({ [BATTLE_STORAGE_KEY]: battles }); }
  catch { battles.error = "战斗记录保存失败，当前仍可查看；后台重启后可能丢失本次更新。"; }
}

/** revision 单调递增；广播只发送轻量快照，面板未打开时忽略发送失败。 */
async function publish(): Promise<void> {
  session.revision += 1;
  session.captures = retainCaptures(session.captures);
  try { await chrome.storage.session.set({ [STORAGE_KEY]: session }); }
  catch { session.error = "会话保存失败，当前仍可实时监听；后台重启后可能丢失记录。"; }
  await chrome.runtime.sendMessage({ type: "STATE_UPDATED", snapshot: createSnapshot() } satisfies RuntimeMessage).catch(() => undefined);
}

// 控制、采集、查询和 tab 事件均串行，读取不会落在写入中间。
let queue: Promise<unknown> = restore();
/** 即使上一项失败，也让后续事件继续从已完成状态执行。 */
function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
  const task = queue.then(work);
  queue = task.catch(() => undefined);
  return task;
}

/** 统一封装 background → content 控制消息。 */
async function sendControl(tabId: number, control: ListenerControl): Promise<void> {
  await chrome.tabs.sendMessage(tabId, control);
}

/**
 * 校验并切换监听来源。切换标签页会停止旧页、清空 Debug，并解除旧战斗的当前关联；
 * 重复启动同一活动标签页则复用 sessionId。
 */
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
    battles = { ...battles, currentId: null, tabId: null };
  }
  await persistBattles();
  await publish();
}

/** 用户停止只令 sessionId 失效，保留来源和当前战斗供面板查看。 */
async function stop(): Promise<void> {
  const tabId = session.tabId;
  session = { ...session, listening: false, sessionId: null, error: null };
  if (tabId !== null) await sendControl(tabId, STOP).catch(() => undefined);
  await publish();
}

/** 扩展图标复用已有弹窗，避免重复创建多个面板实例。 */
async function openPanel(): Promise<void> {
  const url = chrome.runtime.getURL("panel.html");
  const windows = await chrome.windows.getAll({ populate: true });
  const existing = windows.find((item) => item.tabs?.some((tab) => tab.url === url));
  if (existing?.id !== undefined) await chrome.windows.update(existing.id, { focused: true });
  else await chrome.windows.create({ url, type: "popup", width: 360, height: 800, focused: true });
}

/** 处理经过守卫的面板命令；详情和导出按需返回，不进入广播。 */
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

/** 采集消息必须来自扩展自己的、位于允许游戏 origin 的 content script。 */
function isContentSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.tab?.id !== undefined && isGameUrl(sender.url);
}

/** 控制与导出命令只接受扩展自身 panel.html，游戏页面不能调用。 */
function isPanelSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("panel.html");
}

function isPayloadFromSender(payloadUrl: string, senderUrl: string | undefined): boolean {
  // content 已校验一次；后台仍独立核对 origin，因为跨 world 消息和 sender 都是信任边界。
  return isGameUrl(senderUrl) && new URL(payloadUrl).origin === new URL(senderUrl).origin;
}

/** 来源关闭或离开允许域名时，撤销当前关联并持久化历史的独立状态。 */
async function detachSource(tabId: number): Promise<void> {
  if (session.tabId !== tabId) return;
  session = { ...session, listening: false, tabId: null, sessionId: null };
  if (battles.tabId === tabId) {
    battles = { ...battles, currentId: null, tabId: null };
    await persistBattles();
  }
  await publish();
}

/** runtime 总线入口先按 sender 分流，再进入统一串行队列。 */
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!isRecord(message)) return false;
  if (isContentSender(sender) && message.type === "PAGE_BRIDGE_READY") {
    void enqueue(() => session.listening && session.tabId === sender.tab?.id && session.sessionId ?
      { type: "LISTENER_CONTROL", command: "START", sessionId: session.sessionId } satisfies ListenerControl : STOP)
      .then(respond).catch(() => respond(STOP));
    return true;
  }
  if (isContentSender(sender) && message.type === "AJAX_CAPTURED" && isCapturePayload(message.payload) && isPayloadFromSender(message.payload.url, sender.url)) {
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

/** 在游戏标签页点击图标时顺便开始监听；其他页面只负责打开面板。 */
chrome.action.onClicked.addListener((tab) => {
  void enqueue(async () => {
    try { if (tab.id !== undefined && isGameUrl(tab.url)) await start(tab.id); }
    finally { await openPanel(); }
  }).catch(() => undefined);
});

/** 标签页关闭后撤销来源关联，但保留已保存的历史记录。 */
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(() => detachSource(tabId));
});

/** 来源离开允许域名时先尝试通知旧页面停止，再清理后台关联。 */
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url || isGameUrl(change.url)) return;
  void enqueue(async () => {
    if (session.tabId !== tabId) return;
    await sendControl(tabId, STOP).catch(() => undefined);
    await detachSource(tabId);
  });
});
