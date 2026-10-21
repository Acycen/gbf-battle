import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { isRecord } from "../domain/capture";
import type { DebugCapture, DebugSnapshot } from "../domain/model";
import type { GameTabInfo, PanelRequest } from "../shared/protocol";
import { downloadJson, request } from "./api";

const DebugPanel = lazy(async () => {
  const module = await import(/* webpackChunkName: "debug-panel" */ "./DebugPanel");
  return { default: module.DebugPanel };
});

// 战斗和 Debug 视图占面板的大部分代码；拆为扩展内本地 chunk，让外壳先完成解析。
const BattlePanel = lazy(async () => {
  const module = await import(/* webpackChunkName: "battle-panel" */ "./battle/BattlePanel");
  return { default: module.BattlePanel };
});

const INITIAL: DebugSnapshot = { battle: { currentId: null, records: [], error: null }, captures: [], error: null, listening: false, revision: -1, tabId: null, storedBytes: 0 };

/** 面板外壳负责监听控制、视图导航和最新后台快照，业务详情由子视图按需加载。 */
export function App(): React.JSX.Element {
  const [view, setView] = useState<"battle" | "history" | "debug">("battle");
  const [state, setState] = useState(INITIAL);
  const contentRef = useRef<HTMLDivElement>(null);
  const revision = useRef(-1);
  const [tabs, setTabs] = useState<GameTabInfo[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showControls, setShowControls] = useState(true);
  useEffect(() => setShowControls(!state.listening), [state.listening]);
  useEffect(() => contentRef.current?.scrollTo({ top: 0 }), [view]);
  /** 忽略晚到的旧快照，避免命令响应覆盖更新更晚的广播。 */
  const apply = useCallback((next: DebugSnapshot) => {
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    setState(next);
  }, []);
  /** 标签页消失后自动回退到查询结果中的第一个合法来源。 */
  const refreshTabs = useCallback(async () => {
    const next = await request<GameTabInfo[]>({ type: "GET_GAME_TABS" });
    setTabs(next);
    setTabId((current) => next.some((tab) => tab.id === current) ? current : next[0]?.id ?? null);
  }, []);

  useEffect(() => {
    // 初始查询和后续广播共用 apply，因此 revision 顺序规则始终一致。
    const listener = (message: unknown, sender: chrome.runtime.MessageSender): void => {
      if (sender.id === chrome.runtime.id && isRecord(message) && message.type === "STATE_UPDATED" && isRecord(message.snapshot)) apply(message.snapshot as unknown as DebugSnapshot);
    };
    chrome.runtime.onMessage.addListener(listener);
    void Promise.all([request<DebugSnapshot>({ type: "GET_SNAPSHOT" }).then(apply), refreshTabs()])
      .catch(() => setError("无法连接扩展后台，请从扩展图标打开面板。"));
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [apply, refreshTabs]);

  /** 为按钮操作提供统一的忙碌状态和用户可读错误。 */
  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try { await work(); } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  /** 改变后台状态的命令会返回新快照，立即应用可缩短 UI 等待广播的时间。 */
  async function command(message: PanelRequest): Promise<void> { apply(await request<DebugSnapshot>(message)); }
  return <div className={`app view-${view}`}><div className="panel-content" ref={contentRef}>
    <header className="topbar">
      <h1>GBF Battle</h1>
      <div className={`connection ${state.listening ? "active" : ""}`} title={state.listening ? `正在监听标签页 ${state.tabId}` : "监听已停止"}><i aria-hidden="true" />{state.listening ? "监听中" : "已停止"}</div>
      <button className="source-toggle" aria-expanded={showControls} aria-controls="listener-controls" onClick={() => setShowControls((value) => !value)}>监听设置</button>
    </header>

    {showControls ? <section id="listener-controls" className="toolbar" aria-label="监听控制">
      <label className="tab-picker">游戏标签页<select value={tabId ?? ""} onChange={(event) => setTabId(event.target.value ? Number(event.target.value) : null)} disabled={busy}>
        {!tabs.length ? <option value="">未找到 GBF 游戏标签页</option> : tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.host} · {tab.id}</option>)}
      </select></label>
      <button disabled={busy} onClick={() => void run(refreshTabs)}>刷新列表</button>
      <button className="primary" disabled={busy || tabId === null} onClick={() => void run(() => command({ type: "START_LISTENING", tabId: tabId! }))}>开始监听</button>
      <button disabled={busy || !state.listening} onClick={() => void run(() => command({ type: "STOP_LISTENING" }))}>停止监听</button>
    </section> : null}
      {view === "debug" ? <div className="toolbar-end debug-tools">
        <button disabled={busy || !state.captures.length} onClick={() => void run(async () => {
          const captures = await request<DebugCapture[]>({ type: "GET_CAPTURE_EXPORT" });
          downloadJson({ schemaVersion: 1, exportedAt: new Date().toISOString(), captures }, `gbf-battle-debug-${new Date().toISOString().replace(/[:.]/gu, "-")}.json`);
        })}>导出全部</button>
        <button className="danger" disabled={busy || !state.captures.length} onClick={() => void run(() => command({ type: "CLEAR_CAPTURES" }))}>清空记录</button>
      </div> : null}
    {error || state.error ? <div className="notice error" role="alert">{error ?? state.error}</div> : null}

    {view === "debug" ? <Suspense fallback={<p className="empty">正在加载 Debug 视图…</p>}><DebugPanel state={state} /></Suspense> : <Suspense fallback={<p className="empty">正在加载战斗视图…</p>}><BattlePanel state={state.battle} revision={state.revision} mode={view} listening={state.listening} onSnapshot={apply} /></Suspense>}
    <footer>战斗记录保留 10 场 · Debug 仅本次会话</footer>
    </div><nav className="main-nav" aria-label="功能模块">
      <span className="nav-brand" aria-hidden="true">GB</span>
      <button title="战斗详情" aria-label="战斗详情" aria-pressed={view === "battle"} onClick={() => setView("battle")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 14 14m-3 0 3-3M3 5l2-2 2 2M4 17l13-13 3-1-1 3L6 19m-3-3 5 5m-3-3-2 3" /></svg></button>
      <button title={`战斗记录（${state.battle.records.length}）`} aria-label="战斗记录" aria-pressed={view === "history"} onClick={() => setView("history")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16H6zM9 8h6m-6 4h6m-6 4h4M3 7h3m-3 5h3m-3 5h3" /></svg><small>{state.battle.records.length}</small></button>
      <button title={`数据 Debug（${state.captures.length}）`} aria-label="数据 Debug" aria-pressed={view === "debug"} onClick={() => setView("debug")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18" /></svg></button>
      <span className="nav-version">0.1</span>
    </nav>
  </div>;
}
