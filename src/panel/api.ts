import type { PanelRequest } from "../shared/protocol";

export async function request<T>(message: PanelRequest): Promise<T> {
  const result: unknown = await chrome.runtime.sendMessage(message);
  if (result === undefined || result === null) throw new Error("后台未返回数据，请重新加载扩展后重试。");
  return result as T;
}

export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
