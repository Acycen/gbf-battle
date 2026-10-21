import assert from "node:assert/strict";
import test from "node:test";
import { createPayload } from "../src/domain/capture";
import { CONTENT_CHANNEL, PAGE_CHANNEL } from "../src/shared/protocol";

test("content 校验来源与协议，迟到握手不能覆盖用户停止指令", async () => {
  const handlers: Array<(event: MessageEvent<unknown>) => void> = [];
  const posted: unknown[] = [];
  const sent: unknown[] = [];
  const pending: Array<(control: unknown) => void> = [];
  let runtime: Parameters<typeof chrome.runtime.onMessage.addListener>[0] | undefined;
  const fakeWindow = {
    location: { origin: "https://game.granbluefantasy.jp" },
    addEventListener: (_type: string, handler: (event: MessageEvent<unknown>) => void) => { handlers.push(handler); },
    postMessage: (message: unknown) => { posted.push(message); }
  };
  const mock = {
    runtime: {
      id: "test",
      onMessage: { addListener: (handler: typeof runtime) => { runtime = handler; } },
      sendMessage: (message: { type: string }): Promise<unknown> => {
        sent.push(message);
        return message.type === "PAGE_BRIDGE_READY" ? new Promise((resolve) => { pending.push(resolve); }) : Promise.resolve();
      }
    }
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: mock });
  await import("../src/content/index");
  const dispatch = (data: unknown, origin = fakeWindow.location.origin, source: unknown = fakeWindow): void => {
    for (const handler of handlers) handler({ data, origin, source } as MessageEvent<unknown>);
  };
  dispatch({ channel: PAGE_CHANNEL, type: "PAGE_BRIDGE_READY" });
  assert.equal(pending.length, 2);
  const stop = { type: "LISTENER_CONTROL", command: "STOP", sessionId: null };
  runtime?.(stop, { id: "test" }, () => undefined);
  for (const resolve of pending) resolve({ type: "LISTENER_CONTROL", command: "START", sessionId: "stale" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(posted, [{ ...stop, channel: CONTENT_CHANNEL }]);
  runtime?.({ type: "LISTENER_CONTROL", command: "START", sessionId: "wrong" }, { id: "foreign" }, () => undefined);
  assert.equal(posted.length, 1);
  const payload = createPayload("https://game.granbluefantasy.jp/debug/example", 200, { value: 1 }, "GET", "fetch", "active");
  assert.ok(payload);
  const capture = { type: "AJAX_CAPTURED", channel: PAGE_CHANNEL, payload };
  dispatch(capture, "https://example.com");
  dispatch(capture, fakeWindow.location.origin, {});
  dispatch({ ...capture, channel: "other" });
  dispatch({ ...capture, payload: { ...payload, url: "https://example.com" } });
  dispatch({ ...capture, payload: { ...payload, url: "https://gbf.game.mbga.jp/debug/example" } });
  assert.equal(sent.length, 2);
  dispatch(capture);
  assert.deepEqual(sent[2], { type: "AJAX_CAPTURED", payload });
});
