// Disc picker at the bottom of the HUD: one card per disc with its flight chart, so a new player
// can see how each disc flies. Charts are the game's own physics: a full-power throw in calm air on
// an open field, seen from above (start at the bottom, forward up), like a maker's chart. In a
// round they follow the release being lined up (angle, shot, hand), so Q/E/G/T show what they do.
// Calm air and an open field on purpose: the line on the course itself is Crazy mode's Ghost.
import type { Vec3 } from '../game/terrain';
import { DISCS, type Disc } from '../disc/discs';
import { simulateThrow, type DiscWorld, type Shot } from '../disc/flight';
import { TreeIndex } from '../disc/trees';
import { SurfaceGrid } from '../game/surfaces';
import { FlatTerrain } from '../game/terrain';
import { fmtLen } from '../units';

/** Side-to-side is drawn this many times larger than forward, so turn and fade are easy to read. */
const LATERAL = 2;
const W = 44, H = 64, PAD = 4;

/** A release: angle (-1 anhyzer … 1 hyzer) and shot. Forehand mirrors the chart (CSS). */
export interface Release { hyzer: number; shot: Shot }
const FLAT: Release = { hyzer: 0, shot: 'standard' };
type Chart = { disc: Disc; path: Vec3[]; rest: [number, number] };
/** Every disc's chart, per release (there are few: 9 angles × 4 shots). */
const charts = new Map<string, Chart[]>();
let world: DiscWorld | null = null;

function flights(rel: Release = FLAT): Chart[] {
  const key = `${rel.hyzer}:${rel.shot}`;
  const have = charts.get(key);
  if (have) return have;
  world ??= {
    grid: SurfaceGrid.fromHole({ bounds: [[-50, -200], [300, 200]], boundary: [[[[-40, -190], [290, -190], [290, 190], [-40, 190]]]], trees: [], features: [] }, 2),
    terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [1e6, 1e6],
  };
  const out = DISCS.map((disc) => {
    const r = simulateThrow({ start: [0, 0], aim: 0, power: 1, disc, hyzer: rel.hyzer, shot: rel.shot, perfect: true }, world!, () => 0.5, { ghost: true });
    return { disc, path: [...r.samples, [r.rest[0], r.rest[1], 0]] as Vec3[], rest: r.rest };
  });
  charts.set(key, out);
  return out;
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

/** The full-power flat charts' scale, kept for every release so a chart's length means the same. */
let flatScale = 0;
const describe = (rel: Release) => (rel.shot !== 'standard' ? `${rel.shot}` : rel.hyzer === 0 ? 'flat' : `${rel.hyzer > 0 ? 'hyzer' : 'anhyzer'} ${Math.round(Math.abs(rel.hyzer) * 20)}°`);

/** One disc's card: flight chart, name, flight numbers, full-power range (the picker and the bag). */
export function discCard(d: Disc, rel: Release = FLAT): string {
  if (!flatScale) { const fl = flights(); flatScale = (H - 2 * PAD) / Math.max(...fl.map((c) => Math.max(...c.path.map((p) => p[0])))); }
  const fl = flights(rel);
  // One scale for all cards, so lengths compare; shrunk if this release flies farther than flat.
  const far = Math.max(...fl.map((c) => Math.max(...c.path.map((p) => Math.max(p[0], Math.abs(p[1]) * LATERAL * 1.4)))));
  const scale = Math.min(flatScale, (H - 2 * PAD) / far);
  const c = fl.find((x) => x.disc.id === d.id)!;
  return `
      <button class="disc-card" data-id="${c.disc.id}" title="${c.disc.name}: full-power ${describe(rel)} throw in calm air (side-to-side drawn ${LATERAL}× wider)">
        ${chart(c, scale)}
        <span class="txt"><b>${c.disc.short}</b><span class="nums">${c.disc.speed} | ${c.disc.glide} | ${c.disc.turn} | ${c.disc.fade}</span><span class="range">~${fmtLen(Math.hypot(c.rest[0], c.rest[1]))}</span></span>
      </button>`;
}

export function mountDiscPicker(el: HTMLElement, onPick: (d: Disc) => void): { update(current: Disc, forehand: boolean, rel?: Release): void; setBag(ids: string[] | null): void } {
  let last: { current: Disc; forehand: boolean } | null = null;
  let bag: string[] | null = null;
  let rel: Release = FLAT;
  const mark = () => {
    // Each card shown is numbered for its key (1, 2, …), left to right.
    let n = 0;
    el.querySelectorAll<HTMLButtonElement>('.disc-card').forEach((b) => {
      b.hidden = !!bag && !bag.includes(b.dataset.id!);
      if (b.hidden) delete b.dataset.key; else b.dataset.key = String(++n);
    });
    if (!last) return;
    el.classList.toggle('forehand', last.forehand);
    el.querySelectorAll<HTMLButtonElement>('.disc-card').forEach((b) => b.classList.toggle('on', b.dataset.id === last!.current.id));
  };
  const render = () => {
    el.innerHTML = DISCS.map((d) => discCard(d, rel)).join('');
    el.querySelectorAll<HTMLButtonElement>('.disc-card').forEach((b) => b.addEventListener('click', () => onPick(DISCS.find((d) => d.id === b.dataset.id)!)));
    mark();
  };
  render();
  window.addEventListener('unitschange', render);
  return {
    /** The disc lined up, the hand, and the release (the charts follow it). */
    update(current, forehand, r = FLAT) {
      last = { current, forehand };
      if (r.hyzer !== rel.hyzer || r.shot !== rel.shot) { rel = { ...r }; render(); } else mark();
    },
    /** Bag building: show only these discs (null: all of them). */
    setBag(ids) {
      bag = ids;
      mark();
    },
  };
}
