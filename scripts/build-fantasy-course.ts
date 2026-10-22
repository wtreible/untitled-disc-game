// "Fantasy Fairways": a medieval 9-hole disc golf course. A giant knight guards hole 3, the basket
// on hole 5 sits inside a castle courtyard, and a dragon hovers over the last basket. CC0 models:
// Kenney Castle Kit and Fantasy Town Kit, KayKit Adventurers (knight, mage), Quaternius Animated
// Monsters (dragon, skeleton, bat). Hand-designed. Writes public/courses/fantasy.json.
//
//   npm run fantasy-course
import { writeFileSync } from 'node:fs';
import type { DiscCourseFile, PropDef } from '../src/course/disc-types';
import { encodeTrees } from '../src/course/disc-types';
import { dist, distToPolyline, type Vec2 } from '../src/course/geo';
import type { CourseFeature, Rings } from '../src/course/types';
import type { Collider } from '../src/disc/props';
import { along, bbox, courseJson, shapeColliders, faceToward, facing, heading, headingAt, makeHoles, propKit, rect, strip, teeMat, type HoleSpec } from './course-kit';

const { rng, R, pick, props, trees, solid, decor, tree } = propKit(20251);

const SPEC: HoleSpec[] = [
  { name: 'The King’s Road', tee: [0, 0], pin: [0, 112] },
  { name: 'Market Day', tee: [22, 126], via: [[55, 150]], pin: [102, 152] },
  { name: 'The Joust', tee: [128, 140], pin: [128, 38] },
  { name: 'Siege Line', tee: [150, 14], pin: [238, 36] },
  { name: 'Castle Keep', tee: [262, 52], pin: [262, 168] },
  { name: 'The Moat', tee: [236, 200], pin: [164, 254] },
  { name: 'Wizard’s Tower', tee: [140, 268], pin: [56, 244] },
  { name: 'Haunted Hollow', tee: [34, 226], via: [[-10, 206]], pin: [-42, 160] },
  { name: 'Dragon’s Lair', tee: [-50, 134], pin: [-30, 28] },
];
const H = makeHoles(SPEC);
const features: CourseFeature[] = [];
/** Areas kept clear of scattered trees and decoration (beyond fairways and props). */
const keepOut: { c: Vec2; r: number }[] = [];

// 1. The King's Road: a cobbled road to the basket, lined with banners and lanterns.
for (const r of strip([H[0].tee, along(H[0], 0.9)], 2.2)) features.push({ class: 'path', osm_id: 'road/1', rings: r });
for (let k = 1; k <= 5; k++) {
  const f = k * 0.16, d = heading(H[0]);
  for (const side of [-1, 1]) {
    const at = along(H[0], f, side * 8.5);
    if (k % 2) decor('castle/flag-banner-long.glb', at, 3, d);
    else solid('town/lantern.glb', at, 4, { hit: 'Clang! Lamp post', tag: 'lantern', fit: 1.2 });
  }
}
solid('town/lantern.glb', along(H[0], 0.55, 3.4), 4, { hit: 'Clang! Lamp post', tag: 'lantern', fit: 1.2 });

// 2. Market Day: stalls line the dogleg, a cart blocks the corner, a fountain backs the basket.
{
  const corner = H[1].routing[1];
  for (const [f, lat] of [[0.2, 7], [0.3, -7], [0.55, 8], [0.66, -7.5], [0.78, 7]] as const) {
    solid(pick(['town/stall-red.glb', 'town/stall-green.glb']), along(H[1], f, lat), 5, { yaw: facing(headingAt(H[1], f)) + (lat > 0 ? Math.PI / 2 : -Math.PI / 2), hit: 'Market stall!', tag: 'stall', fit: 0.9 });
  }
  solid('town/cart.glb', [corner[0] + 3, corner[1] - 2], 5, { hit: 'Thunk! Cart', tag: 'cart', fit: 0.6 });
  const back = along(H[1], 1, 0);
  const d = heading(H[1], 1);
  const f: Vec2 = [back[0] + Math.cos(d) * 8, back[1] + Math.sin(d) * 8];
  solid('town/fountain-round.glb', f, 5, { hit: 'Splash! Fountain', tag: 'fountain', fit: 0.95, round: true });
  keepOut.push({ c: f, r: 8 });
}

// 3. The Joust: a giant knight blocks the basket; a jousting barrier splits the fairway.
{
  const d = heading(H[2]);
  const at = along(H[2], 1, 0);
  const k: Vec2 = [at[0] - Math.cos(d) * 6, at[1] - Math.sin(d) * 6];
  // KayKit knight: 2.47 tall in its rest pose (measured in three.js; the GLB's raw bounds aren't skinned).
  const s = 4;
  props.push({ model: 'kaykit/Knight.glb', at: k, yaw: faceToward(d + Math.PI), scale: s, anim: 'Blocking', hit: 'Blocked by the knight!', colliders: [{ kind: 'cyl', c: k, r: 0.38 * s, z0: 0, z1: 2.47 * s, tag: 'knight' }] });
  // The tilt: a hedge row down the middle of the first half.
  for (let f = 0.3; f <= 0.6; f += 0.04) {
    const c = along(H[2], f, 0);
    const yaw = d - Math.PI / 2; // hedge's long axis (model Z) along the hole
    const sc = 4; // low enough to see the knight over it from the tee
    props.push({ model: 'town/hedge-large.glb', at: c, yaw, scale: sc, offset: [0.3, 0, 0], hit: 'Into the hedge!', colliders: [{ kind: 'box', c, yaw, hx: 0.2 * sc, hy: 0.5 * sc, z0: 0, z1: 0.6 * sc, tag: 'hedge' }] });
  }
  decor('castle/flag-banner-long.glb', along(H[2], 0.3, 9), 3, d);
  decor('castle/flag-banner-long.glb', along(H[2], 0.3, -9), 3, d);
}

// 4. Siege Line: catapults and trebuchets lined up across the fairway, aimed at the castle.
for (const [f, lat, m] of [[0.35, -5, 'castle/siege-catapult.glb'], [0.42, 8, 'castle/siege-trebuchet.glb'], [0.62, 1, 'castle/siege-trebuchet.glb'], [0.78, -7, 'castle/siege-catapult.glb'], [0.84, 7, 'castle/siege-catapult.glb']] as const) {
  solid(m, along(H[3], f, lat), m.includes('trebuchet') ? 4 : 4.5, { yaw: facing(heading(H[3])) + Math.PI / 2, hit: 'Siege engine!', tag: 'siege', fit: 0.6 });
}
for (const lat of [-12, 12]) solid('castle/rocks-large.glb', along(H[3], 0.55, lat), 5, { hit: 'Rocks!', tag: 'rock' });

// 5. Castle Keep: the basket is in the courtyard. Get in through the gate or over the walls.
{
  const c = H[4].pin;
  const d = heading(H[4]); // toward the castle
  const u: Vec2 = [Math.cos(d), Math.sin(d)], v: Vec2 = [-u[1], u[0]];
  const S = 6.5; // tile size in meters (Kenney castle tiles are 1 × 1.31 units)
  const n = 2; // tiles from center to wall: a 5 × 5 square
  const P = (a: number, b: number): Vec2 => [c[0] + u[0] * a * S + v[0] * b * S, c[1] + u[1] * a * S + v[1] * b * S];
  const wallH = 1.31 * S;
  const hit = 'Bonk! Castle wall';
  const wall = (a: number, b: number, along: 'u' | 'v') => {
    const at = P(a, b);
    // wall.glb runs along model X, which points at world angle `yaw` (u is at d, v at d + π/2).
    const yaw = along === 'v' ? d + Math.PI / 2 : d;
    // Model X is world direction `yaw` after the Y-up → Z-up turn; the box's local x matches.
    props.push({ model: 'castle/wall.glb', at, yaw, scale: S, hit, colliders: [{ kind: 'box', c: at, yaw, hx: 0.5 * S, hy: 0.45 * S, z0: 0, z1: wallH, tag: 'castle' }] });
  };
  for (let k = -n + 1; k <= n - 1; k++) {
    if (k !== 0) wall(-n, k, 'v'); // front wall, gate gap in the middle
    wall(n, k, 'v');
    wall(k, -n, 'u');
    wall(k, n, 'u');
  }
  for (const [a, b] of [[-n, -n], [-n, n], [n, -n], [n, n]] as const) {
    const at = P(a, b);
    props.push({ model: 'castle/tower-square.glb', at, yaw: d, scale: S, hit, colliders: [{ kind: 'box', c: at, yaw: d, hx: 0.5 * S, hy: 0.5 * S, z0: 0, z1: wallH, tag: 'castle' }] });
    props.push({ model: 'castle/tower-hexagon-roof.glb', at, yaw: d, scale: S, lift: wallH, hit, colliders: shapeColliders('castle/tower-hexagon-roof.glb', at, d, S, { lift: wallH, tag: 'castle' }) });
    decor('castle/flag-pennant.glb', at, S * 0.8, d, { lift: wallH + 0.83 * S });
  }
  // Gatehouse towers either side of the gap.
  for (const b of [-1, 1]) {
    const at = P(-n - 0.15, b * 0.95);
    props.push({ model: 'castle/tower-hexagon-base.glb', at, yaw: d, scale: S * 0.7, hit, colliders: shapeColliders('castle/tower-hexagon-base.glb', at, d, S * 0.7, { tag: 'castle' }) });
    props.push({ model: 'castle/tower-hexagon-roof.glb', at, yaw: d, scale: S * 0.7, lift: 1.31 * S * 0.7, hit, colliders: shapeColliders('castle/tower-hexagon-roof.glb', at, d, S * 0.7, { lift: 1.31 * S * 0.7, tag: 'castle' }) });
  }
  keepOut.push({ c, r: (n + 1.5) * S * Math.SQRT2 });
  // Courtyard: cobbles.
  features.push({ class: 'path', osm_id: 'courtyard', rings: [rect(c, d, (n - 0.5) * S, (n - 0.5) * S)] });
}

// 6. The Moat: water across the fairway between two watchtowers, then the basket.
{
  const d = heading(H[5]);
  const mid = along(H[5], 0.62);
  features.push({ class: 'water', osm_id: 'moat', rings: [rect(mid, d, 6, 34)] });
  for (const lat of [-22, 22]) solid('castle/tower-hexagon-base.glb', along(H[5], 0.62, lat), 5, { yaw: d, hit: 'Watchtower!', tag: 'watchtower', fit: 0.9 });
}

// 7. Wizard's Tower: a tall tower beside the basket, and its wizard casting at the tee.
{
  const d = heading(H[6]);
  const at = along(H[6], 1, 7);
  const s = 6.5;
  const parts: [string, number][] = [['castle/tower-hexagon-base.glb', 1.31], ['castle/tower-hexagon-mid.glb', 0.46], ['castle/tower-hexagon-mid.glb', 0.46], ['castle/tower-hexagon-mid.glb', 0.46], ['castle/tower-hexagon-mid.glb', 0.46]];
  let z = 0;
  // Every piece, roof included, collides as its own shape at its height in the stack.
  for (const [m, h] of [...parts, ['castle/tower-hexagon-roof.glb', 0.83] as [string, number]]) {
    const p: PropDef = { model: m, at, yaw: d, scale: s, colliders: shapeColliders(m, at, d, s, { lift: z, tag: 'tower' }), hit: 'Bonk! Wizard’s tower' };
    if (z > 0) p.lift = z;
    props.push(p);
    z += h * s;
  }
  z -= 0.83 * s; // the pennant sits on the roof's base, as before
  decor('castle/flag-pennant.glb', at, s * 0.8, d, { lift: z + 0.83 * s });
  const m = along(H[6], 0.88, -4);
  const ms = 2.2;
  props.push({ model: 'kaykit/Mage.glb', at: m, yaw: faceToward(d + Math.PI), scale: ms, anim: 'Spellcasting', hit: 'Zapped by the wizard!', colliders: [{ kind: 'cyl', c: m, r: 0.45 * ms, z0: 0, z1: 2.72 * ms, tag: 'mage' }] });
  keepOut.push({ c: at, r: 8 });
}

// 8. Haunted Hollow: crooked trees, skeletons, bats.
{
  for (const [f, lat] of [[0.2, 6], [0.3, -5], [0.45, 7], [0.55, -6], [0.66, 4.5], [0.75, -7], [0.85, 5]] as const) {
    tree('town/tree-crooked.glb', along(H[7], f, lat), R(4.5, 6), { crown: 0.85 });
  }
  // Quaternius skeleton: ~500 units tall (cm), so 0.011 → 5.5 m.
  for (const [f, lat] of [[0.38, 1.5], [0.92, -3.5]] as const) {
    const at = along(H[7], f, lat), s = 0.011;
    props.push({ model: 'quaternius/Skeleton.fbx', at, yaw: faceToward(headingAt(H[7], f) + Math.PI), scale: s, anim: 'SkeletonArmature|Skeleton_Idle', hit: 'Rattled a skeleton!', colliders: [{ kind: 'cyl', c: at, r: 70 * s, z0: 0, z1: 510 * s, tag: 'skeleton' }] });
  }
  for (const [f, lat, z] of [[0.3, 2, 7], [0.5, -2, 9], [0.62, 3, 6], [0.8, 0, 10]] as const) {
    const at = along(H[7], f, lat), s = 0.007;
    props.push({ model: 'quaternius/Bat.fbx', at, yaw: R(0, Math.PI * 2), scale: s, anim: 'BatArmature|Bat_Flying', lift: z, tint: { Main: '#4a3a6a' }, hit: 'Bat!', colliders: [{ kind: 'cyl', c: at, r: 120 * s, z0: z, z1: z + 460 * s, tag: 'bat' }] });
  }
}

// 9. Dragon's Lair: the dragon hovers in front of the basket on a rocky lair.
{
  const d = heading(H[8]);
  const pin = H[8].pin;
  const at: Vec2 = [pin[0] - Math.cos(d) * 5, pin[1] - Math.sin(d) * 5];
  // Quaternius dragon: 576 × 350 × 413 units (cm) with its body centered about (−3.5, ·, −26).
  const s = 0.032, lift = 5;
  const yaw = faceToward(d + Math.PI);
  const colliders: Collider[] = [
    { kind: 'cyl', c: at, r: 105 * s, z0: lift + 30 * s, z1: lift + 300 * s, tag: 'dragon' },
    // Wings, spread across the line (they flap, so this is a band around their average sweep).
    { kind: 'box', c: at, yaw: d + Math.PI / 2, hx: 270 * s, hy: 70 * s, z0: lift + 170 * s, z1: lift + 290 * s, tag: 'dragon' },
  ];
  props.push({ model: 'quaternius/Dragon.fbx', at, yaw, scale: s, offset: [-3.5, 0, -26], anim: 'DragonArmature|Dragon_Flying', lift, tint: { Main: '#a3262a', Wings: '#6e1a22', Belly: '#e8b04a', Claws: '#2a2420' }, hit: 'Scorched by the dragon!', colliders });
  for (const [a, r] of [[0.6, 9], [1.4, 10], [2.4, 9], [3.3, 11], [4.4, 9.5], [5.4, 10]] as const) {
    solid('castle/rocks-large.glb', [pin[0] + Math.cos(d + a) * r, pin[1] + Math.sin(d + a) * r], R(4, 6), { hit: 'Rocks!', tag: 'rock' });
  }
  keepOut.push({ c: pin, r: 16 });
}

// ---------- ground ----------
for (const h of H) for (const r of strip(h.routing, 6.5)) features.push({ class: 'fairway', osm_id: `fairway/${h.ref}`, rings: r });
for (const h of H) features.push({ class: 'tee', osm_id: `tee/${h.ref}`, rings: [teeMat(h)] });
for (let i = 0; i < H.length; i++) {
  const a = H[i].pin, b = H[(i + 1) % H.length].tee;
  for (const r of strip([a, b], 1.4)) features.push({ class: 'path', osm_id: `path/${i}`, rings: r });
}
const pts = H.flatMap((h) => h.routing);
const minX = Math.min(...pts.map((p) => p[0])) - 60, maxX = Math.max(...pts.map((p) => p[0])) + 60;
const minY = Math.min(...pts.map((p) => p[1])) - 60, maxY = Math.max(...pts.map((p) => p[1])) + 60;
const boundary: Rings[] = [[[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]]];

// ---------- woods and decoration (off fairways, tees, baskets, props) ----------
const clear = (p: Vec2, m: number) =>
  H.every((h) => distToPolyline(p, h.routing) > m && dist(p, h.tee) > m + 4 && dist(p, h.pin) > m + 6) &&
  props.every((q) => dist(p, q.at) > 9) && keepOut.every((k) => dist(p, k.c) > k.r);
const TREES = ['castle/tree-large.glb', 'castle/tree-small.glb', 'town/tree-high-round.glb'];
const treeScale = (m: string) => (m.includes('high-round') ? R(3.5, 4.5) : m.includes('small') ? R(6, 8) : R(5, 6.5));
for (let n = 0, tries = 0; n < 80 && tries < 6000; tries++) {
  const p: Vec2 = [R(minX + 10, maxX - 10), R(minY + 10, maxY - 10)];
  if (!clear(p, 14) || trees.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < 9)) continue;
  const m = pick(TREES);
  tree(m, p, treeScale(m));
  n++;
}
for (const h of H) for (const f of [0.3, 0.7]) {
  if (h.ref === '8') continue; // the hollow has its own trees
  const p = along(h, f, (rng() < 0.5 ? -1 : 1) * R(9, 12));
  const m = pick(TREES);
  if (clear(p, 8)) tree(m, p, treeScale(m));
}
for (const h of H) {
  const a = heading(h);
  decor('castle/flag-banner-long.glb', [h.tee[0] - Math.sin(a) * 4, h.tee[1] + Math.cos(a) * 4], 2.5, a);
}
for (let n = 0, tries = 0; n < 30 && tries < 3000; tries++) {
  const p: Vec2 = [R(minX + 5, maxX - 5), R(minY + 5, maxY - 5)];
  if (clear(p, 8)) { decor(pick(['castle/rocks-large.glb', 'town/hedge-large.glb', 'town/lantern.glb']), p, R(3, 5)); n++; }
}
// Sanity: model trees must have bounds (catches a typo in a model path at build time).
for (const m of new Set(props.map((p) => p.model))) if (m.endsWith('.glb')) bbox(m);

const course: DiscCourseFile = {
  sport: 'disc',
  style: 'vector',
  branch_density: 0.4,
  name: 'Fantasy Fairways',
  source: {
    osm_timestamp: 'n/a (hand-designed)', course_osm_id: 'none',
    attribution: ['Models (CC0): Kenney Castle Kit & Fantasy Town Kit (kenney.nl), KayKit Adventurers (Kay Lousberg), Animated Monsters (Quaternius)'],
  },
  origin: { lat: 0, lon: 0 },
  imagery_offset_m: [0, 0],
  bounds: [[minX - 20, minY - 20], [maxX + 20, maxY + 20]],
  boundary,
  features,
  canopy: [],
  ob: [],
  trees: encodeTrees(trees),
  holes: H,
  props,
  palette: { outside: '#46603a', rough: '#7da35a', fairway: '#9cc46b', path: '#c9b28a', water: '#3f7fb0', tee: '#8a6a4a' },
  sky: '#cfe3f0',
};
writeFileSync('public/courses/fantasy.json', courseJson(course));
console.log(`Fantasy Fairways: ${H.length} holes (${H.map((h) => `${h.ref}:${Math.round(h.length_m)}m p${h.par}`).join(' ')}), ${props.length} props, ${trees.length} trees`);
