// Disc picker at the bottom of the HUD: one card per disc with its flight chart, so a new player
// can see how each disc flies. Charts are the game's own physics: a full-power flat throw in calm
// air on an open field, seen from above (start at the bottom, forward up), like a maker's chart.
import type { Vec3 } from '../game/terrain';
import { DISCS, type Disc } from '../disc/discs';
import { simulateThrow, type DiscWorld } from '../disc/flight';
import { TreeIndex } from '../disc/trees';
import { SurfaceGrid } from '../game/surfaces';
import { FlatTerrain } from '../game/terrain';
import { fmtLen } from '../units';

/** Side-to-side is drawn this many times larger than forward, so turn and fade are easy to read. */
const LATERAL = 2;
const W = 44, H = 64, PAD = 4;

let charts: { disc: Disc; path: Vec3[]; rest: [number, number] }[] | null = null;

function flights() {
  if (charts) return charts;
  const world: DiscWorld = {
    grid: SurfaceGrid.fromHole({ bounds: [[-50, -200], [300, 200]], boundary: [[[[-40, -190], [290, -190], [290, 190], [-40, 190]]]], trees: [], features: [] }, 2),
    terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [1e6, 1e6],
  };
  charts = DISCS.map((disc) => {
    const r = simulateThrow({ start: [0, 0], aim: 0, power: 1, disc, hyzer: 0, perfect: true }, world, () => 0.5, { ghost: true });
    return { disc, path: [...r.samples, [r.rest[0], r.rest[1], 0]], rest: r.rest };
  });
  return charts;
}

/** SVG flight chart. Thrown along +x; +y is left, so a right-hand backhand's turn goes right. */
function chart(c: { disc: Disc; path: Vec3[] }, scale: number): string {
  const pts = c.path.map(([x, y]) => `${(W / 2 - y * scale * LATERAL).toFixed(1)},${(H - PAD - x * scale).toFixed(1)}`);
  const [ex, ey] = pts[pts.length - 1].split(',');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <line x1="${W / 2}" y1="${H - PAD}" x2="${W / 2}" y2="${PAD}" class="axis"/>
    <g class="flip"><polyline points="${pts.join(' ')}" fill="none" stroke="${c.disc.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${ex}" cy="${ey}" r="2.6" fill="${c.disc.color}"/></g>
    <circle cx="${W / 2}" cy="${H - PAD}" r="1.8" class="start"/></svg>`;
}

export function mountDiscPicker(el: HTMLElement, onPick: (d: Disc) => void): { update(current: Disc, forehand: boolean): void } {
  const fl = flights();
  const far = Math.max(...fl.map((c) => Math.max(...c.path.map((p) => p[0]))));
  const scale = (H - 2 * PAD) / far; // one scale for all cards, so lengths compare
  let last: { current: Disc; forehand: boolean } | null = null;
  const mark = () => {
    if (!last) return;
    el.classList.toggle('forehand', last.forehand);
    el.querySelectorAll<HTMLButtonElement>('.disc-card').forEach((b) => b.classList.toggle('on', b.dataset.id === last!.current.id));
  };
  const render = () => {
    el.innerHTML = fl.map((c) => `
      <button class="disc-card" data-id="${c.disc.id}" title="${c.disc.name}: full-power flat throw in calm air (side-to-side drawn ${LATERAL}× wider)">
        ${chart(c, scale)}
        <span class="txt"><b>${c.disc.name}</b><span class="nums">${c.disc.speed} | ${c.disc.glide} | ${c.disc.turn} | ${c.disc.fade}</span><span class="range">~${fmtLen(Math.hypot(c.rest[0], c.rest[1]))}</span></span>
      </button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('.disc-card').forEach((b) => b.addEventListener('click', () => onPick(DISCS.find((d) => d.id === b.dataset.id)!)));
    mark();
  };
  render();
  window.addEventListener('unitschange', render);
  return {
    update(current, forehand) {
      last = { current, forehand };
      mark();
    },
  };
}
