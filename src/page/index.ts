import { createPayload, isGameUrl, MAX_RESPONSE_BYTES } from "../domain/capture";
import { CONTENT_CHANNEL, isListenerControl, PAGE_CHANNEL, type PageMessage } from "../shared/protocol";

const originalFetch = window.fetch;
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
let sessionId: string | null = null;

function resolveUrl(value: string): string {
  return new URL(value, window.location.href).href;
}

function emit(url: string, status: number, body: unknown, method: string, source: "fetch" | "xhr", startedSession: string): void {
  if (sessionId !== startedSession) return;
  try {
    const payload = createPayload(url, status, body, method, source, startedSession);
    if (!payload) return;
    const message: PageMessage = { channel: PAGE_CHANNEL, type: "AJAX_CAPTURED", payload };
    window.postMessage(message, window.location.origin);
  } catch { /* 调试失败不得改变游戏响应。 */ }
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) throw new Error("Response exceeds debug budget");
      chunks.push(result.value);
    }
  } finally {
    // clone 的另一分支可能仍由页面消费，不能等待取消 promise 阻塞监听。
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

// 包装器在 document_start 安装；关闭监听时不复制或解析响应体。
window.fetch = function (this: Window, ...args: Parameters<typeof window.fetch>): ReturnType<typeof window.fetch> {
  const responsePromise = originalFetch.apply(this, args);
  const startedSession = sessionId;
  if (startedSession) {
    try {
      const [input, init] = args;
      const url = resolveUrl(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (isGameUrl(url)) {
        void responsePromise.then(async (response) => {
          const finalUrl = response.url || url;
          if (sessionId !== startedSession || !isGameUrl(finalUrl)) return;
          const body = await readJson(response.clone());
          emit(finalUrl, response.status, body, method, "fetch", startedSession);
        }).catch(() => undefined);
      }
    } catch { /* 仅辅助采集失败；仍返回原始 promise。 */ }
  }
  return responsePromise;
};

type OpenArguments = [method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null];
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: OpenArguments): void {
  Reflect.apply(originalOpen, this, args);
  requests.delete(this);
  try {
    const url = resolveUrl(String(args[1]));
    if (isGameUrl(url)) requests.set(this, { method: args[0], url });
  } catch { /* 交给原生 open 处理 URL 语义。 */ }
} as XMLHttpRequest["open"];

XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>): void {
  const metadata = requests.get(this);
  const startedSession = sessionId;
  let cleanup: (() => void) | undefined;
  if (metadata && startedSession) {
    const onLoad = (): void => {
      if (sessionId !== startedSession) return;
      try {
        let body: unknown;
        if (this.responseType === "json") body = this.response;
        else if (this.responseType === "" || this.responseType === "text") {
          if (!this.responseText || this.responseText.length > MAX_RESPONSE_BYTES) return;
          body = JSON.parse(this.responseText) as unknown;
        } else return;
        emit(this.responseURL || metadata.url, this.status, body, metadata.method, "xhr", startedSession);
      } catch { /* 非 JSON、无效响应和读取错误都不干扰游戏。 */ }
    };
    const onEnd = (): void => {
      this.removeEventListener("load", onLoad);
      this.removeEventListener("loadend", onEnd);
    };
    cleanup = onEnd;
    this.addEventListener("load", onLoad, { once: true });
    this.addEventListener("loadend", onEnd, { once: true });
  }
  try { Reflect.apply(originalSend, this, args); }
  catch (error: unknown) { cleanup?.(); throw error; }
};

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin ||
    typeof event.data !== "object" || event.data === null || !("channel" in event.data) ||
    event.data.channel !== CONTENT_CHANNEL || !isListenerControl(event.data)) return;
  sessionId = event.data.command === "START" ? event.data.sessionId : null;
});

const ready: PageMessage = { channel: PAGE_CHANNEL, type: "PAGE_BRIDGE_READY" };
window.postMessage(ready, window.location.origin);
