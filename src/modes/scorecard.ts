// The scorecard (after each hole, and from the pause menu) and the final card's round highlights.
// Rendering only: src/modes/disc.ts decides when it shows and which buttons it has.
import type { DiscHole } from '../course/disc-types';
import type { Round } from '../game/round';
import { chipFor, stacked } from '../ui/augments';
import { fmtLen } from '../units';
import type { RoundEvent } from './discRound';
import { $, esc, fmtPar } from './discKit';
import { roundStats, type ShotRef } from './roundStats';

export interface CardView {
  holes: DiscHole[];
  round: Round;
  names: string[];
  colors: string[];
  /** To par, counting the current hole for anyone who has finished it. */
  toPar: (p: number) => number;
  /** Crazy mode: everyone's augments, shown under the card. */
  augments: string[][] | null;
  /** Best shot: the card's rows are teams (players by seat; the first stands for the team), named and colored as given. */
  teams?: { rows: number[][]; name: (p: number) => string; color: (row: number[]) => string };
}

/** Fill the card's table (best first) and, in Crazy mode, everyone's augments. */
export function renderCard(v: CardView): void {
  const { round, holes, names, colors } = v;
  const idx = [...Array(round.count).keys()].map((k) => round.first + k);
  const head = `<thead><tr><th></th>${idx.map((i) => `<th>${holes[i].ref}</th>`).join('')}<th>TOT</th><th>±</th></tr></thead>`;
  const par = `<tr class="par"><td class="player">Par</td>${idx.map((i) => `<td>${holes[i].par}</td>`).join('')}<td class="tot">${idx.reduce((s, i) => s + holes[i].par, 0)}</td><td></td></tr>`;
  const mark = (val: number, p: number) => {
    const d = val - p;
    const cls = val === 1 || d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
    return `<span class="mk ${cls}">${val}</span>`;
  };
  const lines = v.teams?.rows ?? names.map((_, p) => [p]);
  const order = lines.map((row) => row[0]).sort((a, b) => v.toPar(a) - v.toPar(b));
  const rowOf = (p: number) => lines.find((row) => row[0] === p)!;
  const rows = order.map((p) => {
    const tp = v.toPar(p);
    return `<tr><td class="player"><i style="background:${v.teams ? v.teams.color(rowOf(p)) : colors[p]}"></i>${esc(v.teams ? v.teams.name(p) : names[p])}</td>${idx.map((i) => {
      const val = round.scores[p][i];
      return `<td>${val === undefined ? '' : mark(val, holes[i].par)}</td>`;
    }).join('')}<td class="tot">${round.total(p) || ''}</td><td class="pm topar ${tp < 0 ? 'under' : tp > 0 ? 'over' : 'even'}">${fmtPar(tp)}</td></tr>`;
  });
  // Crazy mode: everyone's augments under the card (hover a chip for what it does).
  const owned = v.augments;
  $('results-augs').hidden = !owned;
  if (owned) {
    $('results-augs').innerHTML = order.map((p) => `<div class="who"><b><i style="background:${colors[p]}"></i>${esc(names[p])}</b>${
      owned[p].length ? stacked(owned[p]).map(([q, n]) => chipFor(q, n)).join('') : '<span class="none">no augments yet</span>'}</div>`).join('');
  }
  $('results-table').innerHTML = head + '<tbody>' + par + rows.join('') + '</tbody>';
}

/** Highlights over the whole round, each big shot with a Watch button that replays it. */
export function renderSummary(show: boolean, log: RoundEvent[], v: CardView, watch: (at: number) => void): void {
  const box = $('results-summary');
  box.hidden = !show;
  if (!show) return;
  const { names, colors, holes } = v;
  const r = roundStats(log, names.length, v.round.first);
  const who = (p: number) => `<i style="background:${colors[p]}"></i>${esc(names[p])}`;
  const button = (k: ShotRef) => `<button data-at="${k.at}">▶ Watch</button>`;
  const tiles: string[] = [];
  const tile = (label: string, big: string, line: string, extra = '') => tiles.push(`<div class="hl"><small>${label}</small><b>${big}</b><span>${line}</span>${extra}</div>`);
  if (r.longest) tile('Longest throw', fmtLen(r.longest.dist), `${who(r.longest.player)} · hole ${holes[r.longest.hole].ref}`, button(r.longest));
  if (r.bestMake) tile('Longest make', fmtLen(r.bestMake.dist), `${who(r.bestMake.player)} · hole ${holes[r.bestMake.hole].ref}`, button(r.bestMake));
  const trees = r.players.map((q, p) => ({ p, n: q.trees })).sort((a, b) => b.n - a.n)[0];
  if (trees && trees.n > 0) tile('Tree magnet', `${trees.n} ${trees.n === 1 ? 'tree' : 'trees'}`, who(trees.p));
  else tile('Tree magnet', 'Nobody', 'not one tree hit all round');
  const aces = r.players.map((q, p) => ({ p, n: q.aces })).filter((a) => a.n > 0);
  if (aces.length) tile(aces.reduce((a, b) => a + b.n, 0) === 1 ? 'Ace' : 'Aces', aces.map((a) => (a.n > 1 ? `${a.n}×` : '★')).join(' '), aces.map((a) => who(a.p)).join(' '));
  const clean = r.players.map((q, p) => ({ p, n: q.penalties })).sort((a, b) => a.n - b.n);
  if (names.length > 1 && clean.length && clean[0].n === 0) tile('Clean card', 'No penalties', clean.filter((c) => c.n === 0).map((c) => who(c.p)).join(' '));
  box.innerHTML = tiles.join('');
  box.querySelectorAll<HTMLButtonElement>('button[data-at]').forEach((b) => b.addEventListener('click', () => watch(parseInt(b.dataset.at!, 10))));
}
