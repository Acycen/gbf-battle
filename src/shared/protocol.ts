import { isCapturePayload, isRecord } from "../domain/capture";
import type { CapturePayload, DebugSnapshot } from "../domain/model";

/** window.postMessage 的方向标签，避免把控制消息与采集消息混淆。 */
export const PAGE_CHANNEL = "gbf-battle/page";
export const CONTENT_CHANNEL = "gbf-battle/content";

/** background → content → MAIN 的唯一控制协议，不包含任何游戏操作。 */
export interface ListenerControl {
  type: "LISTENER_CONTROL";
  command: "START" | "STOP";
  sessionId: string | null;
}

/** MAIN → content 的就绪握手与单向采集协议。 */
export type PageMessage =
  | { channel: typeof PAGE_CHANNEL; type: "PAGE_BRIDGE_READY" }
  | { channel: typeof PAGE_CHANNEL; type: "AJAX_CAPTURED"; payload: CapturePayload };

/** panel → background 的查询和控制命令白名单。 */
export type PanelRequest =
  | { type: "GET_GAME_TABS" }
  | { type: "GET_SNAPSHOT" }
  | { type: "START_LISTENING"; tabId: number }
  | { type: "STOP_LISTENING" }
  | { type: "GET_CAPTURE"; id: string }
  | { type: "GET_CAPTURE_EXPORT" }
  | { type: "GET_BATTLE_RECORD"; raidId: string }
  | { type: "GET_BATTLE_EXPORT" }
  | { type: "DELETE_BATTLE_RECORD"; raidId: string }
  | { type: "CLEAR_BATTLE_RECORDS" }
  | { type: "CLEAR_CAPTURES" };

/** Chrome runtime 总线上可能出现的全部项目消息。 */
export type RuntimeMessage = PanelRequest | ListenerControl |
  { type: "PAGE_BRIDGE_READY" } |
  { type: "AJAX_CAPTURED"; payload: CapturePayload } |
  { type: "STATE_UPDATED"; snapshot: DebugSnapshot };

/** 面板标签页选择器只需要稳定 id 和用于显示的 host。 */
export interface GameTabInfo { id: number; host: string }

/** START 必须携带有界 sessionId，STOP 必须显式清空它。 */
export function isListenerControl(value: unknown): value is ListenerControl {
  return isRecord(value) && value.type === "LISTENER_CONTROL" &&
    (value.command === "STOP" ? value.sessionId === null : value.command === "START" &&
      typeof value.sessionId === "string" && value.sessionId.length > 0 && value.sessionId.length <= 100);
}

/** content 对 MAIN 消息执行协议形状和 capture 载荷的第一次完整校验。 */
export function isPageMessage(value: unknown): value is PageMessage {
  return isRecord(value) && value.channel === PAGE_CHANNEL &&
    (value.type === "PAGE_BRIDGE_READY" || value.type === "AJAX_CAPTURED" && isCapturePayload(value.payload));
}

/** background 只接受列出的面板命令，并限制所有用户可控标识。 */
export function isPanelRequest(value: unknown): value is PanelRequest {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "START_LISTENING": return Number.isSafeInteger(value.tabId) && Number(value.tabId) >= 0;
    case "GET_CAPTURE": return typeof value.id === "string" && value.id.length <= 100;
    case "GET_BATTLE_RECORD": case "DELETE_BATTLE_RECORD": return typeof value.raidId === "string" && value.raidId.length > 0 && value.raidId.length <= 200;
    case "GET_GAME_TABS": case "GET_SNAPSHOT": case "STOP_LISTENING":
    case "GET_CAPTURE_EXPORT": case "CLEAR_CAPTURES": case "GET_BATTLE_EXPORT": case "CLEAR_BATTLE_RECORDS": return true;
    default: return false;
  }
}
