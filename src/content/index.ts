import { isGameUrl, isRecord } from "../domain/capture";
import { CONTENT_CHANNEL, isListenerControl, isPageMessage, type ListenerControl, type RuntimeMessage } from "../shared/protocol";

let controlRevision = 0;
function postControl(control: ListenerControl): void {
  window.postMessage({ ...control, channel: CONTENT_CHANNEL }, window.location.origin);
}

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
  if (!isGameUrl(event.data.payload.url)) return;
  void chrome.runtime.sendMessage({ type: "AJAX_CAPTURED", payload: event.data.payload } satisfies RuntimeMessage)
    .catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || !isRecord(message) || !isListenerControl(message)) return false;
  controlRevision += 1;
  postControl(message);
  return false;
});

// 同时使用主动握手和 MAIN ready，兼容不同 world 的加载顺序。
restoreControl();
