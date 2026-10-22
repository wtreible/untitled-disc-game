// "Pirate's Cove": a 9-hole island course. The land is sandy islands with mown fairways, joined by
// boardwalks; off the land is the sea (a water hazard: +1, played from where it left the land).
// Carries over coves and an island basket, a stranded wreck, a lookout tower on the line, a ghost
// ship sailing across a fairway, and a galleon moored in front of the last basket. CC0 models:
// Kenney Pirate Kit. Hand-designed. Writes public/courses/pirate.json.
//
//   npm run pirate-course
import { writeFileSync } from 'node:fs';
import type { DiscCourseFile, DiscHole } from '../src/course/disc-types';
import { encodeTrees } from '../src/course/disc-types';
import { dist, distToPolyline, type Vec2 } from '../src/course/geo';
import type { CourseFeature, Rings } from '../src/course/types';
import { along, bbox, courseJson, facing, heading, makeHoles, propKit, rect, shapeColliders, strip, teeMat, type HoleSpec } from './course-kit';

const { R, pick, props, trees, solid, decor, tree } = propKit(7781);
const pirate = (m: string) => `pirate/${m}.glb`;

const SPEC: HoleSpec[] = [
  { name: 'Walk the Plank', tee: [0, 0], pin: [0, 104] },
  { name: 'Cannon Cove', tee: [24, 122], pin: [100, 150] },
  { name: 'Shipwreck Shoals', tee: [128, 140], pin: [128, 40] },
  { name: 'Skull Rock', tee: [150, 14], pin: [236, 36] },
  { name: 'Crow’s Nest', tee: [262, 52], pin: [262, 166] },
  { name: 'Davy Jones’ Locker', tee: [238, 198], pin: [168, 252] },
  { name: 'Ghost Ship', tee: [142, 268], pin: [58, 246] },
  { name: 'X Marks the Spot', tee: [34, 228], via: [[-10, 206]], pin: [-42, 160] },
  { name: 'Captain’s Galleon', tee: [-50, 134], pin: [-30, 30] },
];
const H = makeHoles(SPEC);

// ---------- land ----------
/** Land pieces: polylines with a half-width (strips with round ends) and round islands. */
const land: { pts: Vec2[]; half: number }[] = [];
const onLand = (p: Vec2, margin = 0) => land.some((l) => distToPolyline(p, l.pts) < l.half - margin);
/** The hole line between fractions f0 and f1 (sampled, so doglegs bend). */
const part = (h: DiscHole, f0: number, f1: number): Vec2[] => Array.from({ length: 9 }, (_, k) => along(h, f0 + ((f1 - f0) * k) / 8));
/**
 * Land along a hole, except the sea gaps (fractions of the hole). A strip's round end reaches `half`
 * past its last point, so the land stops that far short of each gap: the gap is all sea.
 */
function holeLand(h: DiscHole, gaps: [number, number][] = [], half = 12): void {
  const cap = half / h.length_m;
  let f = 0;
  for (const [g0, g1] of gaps) { if (g0 - cap > f) land.push({ pts: part(h, f, g0 - cap), half }); f = g1 + cap; }
  if (f < 1) land.push({ pts: part(h, f, 1), half });
}
const island = (c: Vec2, r: number) => land.push({ pts: [c, c], half: r });

holeLand(H[0]);
holeLand(H[1], [[0.32, 0.68]]); // the cove: about 30 m of sea
holeLand(H[2]);
holeLand(H[3], [[0.6, 0.76]]); // Skull Rock's inlet
holeLand(H[4]);
holeLand(H[5], [[0.5, 0.8]], 11); // out to the locker: a carry onto the basket's island
island(H[5].pin, 13);
holeLand(H[6]);
holeLand(H[7]);
holeLand(H[8]);
for (const h of H) { island(h.tee, 14); island(h.pin, h === H[5] ? 13 : 15); }
// Boardwalks from each basket to the next tee (over the sea where they cross it).
const boardwalks: Vec2[][] = H.map((h, i) => [h.pin, H[(i + 1) % H.length].tee]);
for (const b of boardwalks) land.push({ pts: b, half: 1.8 });
// A few islands just for the view (palms, a rowboat beached on one).
const extraIslands: [Vec2, number][] = [[60, 60], [190, 100], [205, 245], [-80, 230], [320, 120], [100, 310]].map(([x, y]) => [[x, y], R(9, 14)]);
for (const [c, r] of extraIslands) island(c, r);

const features: CourseFeature[] = [];
const boundary: Rings[] = [];
for (const l of land) for (const r of strip(l.pts, l.half)) boundary.push(r);
for (const h of H) {
  // Mown fairway along the land parts of each hole (the sea paints over it in the gaps).
  for (const l of land.filter((q) => q.half >= 11 && q.pts.length > 2 && q.pts.every((p) => distToPolyline(p, h.routing) < 0.5))) {
    for (const r of strip(l.pts, 6)) features.push({ class: 'fairway', osm_id: `fairway/${h.ref}`, rings: r });
  }
  features.push({ class: 'tee', osm_id: `tee/${h.ref}`, rings: [teeMat(h)] });
}
boardwalks.forEach((b, i) => { for (const r of strip(b, 1.4)) features.push({ class: 'path', osm_id: `boardwalk/${i}`, rings: r }); });

/** Areas kept clear of scattered palms and decoration (beyond fairways and props). */
const keepOut: { c: Vec2; r: number }[] = [];

// ---------- set pieces ----------
// 1. Walk the Plank: a pirate ship moored off the left of the fairway, a dock out to it, barrels.
{
  const h = H[0], d = heading(h);
  const at = along(h, 0.5, 24);
  const s = 2.2;
  solid(pirate('ship-pirate-large'), at, s, { yaw: facing(d), lift: -0.8, hit: 'Thunk! Into the hull', tag: 'ship' });
  decor(pirate('flag-pirate-high'), along(h, 0.02, 4), 2.5, d);
  for (const [f, lat] of [[0.25, -9], [0.4, 8.5], [0.7, -8], [0.82, 9]] as const) solid(pirate(pick(['barrel', 'crate'])), along(h, f, lat), R(1.8, 2.4), { hit: 'Bonk! Cargo', tag: 'cargo' });
  for (let k = 0; k < 3; k++) decor(pirate('structure-platform-dock'), along(h, 0.45 + k * 0.05, 13), 2.2, d);
}
// 2. Cannon Cove: a row of cannons on the tee side, aimed across the cove; rocks out in the water.
{
  const h = H[1], d = heading(h);
  for (const lat of [-9, 9]) solid(pirate('cannon'), along(h, 0.22, lat), 2.6, { yaw: facing(d), hit: 'Clang! Cannon', tag: 'cannon' });
  solid(pirate('cannon-mobile'), along(h, 0.84, -8), 2.4, { yaw: facing(d + Math.PI), hit: 'Clang! Cannon', tag: 'cannon' });
  for (const [f, lat] of [[0.45, 10], [0.55, -12]] as const) solid(pirate('rocks-a'), along(h, f, lat), R(2, 2.6), { hit: 'Rocks!', tag: 'rock' });
}
// 3. Shipwreck Shoals: a wreck stranded across the middle of the fairway; go round or over the masts.
{
  const h = H[2], d = heading(h);
  const at = along(h, 0.5, 3);
  solid(pirate('ship-wreck'), at, 2, { yaw: facing(d + Math.PI / 2 - 0.25), hit: 'Into the wreck!', tag: 'wreck' });
  keepOut.push({ c: at, r: 14 });
  for (const [f, lat] of [[0.32, -10], [0.7, 10]] as const) solid(pirate('rocks-sand-a'), along(h, f, lat), 2, { hit: 'Rocks!', tag: 'rock' });
}
// 4. Skull Rock: a towering rock in the inlet, just short of the basket and a little left.
{
  const h = H[3];
  const at = along(h, 0.7, 5);
  solid(pirate('rocks-b'), at, 4, { hit: 'Skull Rock!', tag: 'skull-rock' });
  for (const [f, lat] of [[0.65, -9], [0.78, 11]] as const) solid(pirate('rocks-a'), along(h, f, lat), 2.2, { hit: 'Rocks!', tag: 'rock' });
  keepOut.push({ c: at, r: 12 });
}
// 5. Crow's Nest: a lookout tower on the line, a pirate flag on top. Bend it round either side.
{
  const h = H[4], d = heading(h);
  const at = along(h, 0.55);
  const s = 2.4;
  solid(pirate('tower-complete-large'), at, s, { yaw: facing(d), hit: 'Bonk! The lookout tower', tag: 'tower' });
  decor(pirate('flag-pirate-high'), at, 2.4, d, { lift: 10.2 * s });
  keepOut.push({ c: at, r: 10 });
}
// 6. Davy Jones' Locker: the basket on its own little island, a chest beside it, rowboats around.
{
  const h = H[5], d = heading(h);
  solid(pirate('chest'), [h.pin[0] + Math.cos(d + 2.2) * 5, h.pin[1] + Math.sin(d + 2.2) * 5], 2, { yaw: facing(d + Math.PI), hit: 'Clunk! Treasure chest', tag: 'chest' });
  tree(pirate('palm-detailed-bend'), [h.pin[0] + Math.cos(d + 0.9) * 6.5, h.pin[1] + Math.sin(d + 0.9) * 6.5], 2.6);
  for (const [f, lat] of [[0.55, 9], [0.72, -11], [0.6, -4]] as const) decor(pirate('boat-row-large'), along(h, f, lat), 2.2, R(0, Math.PI * 2), { lift: -0.25 });
  keepOut.push({ c: h.pin, r: 12 });
}
// 7. Ghost Ship: sails back and forth across the fairway (its colliders move with it).
{
  const h = H[6], d = heading(h);
  const at = along(h, 0.52);
  const s = 1.8;
  const yaw = facing(d + Math.PI / 2); // sails across the hole
  const slide = { amp: [Math.cos(d + Math.PI / 2) * 22, Math.sin(d + Math.PI / 2) * 22] as Vec2, period: 18, phase: 0.1 };
  const parts = shapeColliders(pirate('ship-ghost'), at, yaw, s, { tag: 'ghost-ship' });
  props.push({ model: pirate('ship-ghost'), at, yaw, scale: s, hit: 'Spooked by the ghost ship!', colliders: [{ kind: 'slide', parts, slide, tag: 'ghost-ship' }], motion: { kind: 'slide', slide } });
  keepOut.push({ c: at, r: 30 });
}
// 8. X Marks the Spot: palms through the dogleg, the treasure buried by the basket (a red X).
{
  const h = H[7];
  for (const [f, lat] of [[0.2, 8], [0.32, -8], [0.5, 9], [0.62, -7], [0.8, 8]] as const) tree(pirate(pick(['palm-detailed-straight', 'palm-detailed-bend', 'palm-bend'])), along(h, f, lat), R(2.4, 3));
  const x = along(h, 1, -5);
  solid(pirate('chest'), [x[0] + 1.5, x[1] + 1.5], 1.8, { hit: 'Clunk! Treasure chest', tag: 'chest' });
  keepOut.push({ c: x, r: 8 });
}
// 9. Captain's Galleon: moored broadside in front of the last basket, its stern off the line.
{
  const h = H[8], d = heading(h);
  const at = along(h, 0.72, -7);
  solid(pirate('ship-pirate-large'), at, 2.3, { yaw: facing(d + Math.PI / 2), lift: -0.8, hit: 'Broadside! Into the galleon', tag: 'galleon' });
  for (const lat of [-14, 14]) solid(pirate('cannon'), along(h, 0.9, lat), 2.4, { yaw: facing(d + Math.PI), hit: 'Clang! Cannon', tag: 'cannon' });
  keepOut.push({ c: at, r: 18 });
}

// The X: two red strokes painted by the basket on hole 8.
const X = along(H[7], 1, -5);
const decals = [{ color: '#c8322a', rings: [[rect(X, Math.PI / 4, 3, 0.55)], [rect(X, -Math.PI / 4, 3, 0.55)]] as Rings[] }];

// ---------- palms and decoration, on land, off fairways, tees, baskets and set pieces ----------
const pts = H.flatMap((h) => h.routing);
const minX = Math.min(...pts.map((p) => p[0])) - 70, maxX = Math.max(...pts.map((p) => p[0])) + 70;
const minY = Math.min(...pts.map((p) => p[1])) - 70, maxY = Math.max(...pts.map((p) => p[1])) + 70;
const clear = (p: Vec2, m: number) =>
  H.every((h) => distToPolyline(p, h.routing) > m && dist(p, h.tee) > m + 4 && dist(p, h.pin) > m + 6) &&
  boardwalks.every((b) => distToPolyline(p, b) > 4) &&
  props.every((q) => dist(p, q.at) > 6) && keepOut.every((k) => dist(p, k.c) > k.r);
const PALMS = ['palm-detailed-straight', 'palm-detailed-bend', 'palm-bend'];
// Palms on the islands' edges, so lines have to be shaped.
for (let n = 0, tries = 0; n < 70 && tries < 8000; tries++) {
  const p: Vec2 = [R(minX, maxX), R(minY, maxY)];
  // Bent palms lean up to ~6 m: well back from the tees, so none hangs over the thrower.
  if (!onLand(p, 2) || !clear(p, 8) || H.some((h) => dist(p, h.tee) < 20) || trees.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < 7)) continue;
  tree(pirate(pick(PALMS)), p, R(2.3, 3.1));
  n++;
}
for (const [c, r] of extraIslands) {
  for (let k = 0; k < 2; k++) { const a = R(0, Math.PI * 2); tree(pirate(pick(PALMS)), [c[0] + Math.cos(a) * r * 0.4, c[1] + Math.sin(a) * r * 0.4], R(2.3, 3)); }
}
decor(pirate('boat-row-large'), [extraIslands[2][0][0] + extraIslands[2][1] - 2, extraIslands[2][0][1]], 2.2, R(0, Math.PI * 2));
// Rocks out at sea, and cargo on the beaches.
for (let n = 0, tries = 0; n < 16 && tries < 4000; tries++) {
  const p: Vec2 = [R(minX, maxX), R(minY, maxY)];
  if (onLand(p, -6) || !clear(p, 10)) continue;
  decor(pirate(pick(['rocks-a', 'rocks-b', 'rocks-sand-a', 'rocks-sand-b'])), p, R(1.6, 2.6), R(0, Math.PI * 2), { lift: -0.6 });
  n++;
}
for (let n = 0, tries = 0; n < 24 && tries < 4000; tries++) {
  const p: Vec2 = [R(minX, maxX), R(minY, maxY)];
  if (!onLand(p, 3) || !clear(p, 9)) continue;
  decor(pirate(pick(['barrel', 'crate', 'rocks-sand-b'])), p, R(1.4, 2.2));
  n++;
}
for (const h of H) {
  const a = heading(h);
  decor(pirate('flag-pirate-high'), [h.tee[0] - Math.sin(a) * 4, h.tee[1] + Math.cos(a) * 4], 2.2, a);
}
// Sanity: every model has bounds (catches a typo in a model path at build time).
for (const m of new Set(props.map((p) => p.model))) bbox(m);

const course: DiscCourseFile = {
  sport: 'disc',
  style: 'vector',
  branch_density: 0.4,
  name: 'Pirate’s Cove',
  source: { osm_timestamp: 'n/a (hand-designed)', course_osm_id: 'none', attribution: ['Models (CC0): Kenney Pirate Kit (kenney.nl)'] },
  origin: { lat: 0, lon: 0 },
  imagery_offset_m: [0, 0],
  bounds: [[minX - 30, minY - 30], [maxX + 30, maxY + 30]],
  boundary,
  features,
  decals,
  canopy: [],
  ob: [],
  sea: true,
  trees: encodeTrees(trees),
  holes: H,
  props,
  toasts: { water: 'Overboard! +1' },
  // Sand for the islands' open ground, mown fairways, the sea all round, plank boardwalks.
  palette: { outside: '#2b7db3', rough: '#e3cf98', fairway: '#83c45a', path: '#9a7350', water: '#2b7db3', tee: '#8a6a4a' },
  sky: '#bfe4fb',
};
writeFileSync('public/courses/pirate.json', courseJson(course));
console.log(`Pirate’s Cove: ${H.length} holes (${H.map((h) => `${h.ref}:${Math.round(h.length_m)}m p${h.par}`).join(' ')}), ${props.length} props, ${trees.length} trees`);
