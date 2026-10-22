// "Mini Golf Madness": a normal-length disc golf course themed like mini golf, with Kenney CC0
// models (minigolf kit, cube pets, nature kit) scaled up as obstacles and decoration.
// Hand-designed (not from OSM). Writes public/courses/silly.json.
//
//   npm run silly-course
import { writeFileSync } from 'node:fs';
import type { DiscCourseFile } from '../src/course/disc-types';
import { encodeTrees } from '../src/course/disc-types';
import { dist, distToPolyline, type Vec2 } from '../src/course/geo';
import type { CourseFeature, Rings } from '../src/course/types';
import { CASTLE_SINK, castleColliders, windmillColliders, type Collider } from '../src/disc/props';
import { along, circle, courseJson, facing, heading, makeHoles, propKit, shapeColliders, strip, teeMat, type HoleSpec } from './course-kit';


const { rng, R, pick, props, trees, solid, decor, tree } = propKit(12345);

// ---------- holes ----------
const SPEC: HoleSpec[] = [
  { name: 'Windmill Way', tee: [0, 0], pin: [0, 100] },
  { name: 'Moo-ve Over', tee: [25, 112], via: [[60, 150]], pin: [108, 165] },
  { name: 'Castle Crash', tee: [135, 150], pin: [135, 20] },
  { name: 'Penguin Parade', tee: [158, 0], pin: [228, 30] },
  { name: 'Giraffe Gate', tee: [242, 50], pin: [246, 160] },
  { name: 'Mushroom Kingdom', tee: [228, 182], pin: [168, 252] },
  { name: 'Ball Pit', tee: [148, 262], pin: [58, 238] },
  { name: 'Lion’s Den', tee: [38, 222], via: [[-10, 205]], pin: [-42, 160] },
  { name: 'Island Green', tee: [-48, 135], pin: [-30, 62] },
];
const holes = makeHoles(SPEC);
const H = holes;

// 1. Windmill Way: the windmill stands on the line, blades facing the tee; thread the tunnel.
{
  const at = along(H[0], 0.72);
  const yaw = facing(heading(H[0]) + Math.PI); // forward axis toward the tee
  props.push({ model: 'minigolf/structure-windmill.glb', at, yaw, scale: 15, spin: { node: 'blades', omega: 0.6, phase: 0 }, colliders: windmillColliders(at, yaw, 15, 0.6, 0), hit: 'Windmill!' });
}
// 2. Moo-ve Over: a giant cow guards the basket; a pig grazes at the corner.
solid('pets/animal-cow.glb', along(H[1], 0.94, 1.5), 3.6, { anim: 'eat', hit: 'Moo!', tag: 'cow', yaw: heading(H[1], 1) + Math.PI / 2 });
solid('pets/animal-pig.glb', along(H[1], 0.45, -9), 3, { anim: 'idle', hit: 'Oink!', tag: 'pig' });
// 3. Castle Crash: throw through the gate.
{
  const at = along(H[2], 0.5);
  const yaw = facing(heading(H[2]));
  props.push({ model: 'minigolf/castle.glb', at, yaw, scale: 30, lift: -CASTLE_SINK * 30, colliders: castleColliders(at, yaw, 30), hit: 'Bonk! Castle wall' });
}
// 4. Penguin Parade: a dancing line across the fairway with gaps.
for (let k = -3; k <= 3; k++) {
  if (k === 0) continue;
  solid('pets/animal-penguin.glb', along(H[3], 0.62, k * 4.2), 2.2, { anim: 'dance', hit: 'Penguin!', tag: 'penguin', yaw: heading(H[3]) + Math.PI / 2 + Math.PI });
}
// 5. Giraffe Gate + an elephant by the basket.
solid('pets/animal-giraffe.glb', along(H[4], 0.5, 7), 4.2, { anim: 'idle', hit: 'Giraffe!', tag: 'giraffe' });
solid('pets/animal-giraffe.glb', along(H[4], 0.5, -7), 4.2, { anim: 'eat', hit: 'Giraffe!', tag: 'giraffe' });
solid('pets/animal-elephant.glb', along(H[4], 0.93, -2.5), 3.4, { anim: 'idle', hit: 'Pawoo!', tag: 'elephant' });
// 6. Mushroom Kingdom.
for (const [f, lat, sc] of [[0.3, 6, 30], [0.45, -4, 26], [0.6, 3, 34], [0.75, -6, 28], [0.88, 2.5, 22]] as const) {
  const model = pick(['nature/mushroom_redTall.glb', 'nature/mushroom_red.glb']);
  const at = along(H[5], f, lat);
  // Traced from the model: a narrow stem under a domed cap.
  const yaw = R(0, Math.PI * 2);
  props.push({ model, at, yaw, scale: sc, hit: 'Boing! Mushroom', colliders: shapeColliders(model, at, yaw, sc, { tag: 'mushroom' }) });
}
// 7. Ball Pit: giant golf balls as boulders.
for (const [f, lat] of [[0.35, 5], [0.5, -3], [0.62, 6], [0.75, -5], [0.86, 1.5]] as const) {
  const p = solid(pick(['minigolf/ball-red.glb', 'minigolf/ball-blue.glb', 'minigolf/ball-green.glb']), along(H[6], f, lat), 100, { hit: 'Fore! Giant ball', tag: 'ball', fit: 0.95, round: true });
  // Kenney balls are centered on the origin: lift them to sit on the grass.
  p.colliders = (p.colliders as Extract<Collider, { kind: 'cyl' }>[]).map((c) => ({ ...c, z0: 0, z1: 6 }));
  p.lift = 3;
}
// 8. Lion's Den: a lion on a rock by the basket, palms around.
solid('nature/rock_tallA.glb', along(H[7], 0.9, 4), 5, { hit: 'Rock!', tag: 'rock' });
// Stands on the rock: its collider goes up with it (it used to stay on the ground).
solid('pets/animal-lion.glb', along(H[7], 0.9, 4), 2.6, { anim: 'idle', hit: 'Roar!', tag: 'lion', lift: 5 });
for (const f of [0.25, 0.55, 0.8]) tree('nature/tree_palmTall.glb', along(H[7], f, f > 0.5 ? -9 : 9), 9);
// 9. Island Green: basket on an island in a pond, guarded by a crab and chicks.
solid('pets/animal-crab.glb', along(H[8], 0.97, -3), 2, { anim: 'walk', hit: 'Snip!', tag: 'crab' });
for (const lat of [-6, 6]) solid('pets/animal-chick.glb', along(H[8], 0.5, lat), 2, { anim: 'idle', hit: 'Cheep!', tag: 'chick' });

// ---------- ground ----------
const features: CourseFeature[] = [];
for (const h of H) for (const r of strip(h.routing, 6)) features.push({ class: 'fairway', osm_id: `fairway/${h.ref}`, rings: r });
// Tee mats.
for (const h of H) {
  features.push({ class: 'tee', osm_id: `tee/${h.ref}`, rings: [teeMat(h)] });
}
// Island pond (water ring around an island with the basket).
features.push({ class: 'water', osm_id: 'pond/island', rings: [circle(H[8].pin, 17), circle(H[8].pin, 6).reverse()] });
// Walking paths from each basket to the next tee.
for (let i = 0; i < H.length; i++) {
  const a = H[i].pin, b = H[(i + 1) % H.length].tee;
  for (const r of strip([a, b], 1.4)) features.push({ class: 'path', osm_id: `path/${i}`, rings: r });
}
// Park boundary: a rounded hull around everything.
const pts = H.flatMap((h) => h.routing);
const minX = Math.min(...pts.map((p) => p[0])) - 45, maxX = Math.max(...pts.map((p) => p[0])) + 45;
const minY = Math.min(...pts.map((p) => p[1])) - 45, maxY = Math.max(...pts.map((p) => p[1])) + 45;
const boundary: Rings[] = [[[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]]];

// ---------- scattered trees and decoration (kept off fairways, tees, baskets, props) ----------
const clear = (p: Vec2, m: number) =>
  H.every((h) => distToPolyline(p, h.routing) > m && dist(p, h.tee) > m + 4 && dist(p, h.pin) > m + 6) &&
  props.every((q) => dist(p, q.at) > 9) && dist(p, H[8].pin) > 20;
const TREES = ['nature/tree_oak.glb', 'nature/tree_default.glb', 'nature/tree_pineRoundA.glb', 'nature/tree_fat.glb'];
for (let n = 0, tries = 0; n < 70 && tries < 5000; tries++) {
  const p: Vec2 = [R(minX + 10, maxX - 10), R(minY + 10, maxY - 10)];
  if (!clear(p, 14) || trees.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < 9)) continue;
  tree(pick(TREES), p, R(7, 10));
  n++;
}
// A few trees close to fairways, so lines have to be shaped.
for (const h of H) for (const f of [0.3, 0.7]) {
  const p = along(h, f, (rng() < 0.5 ? -1 : 1) * R(9, 12));
  if (clear(p, 8)) tree(pick(TREES), p, R(7, 9));
}
// Flags at the tees, flowers and bushes for color.
for (const h of H) {
  const a = heading(h);
  decor(pick(['minigolf/flag-large-red.glb', 'minigolf/flag-large-blue.glb']), [h.tee[0] - Math.sin(a) * 4, h.tee[1] + Math.cos(a) * 4], 5, a);
  for (let k = 0; k < 6; k++) {
    const p: Vec2 = [h.tee[0] + R(-8, 8), h.tee[1] + R(-8, 8)];
    if (distToPolyline(p, h.routing) > 4 && dist(p, h.tee) > 4) decor(pick(['nature/flower_redA.glb', 'nature/flower_yellowA.glb', 'nature/flower_purpleA.glb']), p, R(6, 9));
  }
}
for (let n = 0, tries = 0; n < 40 && tries < 3000; tries++) {
  const p: Vec2 = [R(minX + 5, maxX - 5), R(minY + 5, maxY - 5)];
  if (clear(p, 8)) { decor(pick(['nature/plant_bushLarge.glb', 'nature/stump_round.glb', 'nature/flower_redA.glb']), p, R(8, 14)); n++; }
}

const course: DiscCourseFile = {
  sport: 'disc',
  style: 'vector',
  branch_density: 0.4,
  name: 'Mini Golf Madness',
  source: { osm_timestamp: 'n/a (hand-designed)', course_osm_id: 'none', attribution: ['Models: Kenney (kenney.nl), CC0: Minigolf Kit, Cube Pets, Nature Kit'] },
  origin: { lat: 0, lon: 0 },
  imagery_offset_m: [0, 0],
  bounds: [[minX - 20, minY - 20], [maxX + 20, maxY + 20]],
  boundary,
  features,
  canopy: [],
  ob: [],
  trees: encodeTrees(trees),
  holes,
  props,
  palette: { outside: '#4f8f45', rough: '#86d16a', fairway: '#2fb24c', path: '#f2dfa7', water: '#3fb8f0', tee: '#e2504f' },
  sky: '#9fd8ff',
};
writeFileSync('public/courses/silly.json', courseJson(course));
console.log(`Mini Golf Madness: ${holes.length} holes (${holes.map((h) => `${h.ref}:${Math.round(h.length_m)}m p${h.par}`).join(' ')}), ${props.length} props, ${trees.length} trees`);
