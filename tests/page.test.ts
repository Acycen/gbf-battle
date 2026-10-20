import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_CHANNEL, isPageMessage, type PageMessage } from "../src/shared/protocol";

class FakeXhr extends EventTarget {
  response: unknown = null;
  responseText = "";
  responseType: XMLHttpRequestResponseType = "";
  responseURL = "";
  status = 0;
  sends = 0;
  failNext = false;
  sentBody: unknown;
  open(_method: string, url: string): void { this.responseURL = new URL(url, "https://game.granbluefantasy.jp").href; }
  send(body?: unknown): void {
    if (this.failNext) { this.failNext = false; throw new Error("original send failure"); }
    this.sends += 1; this.sentBody = body;
  }
  complete(body: unknown): void {
    this.status = 200;
    this.response = body;
    this.responseText = JSON.stringify(body);
    this.dispatchEvent(new Event("load"));
    this.dispatchEvent(new Event("loadend"));
  }
}

test("MAIN 监听保留 fetch/XHR 语义，停止及跨会话迟到响应不会采集", async () => {
  const handlers: Array<(event: MessageEvent<unknown>) => void> = [];
  const posted: PageMessage[] = [];
  let lastPromise: Promise<Response>;
  let fetchCalls = 0;
  let deferred: ((response: Response) => void) | undefined;
  const nativeFetch = (input: RequestInfo | URL): Promise<Response> => {
    fetchCalls += 1;
    if (String(input).includes("deferred")) lastPromise = new Promise((resolve) => { deferred = resolve; });
    else if (String(input).includes("reject")) lastPromise = Promise.reject(new Error("original failure"));
    else lastPromise = Promise.resolve(new Response(String(input).includes("html") ? "<html>example</html>" : JSON.stringify({ via: "fetch", access_token: "private" })));
    return lastPromise;
  };
  const fakeWindow = {
    location: { href: "https://game.granbluefantasy.jp/", origin: "https://game.granbluefantasy.jp" },
    fetch: nativeFetch,
    addEventListener(type: string, handler: (event: MessageEvent<unknown>) => void): void { if (type === "message") handlers.push(handler); },
    postMessage(message: unknown): void { if (isPageMessage(message)) posted.push(message); }
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeXhr });
  await import("../src/page/index");
  assert.equal(posted[0]?.type, "PAGE_BRIDGE_READY");
  const control = (command: "START" | "STOP", sessionId: string | null, origin = fakeWindow.location.origin): void => {
    for (const handler of handlers) handler({ source: fakeWindow, origin, data: { channel: CONTENT_CHANNEL, type: "LISTENER_CONTROL", command, sessionId } } as unknown as MessageEvent<unknown>);
  };
  const captures = () => posted.filter((message) => message.type === "AJAX_CAPTURED");
  const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

  await fakeWindow.fetch("/debug/idle");
  control("START", "wrong", "https://example.com");
  await fakeWindow.fetch("/debug/foreign");
  await flush();
  assert.equal(captures().length, 0);
  control("START", "session-one");
  const result = fakeWindow.fetch("/debug/fetch");
  assert.equal(result, lastPromise!);
  assert.deepEqual(await (await result).json(), { via: "fetch", access_token: "private" });
  const xhr = new FakeXhr();
  xhr.open("POST", "/debug/xhr");
  xhr.send("original request body");
  xhr.complete({ via: "xhr", token: "private" });
  await flush();
  assert.equal(xhr.sends, 1);
  assert.equal(xhr.sentBody, "original request body");
  assert.equal(xhr.responseText, '{"via":"xhr","token":"private"}');
  assert.equal(captures().length, 2);
  assert.equal(JSON.stringify(captures()).includes("private"), false);
  const beforeIgnored = fetchCalls;
  await fakeWindow.fetch("https://example.com/debug/ignored");
  await fakeWindow.fetch("/debug/html");
  await assert.rejects(fakeWindow.fetch("/debug/reject"), /original failure/u);
  await flush();
  assert.equal(fetchCalls - beforeIgnored, 3);
  assert.equal(captures().length, 2);

  const late = fakeWindow.fetch("/debug/deferred");
  const lateXhr = new FakeXhr();
  lateXhr.open("GET", "/debug/late-xhr"); lateXhr.send();
  control("STOP", null);
  control("START", "session-two");
  deferred?.(new Response('{"late":true}'));
  await late;
  lateXhr.complete({ late: true });
  await flush();
  assert.equal(captures().length, 2);
  control("STOP", null);
  await fakeWindow.fetch("/debug/stopped");
  await flush();
  assert.equal(captures().length, 2);
  control("START", "session-three");
  const reused = new FakeXhr();
  reused.open("GET", "/debug/failed-send");
  reused.failNext = true;
  assert.throws(() => reused.send(), /original send failure/u);
  reused.open("GET", "/debug/reused-after-failure");
  reused.send();
  reused.complete({ reused: true });
  assert.equal(captures().length, 3);
  assert.equal(reused.sends, 1);
});
