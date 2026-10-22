// "Rainbow Runs": nine holes on a rainbow road floating in space. Off the road is the void (OB),
// there are no guardrails, and the track has mystery boxes, rings to throw through, asteroids and a
// gap to jump. A parody of a certain kart racer's last track; nods only, no borrowed assets.
// CC0 models: Kenney Space Kit. Hand-designed. Writes public/courses/rainbow.json.
//
//   npm run rainbow-course
import { writeFileSync } from 'node:fs';
import type { DiscCourseFile, DiscHole, PropDef } from '../src/course/disc-types';
import { encodeTrees } from '../src/course/disc-types';
import { dist, type Vec2 } from '../src/course/geo';
import type { CourseFeature, Rings } from '../src/course/types';
import type { Collider } from '../src/disc/props';
import { along, courseJson, shapeColliders, heading, headingAt, makeHoles, propKit, rect, silhouetteBoxes, teeMat, type HoleSpec } from './course-kit';

const { R, pick, props, trees } = propKit(4242);

/** Kenney Space Kit models are authored around (2, 0, 1.5), not the origin. */
const SPACE_OFFSET: [number, number, number] = [2, 0, 1.5];
const ROAD_HALF = 8;
const RAINBOW = ['#ff4d6d', '#ff9f43', '#ffe066', '#5ee07a', '#4dabf7', '#7b6cff', '#d36bff'];

const SPEC: HoleSpec[] = [
  { name: 'Lights Out', tee: [0, 0], pin: [0, 118] },
  { name: 'Mystery Box Alley', tee: [30, 140], via: [[70, 158]], pin: [118, 146] },
  { name: 'Ring Road', tee: [150, 126], pin: [150, 22] },
  { name: 'The Chicane', tee: [176, -10], via: [[200, 22], [226, -6]], pin: [252, 26] },
  { name: 'Asteroid Belt', tee: [278, 52], pin: [278, 166] },
  { name: 'Rocket Garage', tee: [252, 200], pin: [180, 252] },
  { name: 'Gap Jump', tee: [150, 272], pin: [58, 250] },
  // Par 3 for the carry straight over the void; the road round the hairpin is the safe way.
  { name: 'Hairpin Galaxy', tee: [22, 230], via: [[-44, 232], [-46, 180]], pin: [12, 176], par: 3 },
  { name: 'Final Lap', tee: [-34, 150], pin: [-34, 30] },
];
const H = makeHoles(SPEC);
/** Hole 7's road stops short of a gap (fractions of the hole). */
const GAP: [number, number] = [0.4, 0.64];

// ---------- the road ----------
/** Corner-cutting smoothing (Chaikin), keeping the end points. */
function smooth(pts: Vec2[], iterations = 4): Vec2[] {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    const out: Vec2[] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [a, b] = [p[i], p[i + 1]];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Densify so ribbons bend smoothly on straight runs too. */
function densify(pts: Vec2[], step = 4): Vec2[] {
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Ribbon polygon between lateral offsets l0 < l1 (left positive) along a smooth center line. */
function ribbon(line: Vec2[], l0: number, l1: number): Vec2[] {
  const normals = line.map((_, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const L = dist(a, b) || 1;
    return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L] as Vec2;
  });
  const side = (l: number) => line.map((p, i): Vec2 => [p[0] + normals[i][0] * l, p[1] + normals[i][1] * l]);
  return [...side(l1), ...side(l0).reverse()];
}

/** Center line of the road for a stretch of hole h (fractions f0..f1), run-ups past tee and basket. */
function roadLine(h: DiscHole, f0 = 0, f1 = 1): Vec2[] {
  const d0 = heading(h), d1 = heading(h, h.routing.length - 2);
  const pts: Vec2[] = [];
  if (f0 === 0) pts.push([h.tee[0] - Math.cos(d0) * 8, h.tee[1] - Math.sin(d0) * 8]);
  // Routing vertices inside [f0, f1], plus the cut points.
  let acc = 0;
  pts.push(along(h, f0));
  for (let i = 1; i < h.routing.length - 1; i++) {
    acc += dist(h.routing[i - 1], h.routing[i]);
    const f = acc / h.length_m;
    if (f > f0 && f < f1) pts.push(h.routing[i]);
  }
  pts.push(along(h, f1));
  if (f1 === 1) pts.push([h.pin[0] + Math.cos(d1) * 12, h.pin[1] + Math.sin(d1) * 12]);
  return densify(smooth(pts), 3);
}

const roads: Vec2[][] = [];
for (const h of H) {
  if (h.ref === '7') roads.push(roadLine(h, 0, GAP[0]), roadLine(h, GAP[1], 1));
  else roads.push(roadLine(h));
}

const boundary: Rings[] = roads.map((l) => [ribbon(l, -ROAD_HALF, ROAD_HALF)]);
const features: CourseFeature[] = roads.map((l, i) => ({ class: 'fairway', osm_id: `road/${i}`, rings: [ribbon(l, -ROAD_HALF, ROAD_HALF)] }));
for (const h of H) features.push({ class: 'tee', osm_id: `tee/${h.ref}`, rings: [teeMat(h)] });

// Stripes, then white edge lines, then checkered start/finish lines on top.
const decals: { color: string; rings: Rings[] }[] = [];
const band = (2 * ROAD_HALF) / RAINBOW.length;
RAINBOW.forEach((color, k) => decals.push({ color, rings: roads.map((l) => [ribbon(l, -ROAD_HALF + k * band, -ROAD_HALF + (k + 1) * band)]) }));
decals.push({ color: '#ffffff', rings: roads.flatMap((l) => [[ribbon(l, -ROAD_HALF, -ROAD_HALF + 0.35)], [ribbon(l, ROAD_HALF - 0.35, ROAD_HALF)]]) });
function checkered(c: Vec2, dir: number, rows = 2): { white: Rings[]; black: Rings[] } {
  const white: Rings[] = [], black: Rings[] = [];
  const sq = 1.2, n = Math.round((2 * ROAD_HALF) / sq);
  const u: Vec2 = [Math.cos(dir), Math.sin(dir)], v: Vec2 = [-u[1], u[0]];
  for (let r = 0; r < rows; r++) for (let k = 0; k < n; k++) {
    const su = (r - rows / 2 + 0.5) * sq, sv = -ROAD_HALF + (k + 0.5) * sq;
    const at: Vec2 = [c[0] + u[0] * su + v[0] * sv, c[1] + u[1] * su + v[1] * sv];
    ((r + k) % 2 ? black : white).push([rect(at, dir, sq / 2, sq / 2)]);
  }
  return { white, black };
}
const lines = [checkered([H[0].tee[0], H[0].tee[1] - 2.5], heading(H[0])), checkered(along(H[8], 0.9), heading(H[8]), 3)];
decals.push({ color: '#f4f4f4', rings: lines.flatMap((l) => l.white) }, { color: '#16161c', rings: lines.flatMap((l) => l.black) });

// ---------- props ----------
const space = (m: string) => `space/${m}.glb`;
/** Space Kit model that collides as its shape (shapeColliders). */
function solid(m: string, at: Vec2, scale: number, o: { yaw?: number; hit: string; tag: string; lift?: number }): PropDef {
  const lift = o.lift ?? 0;
  const yaw = o.yaw ?? R(0, Math.PI * 2);
  const p: PropDef = { model: space(m), at, yaw, scale, offset: SPACE_OFFSET, hit: o.hit, colliders: shapeColliders(space(m), at, yaw, scale, { offset: SPACE_OFFSET, lift, tag: o.tag }) };
  if (lift) p.lift = lift;
  props.push(p);
  return p;
}
function decor(m: string, at: Vec2, scale: number, yaw = R(0, Math.PI * 2), lift = 0): void {
  const p: PropDef = { model: space(m), at, yaw, scale, offset: SPACE_OFFSET, colliders: [] };
  if (lift) p.lift = lift;
  props.push(p);
}
/** A spinning "?" box floating over the road. */
function mysteryBox(at: Vec2, z = 3.2, size = 2.4): void {
  props.push({
    model: 'proc:mystery-box', at, yaw: R(0, Math.PI * 2), scale: size, lift: z, hit: 'Mystery box! (It was empty.)',
    spin: { node: 'box', omega: R(1.2, 1.8), phase: R(0, 6), axis: 'y' },
    colliders: [{ kind: 'cyl', c: at, r: size * 0.6, z0: z, z1: z + size, tag: 'mystery' }],
  });
}
/**
 * A hex ring standing across the road: throw through it. The opening (about 0.28 – 0.88 units up,
 * ±0.32 wide at mid-height) is a hexagon, so the colliders are thin boxes that follow the model's
 * front outline rather than upright posts (posts filled the opening's wide middle).
 */
const RING_BOXES = silhouetteBoxes(space('gate_complex'), SPACE_OFFSET);
function ring(at: Vec2, dir: number, s: number): void {
  const yaw = dir + Math.PI / 2; // ring plane (model X) across the direction of play
  // Sunk into the road to the top of the plinth, so the opening starts about 1 m up.
  const lift = -0.2 * s;
  const X: Vec2 = [Math.cos(yaw), Math.sin(yaw)], Z: Vec2 = [Math.cos(yaw - Math.PI / 2), Math.sin(yaw - Math.PI / 2)]; // model +Z in the world
  const colliders: Collider[] = RING_BOXES.filter((b) => b.y1 * s + lift > 0).map((b) => {
    const xm = ((b.x0 + b.x1) / 2) * s, zm = ((b.z0 + b.z1) / 2) * s;
    return {
      kind: 'box', c: [at[0] + X[0] * xm + Z[0] * zm, at[1] + X[1] * xm + Z[1] * zm], yaw,
      hx: ((b.x1 - b.x0) / 2) * s, hy: ((b.z1 - b.z0) / 2) * s, z0: Math.max(0, b.y0 * s + lift), z1: b.y1 * s + lift, tag: 'ring',
    };
  });
  props.push({ model: space('gate_complex'), at, yaw, scale: s, offset: SPACE_OFFSET, lift, hit: 'Clipped the ring!', colliders });
}
/** Base, two fuel tanks and a nose cone: about 3.4 s tall. */
function rocket(at: Vec2, s: number): void {
  const yaw = R(0, Math.PI * 2);
  let z = 0;
  for (const [m, h] of [['rocket_baseA', 1.6], ['rocket_fuelA', 0.5], ['rocket_fuelA', 0.5], ['rocket_topA', 0.8]] as const) {
    // Each part collides as its own shape (fins and all), at its height in the stack.
    const p: PropDef = { model: space(m), at, yaw, scale: s, offset: SPACE_OFFSET, colliders: shapeColliders(space(m), at, yaw, s, { offset: SPACE_OFFSET, lift: z, tag: 'rocket' }), hit: 'Rocket bonk!' };
    if (z) p.lift = z;
    props.push(p);
    z += h * s;
  }
}
/** Spectators along the road edge, facing it. */
function crowd(h: DiscHole, f0: number, f1: number, side: 1 | -1, n: number): void {
  for (let k = 0; k < n; k++) {
    const f = f0 + ((f1 - f0) * (k + 0.5)) / n;
    const at = along(h, f, side * (ROAD_HALF + 2.5));
    const s = 3.2, m = space(pick(['alien', 'astronautA'])), yaw = headingAt(h, f) + (side > 0 ? 0 : Math.PI);
    props.push({ model: m, at, yaw, scale: s, offset: SPACE_OFFSET, hit: 'Hit a spectator! Sorry!', colliders: shapeColliders(m, at, yaw, s, { offset: SPACE_OFFSET, tag: 'fan' }) });
  }
}

// 1. Lights Out: a straight start with the grid behind the tee and fans along the straight.
crowd(H[0], 0.1, 0.5, 1, 4);
crowd(H[0], 0.1, 0.5, -1, 4);
decor('satelliteDish_large', along(H[0], 0.05, 16), 8, heading(H[0]));
mysteryBox(along(H[0], 0.7, -3));
mysteryBox(along(H[0], 0.7, 3));

// 2. Mystery Box Alley: two rows of boxes with gaps.
for (const lat of [-6, -2, 2, 6]) mysteryBox(along(H[1], 0.38, lat), 3);
for (const lat of [-4, 0, 4]) mysteryBox(along(H[1], 0.72, lat), 4.5);

// 3. Ring Road: three rings on the line.
for (const f of [0.28, 0.5, 0.72]) ring(along(H[2], f), heading(H[2]), 15);

// 4. The Chicane: parked racers on the apexes.
for (const [f, lat] of [[0.33, -5], [0.62, 5], [0.85, -4]] as const) {
  solid(pick(['craft_racer', 'craft_speederA']), along(H[3], f, lat), 3.5, { yaw: headingAt(H[3], f) - Math.PI / 2, hit: 'Rear-ended a racer!', tag: 'racer' });
}

// 5. Asteroid Belt: tumbling rocks at every height, crystals on the shoulders.
for (const [f, lat, z, s] of [[0.25, -3, 0, 5], [0.35, 4, 6, 4], [0.48, -1, 2, 6], [0.58, 5, 9, 4], [0.66, -5, 4, 5], [0.78, 1, 0, 4.5], [0.88, -3, 7, 3.5]] as const) {
  solid('meteor_detailed', along(H[4], f, lat), s, { hit: 'Asteroid strike!', tag: 'asteroid', lift: z });
}
for (const f of [0.2, 0.5, 0.82]) for (const side of [-1, 1]) decor(pick(['rock_crystalsLargeA', 'rock_crystalsLargeB']), along(H[4], f, side * (ROAD_HALF + 3)), 6);

// 6. Rocket Garage: rockets beside the road and one on the line before the basket.
rocket(along(H[5], 0.42, 16), 5);
rocket(along(H[5], 0.55, -15), 5);
rocket(along(H[5], 0.72, 0), 4);
solid('craft_speederA', along(H[5], 0.3, -4.5), 3, { yaw: headingAt(H[5], 0.15) - Math.PI / 2, hit: 'Rear-ended a racer!', tag: 'racer' });

// 7. Gap Jump: a box on each side of the gap; fans watch from the far side.
mysteryBox(along(H[6], GAP[0] - 0.06, 4), 2.5);
mysteryBox(along(H[6], GAP[1] + 0.06, -4), 2.5);
crowd(H[6], GAP[1] + 0.05, GAP[1] + 0.25, 1, 3);
decor('meteor_detailed', along(H[6], (GAP[0] + GAP[1]) / 2, 14), 7, 0, -6);

// 8. Hairpin Galaxy: cut the corner over the void, or take the long way round.
mysteryBox(along(H[7], 0.3), 3); // on the straights (the smoothed road cuts inside the corners)
mysteryBox(along(H[7], 0.75), 3);
decor('satelliteDish_large', [-14, 205], 9, 0);

// 9. Final Lap: a finish ring and a crowd down the home straight.
ring(along(H[8], 0.6), heading(H[8]), 15);
crowd(H[8], 0.7, 0.95, 1, 4);
crowd(H[8], 0.7, 0.95, -1, 4);

// Floating scenery out in the void (no colliders: you can't reach it anyway).
for (let n = 0, tries = 0; n < 26 && tries < 2000; tries++) {
  const p: Vec2 = [R(-120, 380), R(-90, 340)];
  if (roads.some((l) => l.some((q) => dist(p, q) < 30))) continue;
  decor(pick(['meteor_detailed', 'rock_crystalsLargeA', 'meteor_detailed']), p, R(6, 16), R(0, 6), R(-25, 18));
  n++;
}

// ---------- course ----------
const all = roads.flat();
const minX = Math.min(...all.map((p) => p[0])) - 40, maxX = Math.max(...all.map((p) => p[0])) + 40;
const minY = Math.min(...all.map((p) => p[1])) - 40, maxY = Math.max(...all.map((p) => p[1])) + 40;

const course: DiscCourseFile = {
  sport: 'disc',
  style: 'vector',
  branch_density: 0.4,
  name: 'Rainbow Runs',
  source: { osm_timestamp: 'n/a (hand-designed)', course_osm_id: 'none', attribution: ['Models: Kenney Space Kit (kenney.nl), CC0'] },
  origin: { lat: 0, lon: 0 },
  imagery_offset_m: [0, 0],
  bounds: [[minX, minY], [maxX, maxY]],
  boundary,
  features,
  canopy: [],
  ob: [],
  trees: encodeTrees(trees),
  holes: H,
  props,
  decals,
  stars: 1600,
  toasts: { oob: 'Lost in space! +1' },
  palette: { outside: '#07071a', rough: '#2a2550', fairway: '#2a2550', tee: '#ffffff' },
  sky: '#0b0b26',
};
writeFileSync('public/courses/rainbow.json', courseJson(course));
console.log(`Rainbow Runs: ${H.length} holes (${H.map((h) => `${h.ref}:${Math.round(h.length_m)}m p${h.par}`).join(' ')}), ${props.length} props`);
