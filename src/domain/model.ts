import type { BattleSnapshot } from "./battle/model";

/** 允许跨执行环境传输的 JSON 子集；排除函数、DOM 对象和特殊数值。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type CaptureSource = "fetch" | "xhr";

/** MAIN world 生成并经 content 转发的脱敏响应。 */
export interface CapturePayload {
  body: JsonValue;
  bodyBytes: number;
  capturedAt: string;
  method: string;
  sessionId: string;
  source: CaptureSource;
  status: number;
  truncated: boolean;
  url: string;
}

/** 后台接收后补充内部标识和来源标签页的完整 Debug 记录。 */
export interface DebugCapture extends CapturePayload {
  id: string;
  tabId: number;
}

/** 广播给面板的列表项刻意移除正文和 sessionId。 */
export type CaptureMetadata = Omit<DebugCapture, "body" | "sessionId">;

/** 后台广播及面板命令返回的轻量全局快照。 */
export interface DebugSnapshot {
  battle: BattleSnapshot;
  captures: CaptureMetadata[];
  error: string | null;
  listening: boolean;
  revision: number;
  tabId: number | null;
  storedBytes: number;
}

/** storage.session 中的临时监听状态，浏览器重启后无需长期保留。 */
export interface DebugSession {
  captures: DebugCapture[];
  error: string | null;
  listening: boolean;
  revision: number;
  sessionId: string | null;
  tabId: number | null;
}

/** 返回全新数组，避免测试或恢复流程共享会话引用。 */
export function emptySession(): DebugSession {
  return { captures: [], error: null, listening: false, revision: 0, sessionId: null, tabId: null };
}
