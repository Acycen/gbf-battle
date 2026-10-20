import assert from "node:assert/strict";
import test from "node:test";
import { byteLength, createPayload, isCapturePayload, isGameUrl, isJsonValue, MAX_BODY_BYTES, MAX_CAPTURE_COUNT, MAX_STORAGE_BYTES, redactValue, retainCaptures, snapshot } from "../src/domain/capture";
import { emptySession, type DebugCapture } from "../src/domain/model";
import { CONTENT_CHANNEL, isListenerControl, isPageMessage, isPanelRequest, PAGE_CHANNEL } from "../src/shared/protocol";

const url = "https://game.granbluefantasy.jp/debug/example?token=private#private";

function capture(index: number, body: unknown = { value: index }): DebugCapture {
  const payload = createPayload(url, 200, body, "get", "fetch", "session-test");
  assert.ok(payload);
  return { ...payload, id: String(index), tabId: 7 };
}

test("仅允许两个 GBF origin，拒绝伪装域名和 URL 凭据", () => {
  assert.ok(isGameUrl(url));
  assert.ok(isGameUrl("https://gbf.game.mbga.jp/example"));
  for (const other of ["https://game.granbluefantasy.jp.evil.test/", "http://game.granbluefantasy.jp/", "https://user:secret@game.granbluefantasy.jp/", "invalid", null]) assert.equal(isGameUrl(other), false);
});

test("跨页面传输前脱敏且不改变原始响应", () => {
  const body = { access_token: "secret", user_id: "123", nested: { Cookie: "secret", refreshToken: "secret", hp: 99 }, url: "https://example.com/path?token=secret#secret" };
  const payload = capture(1, body);
  assert.equal(payload.url, "https://game.granbluefantasy.jp/debug/example");
  assert.deepEqual(payload.body, { access_token: "[已脱敏]", user_id: "[已脱敏]", nested: { Cookie: "[已脱敏]", refreshToken: "[已脱敏]", hp: 99 }, url: "https://example.com/path" });
  assert.equal(body.access_token, "secret");
  assert.equal(body.nested.hp, 99);
  assert.equal(payload.method, "GET");
  assert.equal(JSON.stringify(payload).includes("secret"), false);
  assert.deepEqual(redactValue([null, true, 1]), [null, true, 1]);
});

test("非法 JSON、过深结构和循环引用被拒绝", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  for (const value of [NaN, Infinity, undefined, () => 0, new Date(), cyclic]) assert.equal(isJsonValue(value), false);
  let deep: unknown = null;
  for (let index = 0; index < 1000; index += 1) deep = [deep];
  assert.equal(isJsonValue(deep), false);
  assert.equal(createPayload(url, 200, cyclic, "GET", "fetch", "test"), null);
  assert.equal(createPayload(url, 999, {}, "GET", "fetch", "test"), null);
});

test("正文超限保留元数据；历史同时受条数和字节预算约束", () => {
  const large = capture(1, "a".repeat(MAX_BODY_BYTES + 1));
  assert.equal(large.body, null);
  assert.equal(large.truncated, true);
  assert.ok(large.bodyBytes > MAX_BODY_BYTES);
  assert.equal(retainCaptures(Array.from({ length: 110 }, (_, index) => capture(index))).length, MAX_CAPTURE_COUNT);
  const retained = retainCaptures(Array.from({ length: 100 }, (_, index) => capture(index, "a".repeat(30_000))));
  assert.ok(retained.length > 0 && retained.length < 100);
  assert.ok(byteLength(retained) <= MAX_STORAGE_BYTES);
  assert.equal(retained[0]?.id, "0");
});

test("协议守卫拒绝伪造消息；轻量快照不携带正文和 sessionId", () => {
  const payload = capture(1);
  assert.ok(isCapturePayload(payload));
  assert.ok(isPageMessage({ channel: PAGE_CHANNEL, type: "AJAX_CAPTURED", payload }));
  assert.equal(isPageMessage({ channel: CONTENT_CHANNEL, type: "AJAX_CAPTURED", payload }), false);
  assert.equal(isCapturePayload({ ...payload, body: undefined }), false);
  assert.equal(isCapturePayload({ ...payload, truncated: true, body: {} }), false);
  assert.ok(isListenerControl({ type: "LISTENER_CONTROL", command: "STOP", sessionId: null }));
  assert.equal(isListenerControl({ type: "LISTENER_CONTROL", command: "START", sessionId: null }), false);
  assert.equal(isPanelRequest({ type: "START_LISTENING", tabId: -1 }), false);
  const result = snapshot({ ...emptySession(), captures: [payload] });
  assert.equal("body" in result.captures[0]!, false);
  assert.equal("sessionId" in result.captures[0]!, false);
});
