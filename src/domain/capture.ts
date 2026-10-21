import type { CaptureMetadata, CapturePayload, CaptureSource, DebugCapture, DebugSession, DebugSnapshot, JsonValue } from "./model";
import type { BattleSnapshot } from "./battle/model";

/** 数据采集只允许两个官方游戏 origin；匹配规则同时供 Manifest 查询和运行时校验使用。 */
export const GAME_ORIGINS = ["https://game.granbluefantasy.jp", "https://gbf.game.mbga.jp"] as const;
export const GAME_MATCHES = GAME_ORIGINS.map((origin) => `${origin}/*`);
/** 单条正文、读取响应及整个 Debug 会话分别设置独立预算。 */
export const MAX_CAPTURE_COUNT = 100;
export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_STORAGE_BYTES = 700 * 1024;
const SECRET_KEYS = /^(?:authorization|cookie|setcookie|password|passwd|secret|session|sessionid|sid|csrf|xsrf|uid|userid|user_id|playerid|accountid|email|mail|phone|username|nickname)$|token$|secret$|password$|userid$|username$|nickname$/iu;

/** unknown 对象的基础守卫；数组由调用方单独处理。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 使用 URL.origin 精确匹配，拒绝伪装子域、凭据 URL 和超长输入。 */
export function isGameUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return GAME_ORIGINS.some((origin) => origin === url.origin) && !url.username && !url.password;
  } catch { return false; }
}

/** 跨边界前仅保留 origin/path，移除 query 和 hash 中可能出现的标识。 */
export function sanitizeUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

/** 跨 world 的数据有节点和深度预算，拒绝循环或非 JSON 对象。 */
export function isJsonValue(value: unknown): value is JsonValue {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (!item || ++count > 100_000 || item.depth > 64) return false;
    const current = item.value;
    if (current === null || typeof current === "boolean" || typeof current === "string") continue;
    if (typeof current === "number") { if (!Number.isFinite(current)) return false; continue; }
    if (typeof current !== "object" || seen.has(current)) return false;
    if (!Array.isArray(current) && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false;
    seen.add(current);
    for (const child of Object.values(current)) pending.push({ value: child, depth: item.depth + 1 });
  }
  return true;
}

/** 使用 UTF-8 字节数而非字符串长度，与 Chrome storage 配额更接近。 */
export function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** 在 MAIN world 内先脱敏，原始正文不跨越页面边界。 */
export function redactValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key, SECRET_KEYS.test(key.replace(/[^a-z0-9]/giu, "")) ? "[已脱敏]" : redactValue(child as JsonValue)
    ]));
  }
  if (typeof value === "string" && /^https?:\/\//iu.test(value)) {
    try { return sanitizeUrl(value); } catch { return "[无效 URL]"; }
  }
  return value;
}

/** 校验、脱敏并创建 MAIN → content 载荷；超大正文只保留元数据。 */
export function createPayload(
  url: string, status: number, body: unknown, method: string, source: CaptureSource, sessionId: string
): CapturePayload | null {
  if (!isGameUrl(url) || !isJsonValue(body) || !Number.isInteger(status) || status < 0 || status > 599 || !/^[A-Z]{1,16}$/u.test(method.toUpperCase())) return null;
  const safeBody = redactValue(body);
  const bodyBytes = byteLength(safeBody);
  return {
    body: bodyBytes > MAX_BODY_BYTES ? null : safeBody,
    bodyBytes,
    capturedAt: new Date().toISOString(),
    method: method.toUpperCase(),
    sessionId,
    source,
    status,
    truncated: bodyBytes > MAX_BODY_BYTES,
    url: sanitizeUrl(url)
  };
}

/** 后台重新验证来自 content 的完整载荷，不能依赖 TypeScript 类型或前一层检查。 */
export function isCapturePayload(value: unknown): value is CapturePayload {
  return isRecord(value) && isGameUrl(value.url) && typeof value.method === "string" && /^[A-Z]{1,16}$/u.test(value.method) &&
    Number.isInteger(value.status) && Number(value.status) >= 0 && Number(value.status) <= 599 &&
    typeof value.sessionId === "string" && value.sessionId.length > 0 && value.sessionId.length <= 100 &&
    (value.source === "fetch" || value.source === "xhr") && typeof value.truncated === "boolean" &&
    typeof value.bodyBytes === "number" && Number.isSafeInteger(value.bodyBytes) && value.bodyBytes >= 0 &&
    value.bodyBytes <= MAX_RESPONSE_BYTES * 6 && typeof value.capturedAt === "string" &&
    value.capturedAt.length <= 32 && Number.isFinite(Date.parse(value.capturedAt)) && isJsonValue(value.body) &&
    (value.truncated ? value.body === null : byteLength(value.body) <= MAX_BODY_BYTES);
}

/** storage.session 恢复时额外验证后台生成的 id 和 tabId。 */
export function isDebugCapture(value: unknown): value is DebugCapture {
  return isCapturePayload(value) && "id" in value && typeof value.id === "string" && value.id.length <= 100 &&
    "tabId" in value && Number.isSafeInteger(value.tabId) && Number(value.tabId) >= 0;
}

/** 状态广播不携带正文或会话令牌，详情必须按 id 单独读取。 */
export function toMetadata(capture: DebugCapture): CaptureMetadata {
  const { body: _body, sessionId: _sessionId, ...metadata } = capture;
  return metadata;
}

/** 输入按新到旧排列；达到条数或字节上限时丢弃当前项及更旧项。 */
export function retainCaptures(captures: readonly DebugCapture[]): DebugCapture[] {
  const retained: DebugCapture[] = [];
  let size = 2;
  for (const capture of captures) {
    const nextSize = byteLength(capture) + 1;
    if (retained.length >= MAX_CAPTURE_COUNT || size + nextSize > MAX_STORAGE_BYTES) break;
    retained.push(capture);
    size += nextSize;
  }
  return retained;
}

/** 组合 Debug 与战斗摘要，并计算面板显示的实际会话占用。 */
export function snapshot(session: DebugSession, battle: BattleSnapshot = { currentId: null, records: [], error: null }): DebugSnapshot {
  return {
    battle,
    captures: session.captures.map(toMetadata), error: session.error, listening: session.listening,
    revision: session.revision, tabId: session.tabId, storedBytes: byteLength(session.captures)
  };
}
