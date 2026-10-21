import { isGameUrl, isRecord } from "../domain/capture";
import { CONTENT_CHANNEL, isListenerControl, isPageMessage, type ListenerControl, type RuntimeMessage } from "../shared/protocol";

/** ISOLATED world 只负责双向协议校验和桥接，不解析或保存战斗数据。 */
let controlRevision = 0;

/** 控制消息只发往当前 window/origin，由 MAIN 中的监听器接收。 */
function postControl(control: ListenerControl): void {
  window.postMessage({ ...control, channel: CONTENT_CHANNEL }, window.location.origin);
}

/** 向可能刚被唤醒的 Service Worker 查询当前监听状态。 */
function restoreControl(): void {
  const revision = controlRevision;
  void chrome.runtime.sendMessage({ type: "PAGE_BRIDGE_READY" } satisfies RuntimeMessage)
    .then((control: unknown) => {
      // 迟到的初始化查询不能覆盖用户刚发出的 STOP/START。
      if (revision === controlRevision && isListenerControl(control)) postControl(control);
    }).catch(() => undefined);
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== window.location.origin || !isPageMessage(event.data)) return;
  if (event.data.type === "PAGE_BRIDGE_READY") { restoreControl(); return; }
  if (!isGameUrl(event.data.payload.url) || new URL(event.data.payload.url).origin !== window.location.origin) return;
  // MAIN world 可伪造 postMessage；只转发当前页面同源的响应，避免在两个允许域名之间冒充来源。
  void chrome.runtime.sendMessage({ type: "AJAX_CAPTURED", payload: event.data.payload } satisfies RuntimeMessage)
    .catch(() => undefined);
});

/** 后台直接下发的控制优先于尚未完成的恢复查询。 */
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || !isRecord(message) || !isListenerControl(message)) return false;
  controlRevision += 1;
  postControl(message);
  return false;
});

// 同时使用主动握手和 MAIN ready，兼容不同 world 的加载顺序。
restoreControl();
