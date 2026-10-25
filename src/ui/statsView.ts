// Your stats (main menu): per player name in this browser, their rating, putting, driving and
// recent rounds (src/game/playerStats.ts).
import { C1, C1X_FROM, C2, PARKED, RATING_MIN_HOLES, RATING_ROUNDS, clearStats, playerRating, roundsOf, statNames, summarize } from '../game/playerStats';
import { fmtLen } from '../units';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = ([a, b]: [number, number]) => (b ? `${Math.round((a / b) * 100)}%` : '–');
const of = ([a, b]: [number, number]) => (b ? `${a} of ${b}` : 'none yet');
const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
const toPar = (v: number) => (Math.abs(v) < 0.05 ? 'E' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);

export function openStats(prefer?: string): void {
  const modal = document.getElementById('player-stats')!;
  const names = statNames();
  let who = prefer && names.includes(prefer) ? prefer : names[0];
  const render = () => {
    const body = modal.querySelector('.stats-body')!;
    const tabs = modal.querySelector('.stats-names')!;
    if (!who) {
      tabs.innerHTML = '';
      body.innerHTML = `<p class="course-blurb">No rounds yet. Finish a round (not Crazy mode, teams or training) and it shows up here, with your rating.</p>`;
      return;
    }
    tabs.innerHTML = names.map((n) => `<button data-n="${esc(n)}" class="${n === who ? 'on' : ''}">${esc(n)}</button>`).join('');
    const rounds = roundsOf(who);
    const s = summarize(rounds);
    const rating = playerRating(rounds);
    const tile = (label: string, big: string, line: string, title = '') => `<div class="hl" title="${esc(title)}"><small>${label}</small><b>${big}</b><span>${line}</span></div>`;
    body.innerHTML = `
      <div class="results-summary stats-tiles">
        ${tile('Rating', rating === null ? '–' : String(rating), rating === null ? `needs a round of ${RATING_MIN_HOLES}+ holes` : `last ${n(Math.min(RATING_ROUNDS, rounds.filter((r) => r.holes.length >= RATING_MIN_HOLES).length), 'round')} of ${RATING_MIN_HOLES}+ holes`, '1000 is playing to par; each stroke is 10 points over 18 holes. Par-based, not a PDGA rating.')}
        ${tile('Scoring', toPar(s.toPar18), `per 18 holes · ${n(s.rounds, 'round')}, ${n(s.holes, 'hole')}`)}
        ${tile('C1X putting', pct(s.c1x), of(s.c1x), `Putts from ${fmtLen(C1X_FROM)} to ${fmtLen(C1)} (circle 1, outside tap-in range)`)}
        ${tile('C2 putting', pct(s.c2), of(s.c2), `Putts from ${fmtLen(C1)} to ${fmtLen(C2)} (circle 2)`)}
        ${tile('Fairway hits', pct(s.fairway), of(s.fairway), 'Tee shots that land in the clear: not in the trees, OB or water')}
        ${tile('Parked', pct(s.parked), of(s.parked), `Tee shots that finish within ${fmtLen(PARKED)} (or in)`)}
        ${tile('C1 in regulation', pct(s.c1r), of(s.c1r), 'Inside circle 1 with two strokes to spare for par')}
        ${tile('Scrambling', pct(s.scramble), of(s.scramble), 'Par or better after missing circle 1 in regulation')}
        ${tile('OB rate', pct(s.ob), `${s.ob[0]} of ${s.ob[1]} throws`, 'Throws that went out of bounds or in the water')}
        ${tile('Birdies', String(s.birdies), s.holes ? `${(s.birdies / s.holes * 18).toFixed(1)} per 18` : '')}
      </div>
      <h3>Recent rounds</h3>
      <table class="stats-rounds"><tbody>${rounds.slice().reverse().slice(0, 12).map((r) => {
        const tp = r.holes.reduce((a, h) => a + h.strokes - h.par, 0);
        return `<tr><td>${new Date(r.at).toLocaleDateString()}</td><td>${esc(r.course)}</td><td>${n(r.holes.length, 'hole')}</td><td class="${tp < 0 ? 'under' : tp > 0 ? 'over' : 'even'}">${tp === 0 ? 'E' : tp > 0 ? `+${tp}` : tp}</td><td>${r.rating}</td></tr>`;
      }).join('')}</tbody></table>
      <button class="chip-btn stats-clear">Clear ${esc(who)}’s stats</button>`;
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => { who = b.dataset.n!; render(); }));
    body.querySelector('.stats-clear')!.addEventListener('click', () => {
      if (!confirm(`Clear every recorded round for ${who}?`)) return;
      clearStats(who!);
      names.splice(names.indexOf(who!), 1);
      who = names[0];
      render();
    });
  };
  render();
  modal.hidden = false;
}

export function closeStats(): void {
  document.getElementById('player-stats')!.hidden = true;
}
