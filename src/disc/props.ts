// Prop colliders for themed courses (docs/12-mini-golf-madness.md): giant windmill, castle,
// animals, golf balls… Colliders are precomputed in world space at build time, so physics never
// depends on loading the 3D models.
import type { Vec2 } from '../course/geo';
import type { Vec3 } from '../game/terrain';
import { DISC_RADIUS } from './discs';

export type Collider =
  /** Vertical-axis oriented box: center, yaw, half extents along its local x / y, height range. */
  | { kind: 'box'; c: Vec2; yaw: number; hx: number; hy: number; z0: number; z1: number; tag?: string }
  /** Vertical cylinder. */
  | { kind: 'cyl'; c: Vec2; r: number; z0: number; z1: number; tag?: string }
  /**
   * Four windmill blades spinning in a vertical plane. `yaw` orients the plane (its normal is the
   * local forward axis). Arm i points at angle π/4 + i·π/2 + phase + omega·t, measured in the
   * plane from local x toward up.
   */
  | { kind: 'blades'; hub: Vec3; yaw: number; radius: number; halfWidth: number; halfThick: number; omega: number; phase: number; tag?: string }
  /**
   * A drawbridge: a plank hinged along a horizontal axis on the ground at c, the axis along local x
   * (angle yaw). Up (angle 0) it stands across the gate; down (π/2) it lies flat along local +y.
   * `hx` half its width, `len` its length from the hinge, `halfThick` half its thickness.
   */
  | { kind: 'hinge'; c: Vec2; yaw: number; hx: number; len: number; halfThick: number; swing: Swing; tag?: string }
  /** Static colliders (boxes, cylinders) that slide back and forth together: a ring sweeping across the road. */
  | { kind: 'slide'; parts: Collider[]; slide: Slide; tag?: string };

/**
 * A drawbridge's schedule: each period it is up, lowers over `move` of the period, is down, and
 * raises again over `move`. `phase` shifts the cycle (a fraction of the period).
 */
export interface Swing { period: number; phase: number; move: number }

/** A slider's schedule: offset = amp · sin(2π (t / period + phase)). */
export interface Slide { amp: Vec2; period: number; phase: number }

const ease = (x: number) => x * x * (3 - 2 * x);

/** Drawbridge angle (0 up … π/2 down) at absolute time t (s). The renderer uses the same clock. */
export function hingeAngle(w: Swing, t: number): number {
  const u = (((t / w.period + w.phase) % 1) + 1) % 1;
  const hold = 0.5 - w.move;
  if (u < hold) return 0;
  if (u < 0.5) return (Math.PI / 2) * ease((u - hold) / w.move);
  if (u < 0.5 + hold) return Math.PI / 2;
  return (Math.PI / 2) * (1 - ease((u - 0.5 - hold) / w.move));
}

/** Slider offset (m) at absolute time t (s). */
export function slideOffset(m: Slide, t: number): Vec2 {
  const k = Math.sin(2 * Math.PI * (t / m.period + m.phase));
  return [m.amp[0] * k, m.amp[1] * k];
}

/** Blade rotation (rad) at absolute time t (s). The renderer uses the same clock. */
export function bladeAngle(c: Extract<Collider, { kind: 'blades' }>, t: number): number {
  return c.phase + c.omega * t;
}

const RESTITUTION = 0.35;
const KEEP = 0.55;

/**
 * Resolve contact between the disc (point p, velocity v; both mutated) and the colliders at
 * absolute time t. Returns the tag of the collider hit, or null. `prev` is the previous position
 * (which side of a blade the disc came from).
 */
export function collideProps(p: Vec3, v: Vec3, prev: Vec3, t: number, colliders: Collider[]): string | null {
  const R = DISC_RADIUS;
  for (const c of colliders) {
    if (c.kind === 'cyl') {
      if (p[2] < c.z0 - R || p[2] > c.z1 + R) continue;
      const dx = p[0] - c.c[0], dy = p[1] - c.c[1];
      const d = Math.hypot(dx, dy);
      if (d >= c.r + R) continue;
      const nx = d > 1e-6 ? dx / d : -Math.sign(v[0] || 1), ny = d > 1e-6 ? dy / d : 0;
      p[0] = c.c[0] + nx * (c.r + R + 0.005);
      p[1] = c.c[1] + ny * (c.r + R + 0.005);
      bounce(v, nx, ny);
      return c.tag ?? 'prop';
    }
    if (c.kind === 'box') {
      if (p[2] < c.z0 - R || p[2] > c.z1 + R) continue;
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      const dx = p[0] - c.c[0], dy = p[1] - c.c[1];
      const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
      const px = c.hx + R - Math.abs(lx), py = c.hy + R - Math.abs(ly);
      if (px <= 0 || py <= 0) continue;
      // Push out through the nearest face (no landing on roofs: discs slide off), but not into a
      // neighboring collider: wall tiles and hedge segments touch, and pushing a disc back and
      // forth across a seam trapped it in the air.
      const sx = Math.sign(lx) || 1, sy = Math.sign(ly) || 1;
      const faces: [number, number, number][] = [[sx, 0, px], [0, sy, py], [-sx, 0, 2 * (c.hx + R) - px], [0, -sy, 2 * (c.hy + R) - py]];
      faces.sort((a, b) => a[2] - b[2]);
      const out = ([fx, fy, d]: [number, number, number]): Vec3 => [p[0] + (fx * cs - fy * sn) * (d + 0.005), p[1] + (fx * sn + fy * cs) * (d + 0.005), p[2]];
      const face = faces.find((f) => !colliders.some((o) => o !== c && insideSolid(out(f), o))) ?? faces[0];
      const q = out(face);
      p[0] = q[0]; p[1] = q[1];
      bounce(v, face[0] * cs - face[1] * sn, face[0] * sn + face[1] * cs);
      return c.tag ?? 'prop';
    }
    if (c.kind === 'hinge') {
      if (collideHinge(p, v, prev, t, c)) return c.tag ?? 'drawbridge';
      continue;
    }
    if (c.kind === 'slide') {
      // In the slider's frame the parts are still: move the disc into it, collide, move it back,
      // and give it the slider's velocity if it was hit.
      const o = slideOffset(c.slide, t);
      const dt = 1e-3, o2 = slideOffset(c.slide, t + dt);
      const gv: Vec3 = [(o2[0] - o[0]) / dt, (o2[1] - o[1]) / dt, 0];
      const q: Vec3 = [p[0] - o[0], p[1] - o[1], p[2]];
      const qv: Vec3 = [v[0] - gv[0], v[1] - gv[1], v[2]];
      const tag = collideProps(q, qv, [prev[0] - o[0], prev[1] - o[1], prev[2]], t, c.parts);
      if (!tag) continue;
      p[0] = q[0] + o[0]; p[1] = q[1] + o[1]; p[2] = q[2];
      v[0] = qv[0] + gv[0]; v[1] = qv[1] + gv[1]; v[2] = qv[2];
      return c.tag ?? tag;
    }
    // Blades.
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const X: Vec2 = [cs, sn]; // local right
    const Y: Vec2 = [-sn, cs]; // local forward = blade plane normal
    const rel = (q: Vec3) => {
      const dx = q[0] - c.hub[0], dy = q[1] - c.hub[1];
      return { lx: dx * X[0] + dy * X[1], ly: dx * Y[0] + dy * Y[1], lz: q[2] - c.hub[2] };
    };
    const { lx, ly, lz } = rel(p);
    if (Math.abs(ly) >= c.halfThick + R) continue;
    const rho = Math.hypot(lx, lz);
    if (rho >= c.radius + R) continue;
    const phi = Math.atan2(lz, lx);
    const a = bladeAngle(c, t);
    let hit = false;
    for (let i = 0; i < 4 && !hit; i++) {
      const th = Math.PI / 4 + (i * Math.PI) / 2 + a;
      const dlt = Math.atan2(Math.sin(phi - th), Math.cos(phi - th));
      if (Math.cos(dlt) > 0 && rho * Math.abs(Math.sin(dlt)) < c.halfWidth + R) hit = true;
    }
    if (!hit) continue;
    // Which face: the side the disc came from.
    const side = Math.sign(rel(prev).ly) || 1;
    const push = side * (c.halfThick + R + 0.01) - ly;
    p[0] += Y[0] * push; p[1] += Y[1] * push;
    const vn = v[0] * Y[0] + v[1] * Y[1];
    if (vn * side < 0) { v[0] -= (1 + RESTITUTION) * vn * Y[0]; v[1] -= (1 + RESTITUTION) * vn * Y[1]; }
    v[0] *= KEEP; v[1] *= KEEP; v[2] *= KEEP;
    // The blade swats: add most of the blade's own velocity at the contact point (ω × r, in-plane).
    const w = c.omega;
    const bx = -lz * w, bz = lx * w; // in-plane (x, up)
    v[0] += 0.8 * bx * X[0]; v[1] += 0.8 * bx * X[1]; v[2] += 0.8 * bz;
    return c.tag ?? 'windmill';
  }
  return null;
}

/** Drawbridge contact (mutates p, v). Lowered flat it's a road over the gap: no contact. */
function collideHinge(p: Vec3, v: Vec3, prev: Vec3, t: number, c: Extract<Collider, { kind: 'hinge' }>): boolean {
  const R = DISC_RADIUS;
  const th = hingeAngle(c.swing, t);
  if (th > 1.48) return false;
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const X: Vec2 = [cs, sn], Y: Vec2 = [-sn, cs]; // along the hinge; outward (where it falls)
  const local = (q: Vec3) => {
    const dx = q[0] - c.c[0], dy = q[1] - c.c[1];
    const lx = dx * X[0] + dy * X[1], ly = dx * Y[0] + dy * Y[1], lz = q[2];
    // s: along the plank from the hinge; n: off its face (+ outward / up side).
    return { lx, s: ly * Math.sin(th) + lz * Math.cos(th), n: ly * Math.cos(th) - lz * Math.sin(th) };
  };
  const { lx, s, n } = local(p);
  if (Math.abs(lx) >= c.hx + R || s < -R || s > c.len + R || Math.abs(n) >= c.halfThick + R) return false;
  // Face normal in the world, and push out to the side the disc came from.
  const N: Vec3 = [Math.cos(th) * Y[0], Math.cos(th) * Y[1], -Math.sin(th)];
  const side = Math.sign(local(prev).n) || 1;
  const k = side * (c.halfThick + R + 0.01) - n;
  p[0] += N[0] * k; p[1] += N[1] * k; p[2] += N[2] * k;
  const vn = v[0] * N[0] + v[1] * N[1] + v[2] * N[2];
  if (vn * side < 0) for (let i = 0; i < 3; i++) v[i] -= (1 + RESTITUTION) * vn * N[i];
  v[0] *= KEEP; v[1] *= KEEP; v[2] *= KEEP;
  // A moving plank shoves: its surface moves along N at (dθ/dt) · s.
  const rate = (hingeAngle(c.swing, t + 1e-3) - th) / 1e-3;
  for (let i = 0; i < 3; i++) v[i] += 0.8 * rate * Math.max(0, s) * N[i];
  return true;
}

/** Where a collider can be: center and radius on the ground (movers include their whole sweep). */
function footprint(c: Collider): [number, number, number][] {
  if (c.kind === 'cyl') return [[c.c[0], c.c[1], c.r]];
  if (c.kind === 'box') return [[c.c[0], c.c[1], Math.hypot(c.hx, c.hy)]];
  if (c.kind === 'blades') return [[c.hub[0], c.hub[1], c.radius + c.halfThick]];
  if (c.kind === 'hinge') return [[c.c[0], c.c[1], Math.hypot(c.hx, c.len)]];
  const a = Math.hypot(c.slide.amp[0], c.slide.amp[1]);
  return c.parts.flatMap(footprint).map(([x, y, r]): [number, number, number] => [x, y, r + a]);
}

/**
 * Colliders that might touch a disc at (x, y): a 4 m grid over the course, each collider listed in
 * every cell its footprint (plus a margin) covers. Built once per collider list. Shape-traced props
 * have hundreds of boxes, so checking all of them every physics step got slow.
 */
const INDEX_CELL = 4;
const indexCache = new WeakMap<Collider[], Map<number, Collider[]>>();
const NONE: Collider[] = [];
export function nearColliders(all: Collider[], x: number, y: number): Collider[] {
  let grid = indexCache.get(all);
  if (!grid) {
    grid = new Map();
    for (const c of all) {
      for (const [cx, cy, r] of footprint(c)) {
        const m = r + 1; // margin: the disc and a step's travel
        for (let i = Math.floor((cx - m) / INDEX_CELL); i <= Math.floor((cx + m) / INDEX_CELL); i++) {
          for (let j = Math.floor((cy - m) / INDEX_CELL); j <= Math.floor((cy + m) / INDEX_CELL); j++) {
            const k = i * 100003 + j;
            const list = grid.get(k);
            if (!list) grid.set(k, [c]);
            else if (list[list.length - 1] !== c) list.push(c); // a slider's parts share cells
          }
        }
      }
    }
    indexCache.set(all, grid);
  }
  return grid.get(Math.floor(x / INDEX_CELL) * 100003 + Math.floor(y / INDEX_CELL)) ?? NONE;
}

/** Does the disc overlap a static collider? (Moving ones don't count.) */
function insideSolid(p: Vec3, c: Collider): boolean {
  const R = DISC_RADIUS;
  if (c.kind === 'blades' || c.kind === 'hinge' || c.kind === 'slide' || p[2] < c.z0 - R || p[2] > c.z1 + R) return false;
  const dx = p[0] - c.c[0], dy = p[1] - c.c[1];
  if (c.kind === 'cyl') return Math.hypot(dx, dy) < c.r + R;
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  return Math.abs(dx * cs + dy * sn) < c.hx + R && Math.abs(-dx * sn + dy * cs) < c.hy + R;
}

function bounce(v: Vec3, nx: number, ny: number): void {
  const vn = v[0] * nx + v[1] * ny;
  if (vn < 0) { v[0] -= (1 + RESTITUTION) * vn * nx; v[1] -= (1 + RESTITUTION) * vn * ny; }
  v[0] *= KEEP; v[1] *= KEEP; v[2] *= KEEP;
}

/**
 * Windmill colliders for Kenney's structure-windmill at `scale`, placed at c facing `yaw`
 * (local forward = toward the blades). Measured from the model: depth ±0.4; full width ±0.4 up to
 * 0.233 with an arched tunnel |x| < 0.15 up to 0.14 through it; then the tower tapers linearly to
 * ±0.24 at 0.906; gabled roof to 1.118. Blade hub 0.893 up and 0.446 forward, radius 0.6, arm
 * half-width ~0.11, half-thickness 0.046. The taper is stacked slices, each as wide as its bottom.
 */
export function windmillColliders(c: Vec2, yaw: number, s: number, omega: number, phase: number): Collider[] {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const at = (lx: number, ly: number): Vec2 => [c[0] + lx * cs - ly * sn, c[1] + lx * sn + ly * cs];
  const tag = 'windmill';
  const box = (hx: number, z0: number, z1: number, lx = 0): Collider => ({ kind: 'box', c: at(lx * s, 0), yaw, hx: hx * s, hy: 0.4 * s, z0: z0 * s, z1: z1 * s, tag });
  const width = (y: number) => 0.4 - ((y - 0.233) / (0.906 - 0.233)) * (0.4 - 0.24);
  const slices: Collider[] = [];
  const ys = [0.233, 0.46, 0.69, 0.906];
  for (let i = 1; i < ys.length; i++) slices.push(box(width(ys[i - 1]), ys[i - 1], ys[i]));
  return [
    // Tunnel level: two walls and the lintel above the arch (kept first: tests read these).
    box(0.125, 0, 0.233, -0.275),
    box(0.125, 0, 0.233, 0.275),
    box(0.15, 0.14, 0.233),
    ...slices,
    // Gabled roof: wide eaves, then the ridge.
    box(0.27, 0.906, 1.0),
    box(0.13, 1.0, 1.118),
    { kind: 'blades', hub: [...at(0, 0.446 * s), 0.893 * s], yaw, radius: 0.6 * s, halfWidth: 0.11 * s, halfThick: 0.046 * s, omega, phase, tag: 'blades' },
  ];
}

/** Kenney's castle stands on its own tile, whose top (the gate floor) is 0.063 up: sink it by that. */
export const CASTLE_SINK = 0.063;

/**
 * Castle colliders for Kenney's castle at `scale`, sunk by CASTLE_SINK so the gate floor is at
 * ground level (place the model with lift = −CASTLE_SINK·scale). Measured: towers |x| 0.15–0.46,
 * |z| < 0.155, up to 0.651; gate arch |x| < 0.15, straight to 0.155 then arched to 0.288 (the
 * lintel collider starts at 0.2); side rails |x| 0.45–0.5 along the full depth, up to 0.147.
 */
export function castleColliders(c: Vec2, yaw: number, s: number): Collider[] {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const at = (lx: number, ly: number): Vec2 => [c[0] + lx * cs - ly * sn, c[1] + lx * sn + ly * cs];
  const tag = 'castle';
  const z = (y: number) => (y - CASTLE_SINK) * s;
  return [
    { kind: 'box', c: at(-0.304 * s, 0), yaw, hx: 0.154 * s, hy: 0.155 * s, z0: 0, z1: z(0.651), tag },
    { kind: 'box', c: at(0.304 * s, 0), yaw, hx: 0.154 * s, hy: 0.155 * s, z0: 0, z1: z(0.651), tag },
    { kind: 'box', c: at(0, 0), yaw, hx: 0.15 * s, hy: 0.125 * s, z0: z(0.2), z1: z(0.5), tag },
    { kind: 'box', c: at(-0.475 * s, 0), yaw, hx: 0.025 * s, hy: 0.5 * s, z0: 0, z1: z(0.147), tag },
    { kind: 'box', c: at(0.475 * s, 0), yaw, hx: 0.025 * s, hy: 0.5 * s, z0: 0, z1: z(0.147), tag },
  ];
}
