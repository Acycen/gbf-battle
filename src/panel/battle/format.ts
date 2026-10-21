import type { BattleRecord } from "../../domain/battle/model";

/** 未知值统一显示破折号，避免把 null 误呈现为零。 */
export const amount = (value: number | null): string => value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
/** 倒计时和操作时长统一使用向下取整的 MM:SS。 */
export function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
export const OUTCOMES: Record<BattleRecord["outcome"], string> = { active: "进行中", won: "胜利", lost: "全灭", finished: "已结算" };
const IMAGE_ROOT = "https://prd-game-a-granbluefantasy.akamaized.net/assets/img";
/**
 * 只允许短资源标识拼接到固定游戏 CDN 根路径，拒绝路径穿越和任意远程 URL。
 * 这些地址仅用于 img 展示，不会调用游戏数据接口。
 */
export function assetUrl(kind: "enemy" | "npc" | "leader" | "buff", id: string): string | null {
  if (!id || !/^[a-z0-9_-]{1,100}$/iu.test(id)) return null;
  return kind === "buff" ? `${IMAGE_ROOT}/sp/ui/icon/status/x64/status_${id.replace(/-/gu, "")}.png` :
    `${IMAGE_ROOT}/sp/assets/${kind}/s/${id}.${kind === "enemy" ? "png" : "jpg"}`;
}
