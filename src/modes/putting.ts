// Putting ladder (Training → Putting): the range with one basket, moved back station by station.
// Three putts each from 30 ft, 10 ft farther at each station to 70 ft, worth 1–5 a make: 45 is
// perfect. Players take turns putt by putt, in hot seat or a room. The ladder is worked out from
// the round's own throws (src/modes/discRound.ts: on the range every throw is from the tee and the
// turn passes on), so everyone in a room sees the same station without any message of its own;
// src/modes/disc.ts moves the basket when a station changes and sets up each putt.
import type { Vec2 } from '../course/geo';
import { FT } from '../course/range';
import { fmtLen } from '../units';
import { shotTypeSeg, wireShotTypes } from '../ui/shotTypes';
import type { RoundEvent } from './discRound';
import { esc } from './discKit';

export const STATIONS: { ft: number; pts: number }[] = [30, 40, 50, 60, 70].map((ft, i) => ({ ft, pts: i + 1 }));
/** Putts per player at each station. */
export const PUTTS = 3;
export const PERFECT = STATIONS.reduce((s, x) => s + x.pts * PUTTS, 0);

/** The basket for a station: straight downrange from the tee. */
export const stationBasket = (station: number): Vec2 => [0, STATIONS[Math.min(station, STATIONS.length - 1)].ft * FT];

export interface PuttState {
  /** The station being putted (STATIONS.length once everyone's done). */
  station: number;
  /** Per player, per station: their putts so far (true: made). */
  putts: boolean[][][];
  scores: number[];
  done: boolean;
}

/**
 * The ladder so far, from the round's throws. `from`: throws before this one are an earlier ladder
 * (Play again, in hot seat).
 */
export function puttingState(log: RoundEvent[], players: number, from = 0): PuttState {
  const putts = Array.from({ length: players }, () => STATIONS.map((): boolean[] => []));
  const scores = Array.from({ length: players }, () => 0);
  let n = 0;
  for (const e of log) {
    if (e.t !== 'throw') continue;
    if (n++ < from) continue;
    const k = Math.floor((n - 1 - from) / (PUTTS * players));
    if (k >= STATIONS.length || !putts[e.player]) continue;
    putts[e.player][k].push(e.result.holed);
    if (e.result.holed) scores[e.player] += STATIONS[k].pts;
  }
  const station = Math.min(STATIONS.length, Math.floor(Math.max(0, n - from) / (PUTTS * players)));
  return { station, putts, scores, done: station >= STATIONS.length };
}

/** The ladder card: station, distance, everyone's putts and score; at the end, the standings. */
export function renderPutting(el: HTMLElement, s: PuttState, names: string[], colors: string[], end: { again?: () => void; lobby?: () => void; quit: () => void; wait?: string }): void {
  const dots = (p: number, k: number) => Array.from({ length: PUTTS }, (_, i) => {
    const r = s.putts[p][k][i];
    return `<i class="${r === undefined ? '' : r ? 'made' : 'miss'}"></i>`;
  }).join('');
  if (s.done) {
    const order = names.map((_, p) => p).sort((a, b) => s.scores[b] - s.scores[a]);
    el.innerHTML = `<div class="tu-head"><span>PUTTING</span><span>Final</span></div>
      <h4>${names.length > 1 ? `${esc(names[order[0]])} wins` : `${s.scores[0]} of ${PERFECT}`}</h4>
      <div class="pt-table">${order.map((p) => `<div class="pt-row"><b><i style="background:${colors[p]}"></i>${esc(names[p])}</b><span>${STATIONS.map((_, k) => `<span class="pt-dots">${dots(p, k)}</span>`).join('')}</span><em>${s.scores[p]}</em></div>`).join('')}</div>
      <div class="tu-actions">${end.wait ? `<span class="dim">${end.wait}</span>` : ''}${end.again ? '<button class="primary" data-act="again">Play again</button>' : ''}${end.lobby ? '<button class="primary" data-act="lobby">Back to lobby</button>' : ''}<button class="chip-btn" data-act="quit">${end.lobby || end.wait ? 'Leave room' : 'Back to the menu'}</button></div>`;
  } else {
    const st = STATIONS[s.station];
    el.innerHTML = `<div class="tu-head"><span>PUTTING</span><span>Station ${s.station + 1} / ${STATIONS.length}</span></div>
      <div class="tu-bar"><i style="width:${(s.station / STATIONS.length) * 100}%"></i></div>
      <h4>${fmtLen(st.ft * FT)} <small class="dim">· ${st.pts} ${st.pts === 1 ? 'point' : 'points'} a make</small></h4>
      <div class="pt-table">${names.map((_, p) => `<div class="pt-row"><b><i style="background:${colors[p]}"></i>${esc(names[p])}</b><span class="pt-dots">${dots(p, s.station)}</span><em>${s.scores[p]}</em></div>`).join('')}</div>
      <div class="pt-shot"><small class="dim">Shot type</small>${shotTypeSeg()}</div>
      <div class="tu-actions"><button class="chip-btn" data-act="quit">${end.lobby || end.wait ? 'Leave room' : 'End'}</button></div>`;
    wireShotTypes(el);
  }
  el.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.act === 'again') end.again?.();
    else if (b.dataset.act === 'lobby') end.lobby?.();
    else end.quit();
  }));
  el.hidden = false;
}
