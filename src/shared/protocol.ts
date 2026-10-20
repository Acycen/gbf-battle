import { isCapturePayload, isRecord } from "../domain/capture";
import type { CapturePayload, DebugSnapshot } from "../domain/model";

export const PAGE_CHANNEL = "gbf-battle/page";
export const CONTENT_CHANNEL = "gbf-battle/content";

export interface ListenerControl {
  type: "LISTENER_CONTROL";
  command: "START" | "STOP";
  sessionId: string | null;
}

export type PageMessage =
  | { channel: typeof PAGE_CHANNEL; type: "PAGE_BRIDGE_READY" }
  | { channel: typeof PAGE_CHANNEL; type: "AJAX_CAPTURED"; payload: CapturePayload };

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

export type RuntimeMessage = PanelRequest | ListenerControl |
  { type: "PAGE_BRIDGE_READY" } |
  { type: "AJAX_CAPTURED"; payload: CapturePayload } |
  { type: "STATE_UPDATED"; snapshot: DebugSnapshot };

export interface GameTabInfo { id: number; host: string }

export function isListenerControl(value: unknown): value is ListenerControl {
  return isRecord(value) && value.type === "LISTENER_CONTROL" &&
    (value.command === "STOP" ? value.sessionId === null : value.command === "START" &&
      typeof value.sessionId === "string" && value.sessionId.length > 0 && value.sessionId.length <= 100);
}

export function isPageMessage(value: unknown): value is PageMessage {
  return isRecord(value) && value.channel === PAGE_CHANNEL &&
    (value.type === "PAGE_BRIDGE_READY" || value.type === "AJAX_CAPTURED" && isCapturePayload(value.payload));
}

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
