import { useCallback, useEffect, useRef, useState } from "react";
import { isRecord, MAX_CAPTURE_COUNT, MAX_STORAGE_BYTES } from "../domain/capture";
import type { DebugCapture, DebugSnapshot } from "../domain/model";
import type { GameTabInfo, PanelRequest } from "../shared/protocol";
import { CaptureDetail } from "./CaptureDetail";
import { downloadJson, formatBytes, request } from "./api";
import { BattlePanel } from "./battle/BattlePanel";

const INITIAL: DebugSnapshot = { battle: { currentId: null, records: [], error: null }, captures: [], error: null, listening: false, revision: -1, tabId: null, storedBytes: 0 };

export function App(): React.JSX.Element {
  const [view, setView] = useState<"battle" | "history" | "debug">("battle");
  const [state, setState] = useState(INITIAL);
  const contentRef = useRef<HTMLDivElement>(null);
  const revision = useRef(-1);
  const [tabs, setTabs] = useState<GameTabInfo[]>([]);
  const [tabId, setTabId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [selection, setSelection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showControls, setShowControls] = useState(true);
  useEffect(() => setShowControls(!state.listening), [state.listening]);
  useEffect(() => contentRef.current?.scrollTo({ top: 0 }), [view]);
  const apply = useCallback((next: DebugSnapshot) => {
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    setState(next);
  }, []);
  const refreshTabs = useCallback(async () => {
    const next = await request<GameTabInfo[]>({ type: "GET_GAME_TABS" });
    setTabs(next);
    setTabId((current) => next.some((tab) => tab.id === current) ? current : next[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const listener = (message: unknown, sender: chrome.runtime.MessageSender): void => {
      if (sender.id === chrome.runtime.id && isRecord(message) && message.type === "STATE_UPDATED" && isRecord(message.snapshot)) apply(message.snapshot as unknown as DebugSnapshot);
    };
    chrome.runtime.onMessage.addListener(listener);
    void Promise.all([request<DebugSnapshot>({ type: "GET_SNAPSHOT" }).then(apply), refreshTabs()])
      .catch(() => setError("无法连接扩展后台，请从扩展图标打开面板。"));
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [apply, refreshTabs]);

  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try { await work(); } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  async function command(message: PanelRequest): Promise<void> { apply(await request<DebugSnapshot>(message)); }
  const visible = state.captures.filter((capture) =>
    capture.url.toLowerCase().includes(filter.trim().toLowerCase()) && (source === "all" || capture.source === source) &&
    (status === "all" || status === "error" && capture.status >= 400 || status === "success" && capture.status >= 200 && capture.status < 400));
  const selected = visible.find((capture) => capture.id === selection) ?? visible[0];

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

    {view === "debug" ? <>

    <div className="stats" aria-label="采集统计">
      <div><span>保留响应</span><strong>{state.captures.length}<small> / {MAX_CAPTURE_COUNT}</small></strong></div>
      <div><span>会话占用</span><strong>{formatBytes(state.storedBytes)}<small> / {formatBytes(MAX_STORAGE_BYTES)}</small></strong></div>
      <div><span>最近捕获</span><strong>{state.captures[0] ? new Date(state.captures[0].capturedAt).toLocaleTimeString("zh-CN", { hour12: false }) : "—"}</strong></div>
      <p>仅观察游戏页面已收到的 JSON 响应。URL 查询参数、认证字段和常见账号标识会被脱敏。</p>
    </div>

    <main className="workspace">
      <section className="capture-list" aria-label="响应列表">
        <div className="list-heading"><h2>网络响应</h2><span>{visible.length} 条</span></div>
        <div className="filters">
          <input aria-label="筛选接口 URL" placeholder="搜索接口路径…" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <div><select aria-label="请求来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option><option value="fetch">Fetch</option><option value="xhr">XHR</option></select>
            <select aria-label="响应状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="success">2xx / 3xx</option><option value="error">4xx / 5xx</option></select></div>
        </div>
        <div className="rows">
          {!visible.length ? <div className="empty"><span className="empty-icon" aria-hidden="true">{state.captures.length ? "⌕" : "{ }"}</span><h3>{state.captures.length ? "没有匹配的响应" : "等待数据到达"}</h3><p>{state.listening ? "在游戏页面手动操作后，新响应会显示在这里。" : "选择游戏标签页并开始监听。"}</p></div> : visible.map((capture) => <button className={`capture-row ${capture.id === selected?.id ? "selected" : ""}`} key={capture.id} onClick={() => setSelection(capture.id)} aria-pressed={capture.id === selected?.id}>
            <div><span className={`http-status ${capture.status >= 400 ? "failed" : ""}`}>{capture.status}</span><span className="method">{capture.method}</span><time>{new Date(capture.capturedAt).toLocaleTimeString("zh-CN", { hour12: false })}</time></div>
            <span className="path mono">{new URL(capture.url).pathname}</span><span className="row-foot">{capture.source.toUpperCase()} · {formatBytes(capture.bodyBytes)}{capture.truncated ? " · 正文已省略" : ""}</span>
          </button>)}
        </div>
      </section>
      <section className="capture-detail" aria-label="响应详情">{selected ? <CaptureDetail key={selected.id} id={selected.id} /> : <div className="empty detail-empty"><span className="empty-icon" aria-hidden="true">&lt;/&gt;</span><h3>查看响应 JSON</h3><p>从左侧选择一条响应，查看脱敏后的数据。</p></div>}</section>
    </main>
    </> : <BattlePanel state={state.battle} revision={state.revision} mode={view} listening={state.listening} onSnapshot={apply} />}
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
