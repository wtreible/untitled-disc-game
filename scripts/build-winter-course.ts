// "Frosty Pines": a 9-hole winter course in falling snow. Snowmen down the first, a candy-cane
// slalom, a frozen pond to carry, a toy train shuttling across the fairway, snow-fort walls, a
// reindeer crossing, a lamplit lane, a basket ringed by giant presents, and a giant decorated
// tree to get round at the end. CC0 models: Kenney Holiday Kit. Hand-designed. Writes
// public/courses/winter.json.
//
//   npm run winter-course
import { writeFileSync } from 'node:fs';
import type { DiscCourseFile } from '../src/course/disc-types';
import { encodeTrees } from '../src/course/disc-types';
import { dist, distToPolyline, type Vec2 } from '../src/course/geo';
import type { CourseFeature, Rings } from '../src/course/types';
import type { Collider } from '../src/disc/props';
import { along, bbox, courseJson, faceToward, facing, heading, headingAt, makeHoles, propKit, strip, teeMat, type HoleSpec } from './course-kit';

const { rng, R, pick, props, trees, solid, decor, tree } = propKit(1225);
const hk = (m: string) => `holiday/${m}.glb`;

const SPEC: HoleSpec[] = [
  { name: 'Snowman Alley', tee: [0, 0], pin: [0, 96] },
  { name: 'Candy Cane Lane', tee: [20, 118], via: [[52, 140]], pin: [104, 150] },
  { name: 'The Frozen Pond', tee: [126, 136], pin: [132, 40] },
  { name: 'The Toy Train', tee: [152, 14], pin: [244, 40] },
  { name: 'Snow Fort', tee: [266, 58], pin: [262, 172] },
  { name: 'Reindeer Crossing', tee: [238, 202], pin: [166, 252] },
  { name: 'Lamplight Lane', tee: [140, 268], pin: [58, 246] },
  { name: 'Present Pile-Up', tee: [34, 226], via: [[-10, 204]], pin: [-44, 160] },
  { name: 'The Big Tree', tee: [-52, 134], pin: [-30, 30] },
];
const H = makeHoles(SPEC);
const features: CourseFeature[] = [];
/** Areas kept clear of scattered trees and decoration (beyond fairways and props). */
const keepOut: { c: Vec2; r: number }[] = [];

/**
 * Something sliding back and forth along `dir` (a train car, a reindeer): its colliders move with
 * it. `box`: half length and width, and height (m), along the model's own X.
 */
function slider(model: string, at: Vec2, s: number, yaw: number, dir: number, amp: number, period: number, phase: number, box: [number, number, number], hit: string, tag: string): void {
  const slide = { amp: [Math.cos(dir) * amp, Math.sin(dir) * amp] as Vec2, period, phase };
  const parts: Collider[] = [{ kind: 'box', c: at, yaw, hx: box[0], hy: box[1], z0: 0, z1: box[2], tag }];
  props.push({ model: hk(model), at, yaw, scale: s, hit, colliders: [{ kind: 'slide', parts, slide, tag }], motion: { kind: 'slide', slide } });
}
const PRESENTS = ['present-a-cube', 'present-a-rectangle', 'present-a-round', 'present-b-cube', 'present-b-rectangle', 'present-b-round'];
const present = (at: Vec2, s: number, lift = 0) => solid(hk(pick(PRESENTS)), at, s, { lift, hit: 'Thud! A present', tag: 'present' });

// 1. Snowman Alley: snowmen down both sides, and one standing guard in the middle of the fairway.
{
  const h = H[0], d = heading(h);
  for (const f of [0.28, 0.42, 0.56, 0.7, 0.84]) for (const side of [-1, 1]) {
    solid(hk(rng() < 0.5 ? 'snowman' : 'snowman-hat'), along(h, f, side * R(6.5, 8.5)), R(1.8, 2.3), { yaw: facing(d + Math.PI) + R(-0.4, 0.4), hit: 'Poof! A snowman', tag: 'snowman', round: true, fit: 0.7 });
  }
  solid(hk('snowman-hat'), along(h, 0.5, 0.6), 3.4, { yaw: facing(d + Math.PI), hit: 'Poof! The big snowman', tag: 'snowman', round: true, fit: 0.7 });
}
// 2. Candy Cane Lane: giant candy canes as slalom gates through the dogleg.
{
  const h = H[1];
  let side = 1;
  for (let f = 0.18; f <= 0.86; f += 0.085) {
    solid(hk(side > 0 ? 'candy-cane-red' : 'candy-cane-green'), along(h, f, side * R(2.2, 3.2)), 10, { yaw: facing(headingAt(h, f)) + Math.PI / 2, hit: 'Crack! A candy cane', tag: 'candy-cane', round: true, fit: 0.3 });
    side = -side;
  }
  for (const f of [0.3, 0.55, 0.8]) for (const s of [-1, 1]) decor(hk(pick(['candy-cane-red', 'candy-cane-green'])), along(h, f, s * 10), 6, R(0, Math.PI * 2));
}
// 3. The Frozen Pond: a pond across the middle of the hole, skated over for a +1; benches and sleds on the bank.
{
  const h = H[2], d = heading(h);
  const c = along(h, 0.5);
  const ring = Array.from({ length: 36 }, (_, k): Vec2 => {
    const a = (k / 36) * Math.PI * 2;
    const u = Math.cos(a) * 16, v = Math.sin(a) * 24 * (1 + 0.08 * Math.sin(a * 3));
    return [c[0] + Math.cos(d) * u - Math.sin(d) * v, c[1] + Math.sin(d) * u + Math.cos(d) * v];
  });
  features.push({ class: 'water', osm_id: 'pond', rings: [ring] });
  keepOut.push({ c, r: 28 });
  for (const s of [-1, 1]) {
    const bank = along(h, 0.5, s * 28);
    solid(hk('bench'), bank, 2.2, { yaw: facing(d) + (s > 0 ? -Math.PI / 2 : Math.PI / 2), hit: 'Bonk! A bench', tag: 'bench' });
    decor(hk(rng() < 0.5 ? 'sled' : 'sled-long'), along(h, 0.42, s * 27), 2.6, R(0, Math.PI * 2));
  }
  for (const f of [0.22, 0.78]) for (const s of [-1, 1]) decor(hk('snow-pile'), along(h, f, s * 12), R(3, 4.5));
}
// 4. The Toy Train: a giant toy train shuttling back and forth across the fairway on its rails.
{
  const h = H[3], d = heading(h);
  const across = d + Math.PI / 2;
  const mid = along(h, 0.52);
  const S = 6;
  // Rails: 3 m pieces from one side of the fairway to the other.
  for (let k = -9; k <= 9; k++) decor(hk('trainset-rail-straight'), [mid[0] + Math.cos(across) * k * 0.5 * S, mid[1] + Math.sin(across) * k * 0.5 * S], S, across);
  // The train, nose first: locomotive, tender, two wagons, one behind the other along the rails.
  const cars: [string, number, number][] = [['train-locomotive', 0.67, 0.43], ['train-tender', 0.35, 0.18], ['train-wagon', 0.72, 0.31], ['train-wagon-logs', 0.69, 0.22]];
  let back = 0;
  for (const [m, len, ht] of cars) {
    const off = back + (len * S) / 2;
    const at: Vec2 = [mid[0] - Math.cos(across) * off, mid[1] - Math.sin(across) * off];
    slider(m, at, S, across, across, 13, 11, 0, [(len * S) / 2, 0.14 * S, ht * S], 'Toot toot! The toy train', 'train');
    back += len * S + 0.4;
  }
  keepOut.push({ c: mid, r: 32 });
}
// 5. Snow Fort: two walls of snow across the fairway, the gap on alternate sides; snow piles about.
{
  const h = H[4], d = heading(h);
  const wall = (f: number, gapSide: number) => {
    for (let k = -4; k <= 4; k++) {
      if (k * gapSide >= 1 && k * gapSide <= 2) continue; // the way through
      solid(hk('snow-bunker'), along(h, f, k * 7), 4, { yaw: d, hit: 'Whumpf! The snow fort', tag: 'snow-fort' });
    }
  };
  wall(0.38, 1);
  wall(0.66, -1);
  for (let k = 0; k < 8; k++) decor(hk('snow-pile'), along(h, R(0.15, 0.85), (rng() < 0.5 ? -1 : 1) * R(10, 16)), R(2.5, 4));
}
// 6. Reindeer Crossing: reindeer walking back and forth across the fairway; a sled waiting by the tee.
{
  const h = H[5], d = heading(h);
  const across = d + Math.PI / 2;
  for (const [f, phase] of [[0.42, 0], [0.7, 0.5]] as const) {
    slider('reindeer', along(h, f), 2, faceToward(across), across, 9, 7, phase, [0.32 * 2, 0.55 * 2, 1.12 * 2], 'Oof! A reindeer', 'reindeer');
  }
  decor(hk('sled-long'), along(h, 0.06, 5), 3, d);
}
// 7. Lamplight Lane: lanterns down both sides, benches between them, and lights strung along.
{
  const h = H[6], d = heading(h);
  for (let f = 0.15; f <= 0.9; f += 0.12) for (const side of [-1, 1]) {
    solid(hk('lantern'), along(h, f, side * 5.2), 1.7, { hit: 'Clang! A lantern', tag: 'lantern', round: true, fit: 0.45 });
  }
  for (const f of [0.33, 0.57, 0.81]) for (const side of [-1, 1]) decor(hk('bench'), along(h, f, side * 7.5), 2.2, facing(d) + (side > 0 ? Math.PI / 2 : -Math.PI / 2));
  for (const f of [0.21, 0.45, 0.69]) for (const side of [-1, 1]) decor(hk(pick(['lights-colored', 'lights-red', 'lights-green'])), along(h, f, side * 5.2), 4, d, { lift: 3 });
}
// 8. Present Pile-Up: giant presents through the dogleg, and a wall of them round the basket, open to the hole.
{
  const h = H[7], c = h.pin;
  for (let k = 0; k < 14; k++) present(along(h, R(0.15, 0.8), (rng() < 0.5 ? -1 : 1) * R(5, 11)), R(3, 4.5));
  const toTee = Math.atan2(h.routing[h.routing.length - 2][1] - c[1], h.routing[h.routing.length - 2][0] - c[0]);
  for (let k = 0; k < 12; k++) {
    const a = toTee + 0.75 + (k / 11) * (Math.PI * 2 - 1.5); // round the back, leaving the front open
    const at: Vec2 = [c[0] + Math.cos(a) * 6, c[1] + Math.sin(a) * 6];
    present(at, 4.2);
    if (k % 2 === 0) present(at, 3, 4.2 * 0.57);
  }
  keepOut.push({ c, r: 9 });
}
// 9. The Big Tree: a giant decorated tree in the fairway short of the basket; nutcrackers on guard.
{
  const h = H[8], d = heading(h), c = h.pin;
  tree(hk('tree-decorated-snow'), along(h, 0.7), 7, { base: 0.12 });
  for (const side of [-1, 1]) solid(hk('nutcracker'), [c[0] + Math.cos(d + side * 1.9) * 4.5, c[1] + Math.sin(d + side * 1.9) * 4.5], 2.6, { yaw: facing(d + Math.PI), hit: 'Clack! A nutcracker', tag: 'nutcracker', round: true, fit: 0.6 });
  for (let k = 0; k < 6; k++) present(along(h, R(0.6, 0.8), (rng() < 0.5 ? -1 : 1) * R(5, 9)), R(2.5, 3.5));
  keepOut.push({ c: along(h, 0.7), r: 12 });
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

// ---------- snowy woods and decoration (off fairways, tees, baskets, props) ----------
const clear = (p: Vec2, m: number) =>
  H.every((h) => distToPolyline(p, h.routing) > m && dist(p, h.tee) > m + 4 && dist(p, h.pin) > m + 6) &&
  props.every((q) => dist(p, q.at) > 7) && keepOut.every((k) => dist(p, k.c) > k.r);
const PINES = ['tree-snow-a', 'tree-snow-b', 'tree-snow-c', 'tree-snow-a', 'tree'];
for (let n = 0, tries = 0; n < 110 && tries < 9000; tries++) {
  const p: Vec2 = [R(minX + 10, maxX - 10), R(minY + 10, maxY - 10)];
  if (!clear(p, 12) || trees.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < 7)) continue;
  tree(hk(pick(PINES)), p, R(4.2, 5.8), { base: 0.18 });
  n++;
}
for (let n = 0, tries = 0; n < 60 && tries < 6000; tries++) {
  const p: Vec2 = [R(minX + 5, maxX - 5), R(minY + 5, maxY - 5)];
  if (!clear(p, 9)) continue;
  const r = rng();
  if (r < 0.45) decor(hk('snow-pile'), p, R(3, 5));
  else if (r < 0.75) decor(hk(pick(['rocks-small', 'rocks-medium'])), p, R(1.8, 2.6));
  else if (r < 0.9) decor(hk(pick(['snowman', 'snowman-hat'])), p, R(1.6, 2.1));
  else decor(hk(pick(['tree-decorated', 'tree-decorated-snow'])), p, R(3.5, 4.5));
  n++;
}
for (const h of H) {
  const a = heading(h);
  decor(hk('lantern'), [h.tee[0] - Math.sin(a) * 3, h.tee[1] + Math.cos(a) * 3], 1.5, a);
  decor(hk(pick(PRESENTS)), [h.tee[0] + Math.sin(a) * 3, h.tee[1] - Math.cos(a) * 3], 2.2, a + Math.PI);
}
// Sanity: every model has bounds (catches a typo in a model path at build time).
for (const m of new Set([...props.map((p) => p.model)])) bbox(m);

const course: DiscCourseFile = {
  sport: 'disc',
  style: 'vector',
  branch_density: 0.35,
  name: 'Frosty Pines',
  source: { osm_timestamp: 'n/a (hand-designed)', course_osm_id: 'none', attribution: ['Models (CC0): Kenney Holiday Kit (kenney.nl)'] },
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
  toasts: { water: 'Through the ice! +1', oob: 'Into the snowdrifts! +1' },
  // Snow: white ground, packed-snow fairways, shoveled paths, an icy pond, wooden tee mats.
  palette: { outside: '#eef3f8', rough: '#e3ebf3', fairway: '#d0dce8', path: '#b6c2ce', water: '#9fd0ea', tee: '#8a6a4a' },
  sky: '#cdd8e4',
  weather: 'snow',
};
writeFileSync('public/courses/winter.json', courseJson(course));
console.log(`Frosty Pines: ${H.length} holes (${H.map((h) => `${h.ref}:${Math.round(h.length_m)}m p${h.par}`).join(' ')}), ${props.length} props, ${trees.length} trees`);
