// Fit a disc's release speed and measure its meter curve (src/disc/discs.ts), the way the bag was
// calibrated: v0 so a full-power flat throw at its default launch lands at the target range, then
// distance at each release-speed fraction (CURVE_SPEEDS) as a fraction of full.
//
//   npx tsx scripts/calibrate-disc.ts <speed> <glide> <turn> <fade> <target m> [launch rad]
import type { Disc } from '../src/disc/discs';
import { simulateThrow } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const [speed, glide, turn, fade, target, launch = 0.09] = process.argv.slice(2).map(Number);
const CURVE_SPEEDS = [0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const grid = SurfaceGrid.fromHole({ bounds: [[-300, -300], [300, 300]], boundary: [[[[-280, -280], [280, -280], [280, 280], [-280, 280]]]], trees: [], features: [] }, 2);
const world = { grid, terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [1e6, 1e6] as [number, number] };
// An identity meter curve, so `power` is the release-speed fraction itself (from 0.15 up).
const disc = (v0: number): Disc => ({ id: 'X', name: 'X', short: 'X', speed, glide, turn, fade, v0, launch, curve: CURVE_SPEEDS, color: '#fff' });
const dist = (v0: number, p: number) => {
  const r = simulateThrow({ start: [0, -250], aim: Math.PI / 2, power: p, disc: disc(v0), hyzer: 0 }, world, () => 0.25, { ghost: true });
  return Math.hypot(r.rest[0], r.rest[1] + 250);
};
let lo = 10, hi = 35;
for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (dist(m, 1) < target) lo = m; else hi = m; }
const v0 = +((lo + hi) / 2).toFixed(1);
const full = dist(v0, 1);
const curve = CURVE_SPEEDS.map((s) => +(dist(v0, s) / full).toFixed(3));
curve[curve.length - 1] = 1;
console.log(JSON.stringify({ v0, launch, full: +full.toFixed(1), curve }));
