import { lazy, Suspense, useState } from "react";
import { MAX_CAPTURE_COUNT, MAX_STORAGE_BYTES } from "../domain/capture";
import type { DebugSnapshot } from "../domain/model";
import { formatBytes } from "./api";

const CaptureDetail = lazy(async () => {
  const module = await import(/* webpackChunkName: "capture-detail" */ "./CaptureDetail");
  return { default: module.CaptureDetail };
});

/**
 * Debug 专属筛选状态留在延迟加载的视图内，战斗页不必解析正文查看器。
 * 列表只使用广播元数据，选中项的脱敏正文再由 CaptureDetail 单独获取。
 */
export function DebugPanel({ state }: { state: DebugSnapshot }): React.JSX.Element {
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [selection, setSelection] = useState<string | null>(null);
  const visible = state.captures.filter((capture) =>
    capture.url.toLowerCase().includes(filter.trim().toLowerCase()) && (source === "all" || capture.source === source) &&
    (status === "all" || status === "error" && capture.status >= 400 || status === "success" && capture.status >= 200 && capture.status < 400));
  // 记录被容量淘汰或筛选隐藏后，自动展示当前可见列表的第一项。
  const selected = visible.find((capture) => capture.id === selection) ?? visible[0];

  return <>
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
      <section className="capture-detail" aria-label="响应详情">{selected ? <Suspense fallback={<p className="empty">正在读取响应详情…</p>}><CaptureDetail key={selected.id} id={selected.id} /></Suspense> : <div className="empty detail-empty"><span className="empty-icon" aria-hidden="true">&lt;/&gt;</span><h3>查看响应 JSON</h3><p>从左侧选择一条响应，查看脱敏后的数据。</p></div>}</section>
    </main>
  </>;
}
