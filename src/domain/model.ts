import type { BattleSnapshot } from "./battle/model";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type CaptureSource = "fetch" | "xhr";

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

export interface DebugCapture extends CapturePayload {
  id: string;
  tabId: number;
}

export type CaptureMetadata = Omit<DebugCapture, "body" | "sessionId">;

export interface DebugSnapshot {
  battle: BattleSnapshot;
  captures: CaptureMetadata[];
  error: string | null;
  listening: boolean;
  revision: number;
  tabId: number | null;
  storedBytes: number;
}

export interface DebugSession {
  captures: DebugCapture[];
  error: string | null;
  listening: boolean;
  revision: number;
  sessionId: string | null;
  tabId: number | null;
}

export function emptySession(): DebugSession {
  return { captures: [], error: null, listening: false, revision: 0, sessionId: null, tabId: null };
}
