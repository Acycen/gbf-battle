import type { PanelRequest } from "../shared/protocol";

/** 面板命令的统一 Promise 包装；null/undefined 表示后台未处理或执行失败。 */
export async function request<T>(message: PanelRequest): Promise<T> {
  const result: unknown = await chrome.runtime.sendMessage(message);
  if (result === undefined || result === null) throw new Error("后台未返回数据，请重新加载扩展后重试。");
  return result as T;
}

/** 通过临时 Blob 触发纯本地 JSON 下载，并及时释放对象 URL。 */
export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Debug 容量较小，统一以 B/KB 展示即可。 */
export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
