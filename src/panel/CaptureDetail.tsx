import { useEffect, useState } from "react";
import type { DebugCapture } from "../domain/model";
import { downloadJson, formatBytes } from "./api";

export function CaptureDetail({ id }: { id: string }): React.JSX.Element {
  const [capture, setCapture] = useState<DebugCapture | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void chrome.runtime.sendMessage({ type: "GET_CAPTURE", id }).then((result: DebugCapture | null) => {
      if (!active) return;
      if (result) setCapture(result);
      else setError("记录已被淘汰，请选择其他响应。");
    }).catch(() => { if (active) setError("读取响应失败，请重新加载扩展。"); });
    return () => { active = false; };
  }, [id]);
  if (error) return <p className="empty" role="alert">{error}</p>;
  if (!capture) return <p className="empty">正在读取响应…</p>;
  return <>
    <div className="detail-header">
      <div><span className="eyebrow">RESPONSE / JSON</span><h2>响应详情</h2></div>
      <button onClick={() => downloadJson(capture, `gbf-battle-${capture.id}.json`)}>导出当前</button>
    </div>
    <dl className="metadata">
      <dt>接口</dt><dd className="mono">{capture.url}</dd>
      <dt>请求</dt><dd>{capture.method} · HTTP {capture.status} · {capture.source.toUpperCase()}</dd>
      <dt>捕获时间</dt><dd>{new Date(capture.capturedAt).toLocaleString("zh-CN", { hour12: false })}</dd>
      <dt>正文大小</dt><dd>{formatBytes(capture.bodyBytes)}{capture.truncated ? " · 已省略超限正文" : " · 脱敏后"}</dd>
    </dl>
    {capture.truncated ? <p className="notice">正文超过 512 KB，仅保留接口、时间和状态等元数据。</p> :
      <pre className="json" tabIndex={0}>{JSON.stringify(capture.body, null, 2)}</pre>}
  </>;
}
