import { useEffect, useRef, useState } from "react";
import type { BattleRecord, BattleSnapshot } from "../../domain/battle/model";
import { exportBattle } from "../../domain/battle/storage";
import type { DebugSnapshot } from "../../domain/model";
import { downloadJson, request } from "../api";
import { BattleDetail } from "./BattleDetail";
import { amount, duration, OUTCOMES } from "./format";

/** 详情按 raidId 从后台读取；revision 变化时刷新活动战斗的实时内容。 */
function LoadedDetail({ raidId, revision, live }: { raidId: string; revision: number; live: boolean }): React.JSX.Element {
  const [battle, setBattle] = useState<BattleRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // 旧 raid 请求完成时组件可能已切换，active 防止覆盖新选择。
    let active = true;
    void chrome.runtime.sendMessage({ type: "GET_BATTLE_RECORD", raidId }).then((result: BattleRecord | null) => {
      if (!active) return;
      setBattle(result);
      setError(result ? null : "记录不存在或已被淘汰。");
    }).catch(() => { if (active) setError("读取战斗记录失败。"); });
    return () => { active = false; };
  }, [raidId, revision]);
  if (error) return <p className="notice error" role="alert">{error}</p>;
  if (!battle) return <p className="empty">正在读取战斗记录…</p>;
  return <><BattleDetail battle={battle} live={live} /><div className="record-detail-tools"><button onClick={() => downloadJson({ schemaVersion: 1, exportedAt: new Date().toISOString(), battle: exportBattle(battle) }, `gbf-battle-${battle.raidId}.json`)}>导出当前战斗 JSON</button></div></>;
}

/** 在“当前战斗”和“历史记录”之间复用同一详情组件，并管理导出/删除操作。 */
export function BattlePanel({ state, revision, mode, listening, onSnapshot }: {
  state: BattleSnapshot; revision: number; mode: "battle" | "history"; listening: boolean; onSnapshot: (snapshot: DebugSnapshot) => void;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = state.records.filter((battle) => `${battle.name} ${battle.raidId}`.toLowerCase().includes(filter.toLowerCase()));
  const selected = mode === "battle" ? state.currentId : state.records.find((battle) => battle.raidId === selectedId)?.raidId ?? null;
  useEffect(() => {
    if (mode === "history") panelRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [selectedId, mode]);
  /** 历史操作共享忙碌状态，防止重复点击并集中展示错误。 */
  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true); setError(null);
    try { await work(); } catch (reason: unknown) { setError(reason instanceof Error ? reason.message : "操作失败。"); }
    finally { setBusy(false); }
  }
  return <section ref={panelRef} className={`battle-panel ${mode === "history" ? "history-mode" : ""}`}>
    {state.error || error ? <p className="notice error" role="alert">{error ?? state.error}</p> : null}
    {mode === "history" ? <><div className="history-heading">{selected ? <button className="back-button" onClick={() => setSelectedId(null)}>← 返回记录</button> : <h2>战斗记录 <small>{state.records.length} / 10</small></h2>}</div><div className="history-tools">
      {!selected ? <input aria-label="搜索战斗记录" placeholder="搜索副本名称 / Raid ID" value={filter} onChange={(event) => setFilter(event.target.value)} /> : null}
      <button disabled={busy || !state.records.length} onClick={() => void run(async () => {
        const records = await request<unknown[]>({ type: "GET_BATTLE_EXPORT" });
        downloadJson({ schemaVersion: 1, exportedAt: new Date().toISOString(), records }, `gbf-battle-history-${Date.now()}.json`);
      })}>导出全部战斗</button>
      {selected ? <button className="danger" disabled={busy} onClick={() => {
        if (selected && window.confirm("删除当前选中的战斗记录？")) void run(async () => onSnapshot(await request<DebugSnapshot>({ type: "DELETE_BATTLE_RECORD", raidId: selected })));
      }}>删除当前</button> : null}
      <button className="danger" disabled={busy || !state.records.length} onClick={() => {
        if (window.confirm("清空本地保存的全部战斗记录？")) void run(async () => onSnapshot(await request<DebugSnapshot>({ type: "CLEAR_BATTLE_RECORDS" })));
      }}>清空历史</button>
    </div></> : null}
      {mode === "history" && !selected ? <div className="history-list" aria-label="战斗记录列表">{filtered.length ? filtered.map((battle) => <button className="history-card" key={battle.raidId} onClick={() => setSelectedId(battle.raidId)} aria-label={`查看 ${battle.name} 的战斗详情`}>
        <div className="history-card-heading"><h3>{battle.name}</h3><span className={`outcome outcome-${battle.outcome}`}>{OUTCOMES[battle.outcome]}</span></div>
        <div className="history-metrics"><div><span>伤害</span><strong>{amount(battle.damage)}</strong></div><div><span>操作时长 / 跑速</span><strong>{duration(battle.seconds)} / {battle.speed === null ? "—" : `${battle.speed.toFixed(1)} M/min`}</strong></div><div><span>贡献</span><strong>{amount(battle.contribution)}</strong></div><div><span>回合数</span><strong>{battle.turn}{battle.solo ? " · Solo" : ""}</strong></div></div>
        <div className="history-card-footer"><time>{new Date(battle.startedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</time><span>详情 →</span></div>
      </button>) : <p className="empty">{state.records.length ? "没有匹配的战斗" : "尚无战斗记录"}</p>}</div> : <div className="battle-detail">{selected ? <LoadedDetail key={selected} raidId={selected} revision={revision} live={mode === "battle" && listening} /> : <div className="empty battle-waiting"><span className="empty-icon" aria-hidden="true">⚔</span><h3>等待战斗数据</h3><p>开始监听后进入或刷新战斗页面，读取战斗初始状态。</p></div>}</div>}
  </section>;
}
