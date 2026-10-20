import { useEffect, useState } from "react";
import { percent } from "../../domain/battle/parse";
import type { BattleBuff, BattlePlayer, BattleRecord, DamageKind, TakenKind } from "../../domain/battle/model";
import { summarizeBattle } from "../../domain/battle/storage";
import { amount, assetUrl, duration, OUTCOMES } from "./format";

function Portrait({ kind, id, label }: { kind: "enemy" | "npc" | "leader" | "buff"; id: string; label: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const src = assetUrl(kind, id);
  const iconClass = `battle-icon ${kind === "buff" ? "buff-icon" : ""}`;
  return src && !failed ? <img className={iconClass} src={src} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> :
    <span className={`${iconClass} icon-fallback`} aria-label={label}>{kind === "buff" ? "◇" : label.slice(0, 1)}</span>;
}

function BuffList({ buffs }: { buffs: BattleBuff[] }): React.JSX.Element {
  return <div className="buff-list">{buffs.length ? buffs.map((buff) => <span key={buff.id} className={`buff ${buff.debuff ? "debuff" : ""}`} title={`${buff.name}\n${buff.detail}${buff.remaining !== null ? `\n剩余 ${buff.remaining}` : ""}`} aria-label={buff.name}>
    <Portrait kind="buff" id={buff.id} label={buff.name} />{buff.remaining !== null ? <small>{buff.remaining}</small> : null}
  </span>) : <span className="muted">无已观察到的状态</span>}</div>;
}

const DAMAGE_LABELS: Record<DamageKind, string> = { attack: "普攻 / 反击", ability: "技能", special: "奥义", other: "其他" };
const TAKEN_LABELS: Record<TakenKind, string> = { attack: "普攻 / 反击", super: "特动", other: "其他" };
function Statistics({ battle, taken }: { battle: BattleRecord; taken: boolean }): React.JSX.Element {
  const [category, setCategory] = useState("total");
  const labels: Record<string, string> = taken ? TAKEN_LABELS : DAMAGE_LABELS;
  const value = (player: BattlePlayer): number => {
    const totals: Record<string, number> = taken ? player.taken : player.damage;
    return category === "total" ? Object.values(totals).reduce((sum, item) => sum + item, 0) : totals[category] ?? 0;
  };
  const unassigned: Record<string, number> = taken ? battle.unattributedTaken : battle.unattributed;
  const unknown = category === "total" ? Object.values(unassigned).reduce((sum, item) => sum + item, 0) : unassigned[category] ?? 0;
  const total = battle.players.reduce((sum, player) => sum + value(player), unknown);
  const max = Math.max(1, ...battle.players.map(value));
  return <section className="statistics">
    <div className="section-heading"><h3>{taken ? "承伤统计" : "伤害统计"}</h3><label>分类 <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="total">总计</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <div className="statistics-list">{battle.players.map((player) => <article className="stat-row" key={player.index}>
      <div className={`stat-portrait ${player.alive ? "" : "is-dead"}`} title={`${player.name} · ${battle.formation.includes(player.index) ? "前排" : "后排"}`}><Portrait kind={player.npc ? "npc" : "leader"} id={player.imageId} label={player.name} />{!player.alive ? <span className="dead-label">Dead</span> : null}</div>
      <div className="stat-main"><div className="stat-name"><span title={player.name}>{player.name}</span><small>{total ? `${(value(player) / total * 100).toFixed(1)}%` : "—"}</small></div>
        <progress aria-label={`${player.name}${taken ? "承伤" : "伤害"}`} className={taken ? "taken-progress" : ""} value={value(player)} max={max} />
        <div className="stat-numbers"><span className="stat-counts" title="技能 / 奥义次数">技 {player.abilityUses} · 奥 {player.chargeAttacks}{!taken ? <small className="stat-attacks" title={`有效连击样本 ${player.attacks.total} 次 · SA / DA / TA ${player.attacks.total ? `${Math.round(player.attacks.sa / player.attacks.total * 100)}% / ${Math.round(player.attacks.da / player.attacks.total * 100)}% / ${Math.round(player.attacks.ta / player.attacks.total * 100)}%` : "—"}`}> · TA {player.attacks.total ? `${Math.round(player.attacks.ta / player.attacks.total * 100)}%` : "—"}</small> : null}</span><strong>{amount(value(player))}</strong></div>
      </div>
    </article>)}{unknown > 0 ? <div className="stat-unassigned"><span>未归属</span><strong>{amount(unknown)}</strong><small>{total ? `${(unknown / total * 100).toFixed(1)}%` : "—"}</small></div> : null}</div>
    <div className="stat-total"><span>{taken ? "承伤" : "伤害"}合计</span><strong>{amount(total)}</strong></div>
    <div className="damage-breakdown">{Object.entries(labels).map(([key, label]) => {
      const totalForKind = battle.players.reduce((sum, player) => sum + ((taken ? player.taken : player.damage) as Record<string, number>)[key]!, unassigned[key] ?? 0);
      return <span key={key}>{label} <strong>{amount(totalForKind)}</strong></span>;
    })}</div>
  </section>;
}

function PlayerStatus({ battle }: { battle: BattleRecord }): React.JSX.Element {
  const [frontOnly, setFrontOnly] = useState(true);
  const ordered = [...battle.formation, ...battle.players.map((player) => player.index).filter((index) => !battle.formation.includes(index))];
  return <section className="player-status-section"><div className="section-heading"><h3>角色状态</h3><label><input type="checkbox" checked={frontOnly} onChange={(event) => setFrontOnly(event.target.checked)} /> 仅前排</label></div>
    <div className="player-status-grid">{ordered.filter((index) => !frontOnly || battle.formation.includes(index)).map((index) => {
      const player = battle.players[index]!;
      return <article className="player-status" key={index}><div className="player-cell"><Portrait kind={player.npc ? "npc" : "leader"} id={player.imageId} label={player.name} /><div><h4>{player.name}</h4><small>{player.alive ? "存活" : "战斗不能"} · HP {amount(player.hp)} / {amount(player.maxHp)}{player.shield ? ` · 护盾 ${amount(player.shield)}` : ""}</small></div></div><BuffList buffs={player.buffs} /></article>;
    })}</div>
    <p className="battle-note">HP 仅在响应明确提供数值时更新；状态列表以最近一次已观察到的更新为准。</p>
  </section>;
}

export function ActionTimeline({ battle }: { battle: BattleRecord }): React.JSX.Element {
  const [reverse, setReverse] = useState(true);
  const turns = reverse ? [...battle.turns].reverse() : battle.turns;
  return <section><div className="section-heading"><h3>回合行动</h3><label><input type="checkbox" checked={reverse} onChange={(event) => setReverse(event.target.checked)} /> 最新回合在前</label></div>
    {battle.timelineTruncated ? <p className="notice">部分行动或状态明细已按容量限制省略，累计伤害仍保留。</p> : null}
    <div className="turn-list">{turns.map((turn, index) => <article className="turn-card" key={`${turn.turn}-${index}`}>
      <div className="turn-header"><h4>第 {turn.turn} 回合</h4><span>Boss {turn.hpPercent === null ? "—" : `${turn.hpPercent}%`}</span><span>奥义 {turn.chargeAttackEnabled === null ? "未知" : turn.chargeAttackEnabled ? "ON" : "OFF"}</span><span>Guard {turn.guards.map((guard) => guard.enabled === null ? "?" : guard.enabled ? "G" : "·").join(" ") || "—"}</span></div>
      {turn.omens.length ? <div className={`omens ${turn.cancelled ? "cancelled" : ""}`}>{turn.omens.map((omen, position) => <span key={position}>{turn.cancelled ? "已解除 · " : ""}{omen}</span>)}</div> : null}
      {turn.actions.length ? <ol className="actions">{turn.actions.map((action, position) => <li key={position}>
        <span className={`action-kind kind-${action.kind}`}>{action.label}</span><span>{action.actor === null ? "" : battle.players[action.actor]?.name}{action.abilityId ? ` #${action.abilityId}` : ""}</span>
        <span className="action-values">伤害 {amount(action.damage)}{action.taken ? ` / 承伤 ${amount(action.taken)}` : ""}</span>
      </li>)}</ol> : <p className="battle-note">等待本回合行动响应</p>}
      {turn.attack ? <div className="attack-summary"><span>Hit {turn.attack.hits}</span><span>奥义 {amount(turn.attack.special)} · {turn.attack.chain} Chain</span><span>技伤 {amount(turn.attack.ability)}</span><strong>总伤 {amount(turn.attack.total)}</strong></div> : null}
    </article>)}</div>
  </section>;
}

export function BattleDetail({ battle, live = false }: { battle: BattleRecord; live?: boolean }): React.JSX.Element {
  const [tab, setTab] = useState("damage");
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (!live || battle.outcome !== "active") return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, battle.outcome]);
  const summary = summarizeBattle(battle);
  const elapsedSince = (at: string) => live && battle.outcome === "active" ? Math.max(0, (clock - Date.parse(at)) / 1000) : 0;
  const elapsed = elapsedSince(battle.timerUpdatedAt);
  const remaining = battle.timer === null ? null : Math.max(0, battle.timer - elapsed);
  const latestTurn = battle.turns.at(-1);
  const latestAttack = [...battle.turns].reverse().find((turn) => turn.attack)?.attack;
  const circumference = 2 * Math.PI * 134;
  return <div className="battle-detail-content">
    <div className="boss-grid">{battle.bosses.map((boss) => {
      const hp = percent(boss.hp, boss.maxHp);
      return <article className="boss-card" key={boss.index}><div className="boss-orbit">
        <svg className="boss-ring" viewBox="0 0 300 300" role="progressbar" aria-label={`${boss.name} HP`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hp ?? undefined} aria-valuetext={hp === null ? "未知" : `${hp}%`}><circle className="ring-track" cx="150" cy="150" r="134" /><circle className="ring-value" cx="150" cy="150" r="134" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - (hp ?? 0) / 100)} /></svg>
        <span className="orbit-corner orbit-time" title="操作时长">{duration(summary.seconds)}</span><span className={`orbit-corner orbit-outcome outcome-${battle.outcome}`}>{OUTCOMES[battle.outcome]}</span>
        <div className="boss-orbit-content"><div className="boss-turn">TURN {battle.turn}<span>{duration(remaining)}</span></div>
          {battle.genesis !== null || battle.specialRemaining !== null ? <div className="boss-special">{battle.genesis !== null ? `Genesis ${battle.genesis}` : ""}{battle.specialRemaining !== null ? ` ${duration(Math.max(0, battle.specialRemaining - elapsedSince(battle.specialUpdatedAt)))}` : ""}</div> : null}
          <div className="boss-hp"><Portrait kind="enemy" id={boss.imageId} label={boss.name} /><strong>{hp === null ? "—" : `${hp}%`}</strong></div>
          <h2 title={boss.name}>{boss.level ? `Lv${boss.level} ` : ""}{boss.name}</h2><p className="boss-hp-values">{amount(boss.hp)} / {amount(boss.maxHp)}</p>
          {boss.index === 0 && latestTurn?.omens.length ? <div className={`omens orbit-omens ${latestTurn.cancelled ? "cancelled" : ""}`}>{latestTurn.omens.map((omen, index) => <span key={index} title={omen}>{latestTurn.cancelled ? "已解除 · " : ""}{omen}</span>)}</div> : null}
        </div><span className="orbit-corner orbit-contribution" title="贡献">贡献 {amount(battle.contribution)}</span><span className="orbit-corner orbit-members" title="参战人数">{amount(battle.members)} / {amount(battle.memberLimit)}{battle.solo ? " · Solo" : ""}</span>
      </div><BuffList buffs={boss.buffs} /></article>;
    })}</div>
    {battle.incomplete ? <p className="notice compact-notice" title="未观察到的行动不计入统计">{battle.reloaded ? "已重新进入，保留已捕获统计。" : "中途开始监听，统计可能不完整。"}</p> : null}
    <div className="analysis-card">
    <nav className="battle-tabs" aria-label="战斗详情分类">{[["damage", "伤害统计"], ["taken", "承伤统计"], ["status", "角色状态"], ["actions", "回合行动"]].map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key!)}>{label}</button>)}</nav>
    {tab === "damage" ? <Statistics key="damage" battle={battle} taken={false} /> : tab === "taken" ? <Statistics key="taken" battle={battle} taken /> : tab === "status" ? <PlayerStatus battle={battle} /> : <ActionTimeline battle={battle} />}
    </div>
    {latestAttack ? <div className="attack-summary latest-attack" aria-label="最近攻击汇总"><span>Hit {latestAttack.hits}</span><span>奥伤 ({latestAttack.chain}c) {amount(latestAttack.special)}</span><span>技伤 {amount(latestAttack.ability)}</span><strong>总伤 {amount(latestAttack.total)}</strong></div> : null}
    <details className="battle-extra"><summary>战斗信息 · {battle.name}</summary><div className="battle-title"><span className={`outcome outcome-${battle.outcome}`}>{OUTCOMES[battle.outcome]}</span><p>{new Date(battle.startedAt).toLocaleString("zh-CN", { hour12: false })}</p><p>Raid {battle.raidId} · Quest {battle.questId || "—"}</p></div>
      <div className="battle-metrics"><div><span>伤害</span><strong>{amount(summary.damage)}</strong></div><div><span>贡献</span><strong>{amount(battle.contribution)}</strong></div><div><span>回合</span><strong>{battle.turn}</strong></div><div><span>操作时长 / 跑速</span><strong>{duration(summary.seconds)} / {summary.speed === null ? "—" : `${summary.speed.toFixed(1)} M/min`}</strong></div></div>
    </details>
    {battle.summons.length ? <details className="summon-list"><summary>召唤石状态</summary><div className="damage-breakdown">{battle.summons.map((summon, index) => <span key={index}>{summon.name}{summon.supporter ? "（支援）" : ""} · CD {summon.cooldown ?? "—"}</span>)}</div></details> : null}
    {battle.participants.length ? <details className="summon-list"><summary>参战者（最近一次进入时的匿名快照）</summary><div className="damage-breakdown">{battle.participants.map((member) => <span key={member.slot}>参战者 {member.slot + 1}{member.host ? " · 房主" : ""}{member.rank ? ` · Rank ${member.rank}` : ""}{member.attribute ? ` · 属性 ${member.attribute}` : ""}{member.dead ? " · 战斗不能" : ""}</span>)}</div></details> : null}
    <p className="battle-note">统计范围为监听期间收到的响应。技能次数按响应中的技能事件统计；无法归属的伤害单列。跑速单位为百万伤害/分钟，操作时长取游戏计时差。</p>
  </div>;
}
