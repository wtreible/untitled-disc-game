// "Graveyard Shift": a 9-hole night course through a haunted cemetery. Through the cemetery gates,
// a pumpkin patch, round a great crypt, past a wandering ghost, through dead woods, over a bog,
// down a lantern-lit lane, between shuffling zombies, and into the vampire's fenced lair. CC0
// models: Kenney Graveyard Kit. Hand-designed. Writes public/courses/graveyard.json.
//
//   npm run graveyard-course
import { writeFileSync } from 'node:fs';
import type { DiscCourseFile } from '../src/course/disc-types';
import { encodeTrees } from '../src/course/disc-types';
import { dist, distToPolyline, type Vec2 } from '../src/course/geo';
import type { CourseFeature, Rings } from '../src/course/types';
import type { Collider } from '../src/disc/props';
import { along, bbox, circle, courseJson, faceToward, facing, heading, headingAt, makeHoles, propKit, strip, teeMat, type HoleSpec } from './course-kit';

const { rng, R, pick, props, trees, solid, decor, tree } = propKit(31031);
const gy = (m: string) => `graveyard/${m}.glb`;

const SPEC: HoleSpec[] = [
  { name: 'Cemetery Gates', tee: [0, 0], pin: [0, 100] },
  { name: 'Pumpkin Patch', tee: [20, 118], via: [[52, 140]], pin: [100, 150] },
  { name: 'The Crypt', tee: [125, 138], pin: [130, 40] },
  { name: 'Wandering Ghost', tee: [152, 14], pin: [244, 40] },
  { name: 'Dead Wood', tee: [266, 58], pin: [262, 172] },
  { name: 'The Bog', tee: [238, 202], pin: [166, 252] },
  { name: 'Lantern Lane', tee: [140, 268], pin: [58, 246] },
  { name: 'Zombie Shuffle', tee: [34, 226], via: [[-10, 204]], pin: [-44, 160] },
  { name: 'The Vampire’s Lair', tee: [-52, 134], pin: [-30, 30] },
];
const H = makeHoles(SPEC);
const features: CourseFeature[] = [];
/** Areas kept clear of scattered trees and decoration (beyond fairways and props). */
const keepOut: { c: Vec2; r: number }[] = [];

/** A character (Kenney's are ~0.8 units tall): life size at scale ~2.3, giant beyond. A cylinder collider. */
const CHAR_H = 0.83, CHAR_R = 0.22;
function character(model: string, at: Vec2, s: number, yaw: number, anim: string, hit: string, tag: string, lift = 0): void {
  props.push({ model: gy(model), at, yaw, scale: s, anim, hit, lift: lift || undefined, colliders: [{ kind: 'cyl', c: at, r: CHAR_R * s, z0: lift, z1: lift + CHAR_H * s, tag }] });
}
/** A character walking back and forth across a fairway (its collider moves with it). */
function walker(model: string, at: Vec2, s: number, dir: number, amp: number, period: number, phase: number, hit: string, tag: string, lift = 0): void {
  const slide = { amp: [Math.cos(dir) * amp, Math.sin(dir) * amp] as Vec2, period, phase };
  const parts: Collider[] = [{ kind: 'cyl', c: at, r: CHAR_R * s, z0: lift, z1: lift + CHAR_H * s, tag }];
  props.push({ model: gy(model), at, yaw: faceToward(dir), scale: s, anim: 'walk', hit, lift: lift || undefined, colliders: [{ kind: 'slide', parts, slide, tag }], motion: { kind: 'slide', slide } });
}
/** A run of fence panels (1 unit long) from a to b, colliding as boxes; `gap` leaves panels out by index. */
function fence(model: string, a: Vec2, b: Vec2, s: number, hit: string, gap: (k: number, n: number) => boolean = () => false): void {
  const L = dist(a, b), n = Math.max(1, Math.round(L / s));
  const yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const { max, min } = bbox(gy(model));
  for (let k = 0; k < n; k++) {
    if (gap(k, n)) continue;
    const f = (k + 0.5) / n;
    const at: Vec2 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    props.push({ model: gy(model), at, yaw, scale: s, hit, colliders: [{ kind: 'box', c: at, yaw, hx: 0.5 * s, hy: Math.max(0.06, (max[2] - min[2]) / 2) * s, z0: 0, z1: (max[1] - min[1]) * s, tag: 'fence' }] });
  }
}
const GRAVES = ['gravestone-cross', 'gravestone-round', 'gravestone-wide', 'gravestone-decorative', 'gravestone-bevel', 'gravestone-roof', 'gravestone-cross-large', 'gravestone-broken'];
const grave = (at: Vec2, yaw: number) => solid(gy(pick(GRAVES)), at, R(2, 2.5), { yaw, hit: 'Thunk! A gravestone', tag: 'grave' });

// 1. Cemetery Gates: an iron fence across the fairway, the gate open in the middle; rows of graves.
{
  const h = H[0], d = heading(h);
  const v: Vec2 = [-Math.sin(d), Math.cos(d)];
  const at = along(h, 0.32);
  const half = 26;
  // Panels 2.5 m long: the middle two left out are the open gate, 5 m wide.
  fence('iron-fence', [at[0] - v[0] * half, at[1] - v[1] * half], [at[0] + v[0] * half, at[1] + v[1] * half], 2.5, 'Clang! The cemetery fence', (k, n) => Math.abs(k - (n - 1) / 2) < 1);
  for (const side of [-1, 1]) solid(gy('pillar-square'), [at[0] + v[0] * side * 3.4, at[1] + v[1] * side * 3.4], 2.6, { yaw: d, hit: 'Bonk! Gatepost', tag: 'gatepost' });
  for (const f of [0.5, 0.62, 0.74, 0.86]) for (const side of [-1, 1]) for (const k of [0, 1]) grave(along(h, f, side * (9 + k * 4)), facing(d));
  keepOut.push({ c: at, r: 6 });
}
// 2. Pumpkin Patch: pumpkins through the dogleg and a ring of them round the basket; hay bales, a keeper.
{
  const h = H[1];
  for (let k = 0; k < 26; k++) {
    const f = R(0.15, 0.85), lat = (rng() < 0.5 ? -1 : 1) * R(5, 12);
    solid(gy(pick(['pumpkin', 'pumpkin-carved', 'pumpkin-tall', 'pumpkin-tall-carved'])), along(h, f, lat), R(2.4, 3.4), { hit: 'Squish! A pumpkin', tag: 'pumpkin', round: true });
  }
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.3;
    solid(gy(pick(['pumpkin-carved', 'pumpkin-tall-carved'])), [h.pin[0] + Math.cos(a) * 5.5, h.pin[1] + Math.sin(a) * 5.5], 3, { hit: 'Squish! A pumpkin', tag: 'pumpkin', round: true });
  }
  for (const [f, lat] of [[0.3, -14], [0.55, 14]] as const) solid(gy(pick(['hay-bale', 'hay-bale-bundled'])), along(h, f, lat), 3, { hit: 'Hay!', tag: 'hay' });
  character('character-keeper', along(h, 0.95, 9), 2.4, faceToward(headingAt(h, 0.95) + Math.PI), 'idle', 'Shooed by the groundskeeper!', 'keeper');
  keepOut.push({ c: h.pin, r: 9 });
}
// 3. The Crypt: a great crypt across the line just short of the basket. Round it, or over the roof.
{
  const h = H[2], d = heading(h);
  const at = along(h, 0.74);
  solid(gy('crypt-large'), at, 5, { yaw: facing(d), hit: 'Bonk! Into the crypt', tag: 'crypt' });
  for (const side of [-1, 1]) solid(gy('pillar-obelisk'), along(h, 0.62, side * 8), 3, { yaw: d, hit: 'Bonk! An obelisk', tag: 'obelisk' });
  for (const side of [-1, 1]) decor(gy('fire-basket'), along(h, 0.66, side * 5), 3, d);
  keepOut.push({ c: at, r: 14 });
}
// 4. Wandering Ghost: a giant ghost drifts back and forth across the fairway, floating off the ground.
{
  const h = H[3], d = heading(h);
  walker('character-ghost', along(h, 0.5), 6, d + Math.PI / 2, 20, 11, 0, 'Spooked by the ghost!', 'ghost', 0.6);
  for (const f of [0.25, 0.75]) for (const side of [-1, 1]) grave(along(h, f, side * 11), facing(d));
  keepOut.push({ c: along(h, 0.5), r: 24 });
}
// 5. Dead Wood: a narrow corridor through crooked dead pines, a couple out on the line.
{
  const h = H[4];
  for (let k = 0; k < 22; k++) {
    const f = 0.12 + (k / 22) * 0.78;
    const side = k % 2 ? 1 : -1;
    tree(gy(pick(['pine-crooked', 'pine-fall-crooked', 'pine-fall'])), along(h, f, side * R(7.5, 11)), R(3.6, 4.6), { base: 0.25 });
  }
  for (const f of [0.42, 0.68]) tree(gy('pine-crooked'), along(h, f, R(-2, 2)), 4.2, { base: 0.3 });
}
// 6. The Bog: a murky pond to carry, tall rocks in it, graves on the far bank.
{
  const h = H[5], d = heading(h);
  const c = along(h, 0.5);
  const ring = circle(c, 15, 28).map((p, k): Vec2 => { const w = 1 + 0.12 * Math.sin(k * 1.7); return [c[0] + (p[0] - c[0]) * w * 1.25, c[1] + (p[1] - c[1]) * w]; });
  // Stretched along the hole: turn it to the hole's heading.
  const turned = ring.map((p): Vec2 => { const x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * Math.cos(d) - y * Math.sin(d), c[1] + x * Math.sin(d) + y * Math.cos(d)]; });
  features.push({ class: 'water', osm_id: 'bog', rings: [turned] });
  for (const [f, lat] of [[0.45, 6], [0.56, -5]] as const) solid(gy('rocks-tall'), along(h, f, lat), R(2.5, 3.2), { hit: 'Rocks!', tag: 'rock' });
  for (const lat of [-10, -5, 5, 10]) grave(along(h, 0.82, lat), facing(d + Math.PI));
  keepOut.push({ c, r: 22 });
}
// 7. Lantern Lane: a narrow lane between stone walls, lamp posts down both sides.
{
  const h = H[6], d = heading(h);
  for (const side of [-1, 1]) {
    const a = along(h, 0.18, side * 7.5), b = along(h, 0.82, side * 7.5);
    fence('stone-wall', a, b, 2.4, 'Bonk! A stone wall');
    for (let k = 0; k <= 5; k++) solid(gy('lightpost-single'), along(h, 0.2 + k * 0.12, side * 5.5), 2.8, { yaw: faceToward(d + (side < 0 ? Math.PI / 2 : -Math.PI / 2)), hit: 'Clang! Lamp post', tag: 'lamp' });
  }
  keepOut.push({ c: along(h, 0.5), r: 12 });
}
// 8. Zombie Shuffle: three zombies shamble across the dogleg, out of step.
{
  const h = H[7];
  for (const [f, amp, period, phase] of [[0.3, 9, 13, 0], [0.55, 11, 16, 0.4], [0.78, 8, 12, 0.7]] as const) {
    walker('character-zombie', along(h, f), 3, headingAt(h, f) + Math.PI / 2, amp, period, phase, 'Grabbed by a zombie!', 'zombie');
  }
  for (const f of [0.2, 0.45, 0.7]) for (const side of [-1, 1]) grave(along(h, f, side * 12), facing(headingAt(h, f)));
  decor(gy('shovel-dirt'), along(h, 0.62, 10), 2.4);
  decor(gy('coffin-old'), along(h, 0.4, -10), 2.4);
}
// 9. The Vampire's Lair: the basket in a ring of iron fence, the gate toward the tee; the vampire waits.
{
  const h = H[8], d = heading(h);
  const c = h.pin, r = 9, n = 18;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    // The gate: the two panels facing the tee left open.
    const toTee = Math.atan2(h.tee[1] - c[1], h.tee[0] - c[0]);
    if (Math.abs(Math.atan2(Math.sin(mid - toTee), Math.cos(mid - toTee))) < Math.PI / n * 1.1) continue;
    fence('iron-fence', [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], dist([Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]), 'Clang! The lair’s fence');
  }
  character('character-vampire', [c[0] + Math.cos(d) * 4, c[1] + Math.sin(d) * 4], 2.6, faceToward(d + Math.PI), 'idle', 'Bitten by the vampire!', 'vampire');
  for (const a of [-0.9, 0.9]) solid(gy('coffin'), [c[0] + Math.cos(d + a) * 5.5, c[1] + Math.sin(d + a) * 5.5], 2.6, { yaw: d + a, hit: 'Thunk! A coffin', tag: 'coffin' });
  for (const side of [-1, 1]) decor(gy('candle-multiple'), along(h, 0.86, side * 3), 3, d);
  features.push({ class: 'path', osm_id: 'lair', rings: [circle(c, r - 1, 32)] });
  keepOut.push({ c, r: r + 6 });
}

// ---------- ground ----------
for (const h of H) for (const rr of strip(h.routing, 6.5)) features.push({ class: 'fairway', osm_id: `fairway/${h.ref}`, rings: rr });
for (const h of H) features.push({ class: 'tee', osm_id: `tee/${h.ref}`, rings: [teeMat(h)] });
for (let i = 0; i < H.length; i++) {
  const a = H[i].pin, b = H[(i + 1) % H.length].tee;
  for (const rr of strip([a, b], 1.4)) features.push({ class: 'path', osm_id: `path/${i}`, rings: rr });
}
const pts = H.flatMap((h) => h.routing);
const minX = Math.min(...pts.map((p) => p[0])) - 60, maxX = Math.max(...pts.map((p) => p[0])) + 60;
const minY = Math.min(...pts.map((p) => p[1])) - 60, maxY = Math.max(...pts.map((p) => p[1])) + 60;
const boundary: Rings[] = [[[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]]];

// ---------- dead woods, graves and decoration (off fairways, tees, baskets, props) ----------
const clear = (p: Vec2, m: number) =>
  H.every((h) => distToPolyline(p, h.routing) > m && dist(p, h.tee) > m + 4 && dist(p, h.pin) > m + 6) &&
  props.every((q) => dist(p, q.at) > 7) && keepOut.every((k) => dist(p, k.c) > k.r);
const PINES = ['pine-crooked', 'pine-fall-crooked', 'pine-fall', 'pine'];
for (let n = 0, tries = 0; n < 90 && tries < 8000; tries++) {
  const p: Vec2 = [R(minX + 10, maxX - 10), R(minY + 10, maxY - 10)];
  if (!clear(p, 13) || trees.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < 8)) continue;
  tree(gy(pick(PINES)), p, R(3.4, 4.8), { base: 0.25 });
  n++;
}
for (let n = 0, tries = 0; n < 70 && tries < 6000; tries++) {
  const p: Vec2 = [R(minX + 5, maxX - 5), R(minY + 5, maxY - 5)];
  if (!clear(p, 9)) continue;
  if (rng() < 0.7) grave(p, R(0, Math.PI * 2));
  else decor(gy(pick(['crypt-small', 'crypt', 'pillar-obelisk', 'cross-column', 'urn-round', 'debris', 'rocks'])), p, R(2.4, 3.6));
  n++;
}
for (const h of H) {
  const a = heading(h);
  decor(gy('lantern-candle'), [h.tee[0] - Math.sin(a) * 3, h.tee[1] + Math.cos(a) * 3], 3, a);
  decor(gy('pumpkin-carved'), [h.tee[0] + Math.sin(a) * 3, h.tee[1] - Math.cos(a) * 3], 3, a + Math.PI);
}
// Sanity: every model has bounds (catches a typo in a model path at build time).
for (const m of new Set(props.map((p) => p.model))) bbox(m);

const course: DiscCourseFile = {
  sport: 'disc',
  style: 'vector',
  branch_density: 0.35,
  name: 'Graveyard Shift',
  source: { osm_timestamp: 'n/a (hand-designed)', course_osm_id: 'none', attribution: ['Models (CC0): Kenney Graveyard Kit (kenney.nl)'] },
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
  toasts: { water: 'Into the bog! +1' },
  // Night: dark moss, dim fairways, a murky bog, under a purple sky and stars.
  palette: { outside: '#1f2a22', rough: '#33422c', fairway: '#4d6a38', path: '#6a5a48', water: '#34503f', tee: '#5b4a3a' },
  sky: '#2a2342',
  stars: 500,
  weather: 'night',
};
writeFileSync('public/courses/graveyard.json', courseJson(course));
console.log(`Graveyard Shift: ${H.length} holes (${H.map((h) => `${h.ref}:${Math.round(h.length_m)}m p${h.par}`).join(' ')}), ${props.length} props, ${trees.length} trees`);
