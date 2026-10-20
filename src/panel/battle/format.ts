import type { BattleRecord } from "../../domain/battle/model";

export const amount = (value: number | null): string => value === null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
export const OUTCOMES: Record<BattleRecord["outcome"], string> = { active: "进行中", won: "胜利", lost: "全灭", finished: "已结算" };
const IMAGE_ROOT = "https://prd-game-a-granbluefantasy.akamaized.net/assets/img";
export function assetUrl(kind: "enemy" | "npc" | "leader" | "buff", id: string): string | null {
  if (!id || !/^[a-z0-9_-]{1,100}$/iu.test(id)) return null;
  return kind === "buff" ? `${IMAGE_ROOT}/sp/ui/icon/status/x64/status_${id.replace(/-/gu, "")}.png` :
    `${IMAGE_ROOT}/sp/assets/${kind}/s/${id}.${kind === "enemy" ? "png" : "jpg"}`;
}
