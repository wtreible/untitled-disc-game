// Roguelike per-player course changes (pure; no rendering). Two kinds:
//  - personal: only the owner plays and sees them (Forward Tee, Short Pin, Clear-Cut, The Bucket…)
//  - hexes: every other player plays and sees them, never the owner (Sapling, Thicket, Pond Prank…)
// Placed things last one hole.
import type { DiscHole, Tree } from '../course/disc-types';
import { dist, distToPolyline, polylineLength, type Vec2 } from '../course/geo';
import { backTeeFor, type Mods } from '../disc/mods';

export interface PlacedTree { tree: Tree; owner: number }
export interface Pond { c: Vec2; r: number; owner: number }

export interface HoleChanges {
  trees: PlacedTree[];
  ponds: Pond[];
  /** Per player: base trees removed for them only (Clear-Cut). */
  cleared: Set<Tree>[];
}

export const POND_RADIUS = 3.5;

export function emptyChanges(players: number): HoleChanges {
  return { trees: [], ponds: [], cleared: Array.from({ length: players }, () => new Set<Tree>()) };
}

/** Players on one side: everyone alone, or (best shot) by team. A hex spares its owner's side. */
export type TeamOf = (p: number) => number;
const alone: TeamOf = (p) => p;

/** Trees player p's throws interact with (and p sees): not hex trees their own side planted. */
export function treesFor(base: Tree[], removed: Set<Tree>, ch: HoleChanges, p: number, teamOf: TeamOf = alone): Tree[] {
  const cleared = ch.cleared[p];
  return [
    ...base.filter((t) => !removed.has(t) && !cleared.has(t)),
    ...ch.trees.filter((t) => teamOf(t.owner) !== teamOf(p)).map((t) => t.tree),
  ];
}

export function pondsFor(ch: HoleChanges, p: number, teamOf: TeamOf = alone): Pond[] {
  return ch.ponds.filter((q) => teamOf(q.owner) !== teamOf(p));
}

/** Point along a polyline at arc length s (clamped). */
export function pointAt(line: Vec2[], s: number): Vec2 {
  let left = Math.max(0, s);
  for (let i = 1; i < line.length; i++) {
    const L = dist(line[i - 1], line[i]);
    if (left <= L || i === line.length - 1) {
      const t = L > 0 ? Math.min(1, left / L) : 0;
      return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
    }
    left -= L;
  }
  return line[0];
}

/**
 * Player p's tee: the hole's tee moved forward along the hole line by their Forward Tee, and back
 * (behind the pad, away from the first leg) by opponents' Back Tees. Forward is capped at 40% of
 * the hole. Falls back to the real tee if the moved spot is blocked (OB/water).
 */
export function teeFor(h: DiscHole, all: Mods[], p: number, blocked: (q: Vec2) => boolean = () => false, teamOf: TeamOf = alone): Vec2 {
  const L = polylineLength(h.routing);
  const fwd = Math.min(all[p].teeForward, L * 0.4);
  const back = backTeeFor(all, p, teamOf);
  let q: Vec2 = fwd > 0 ? pointAt(h.routing, fwd) : h.tee;
  if (back > 0) {
    const [a, b] = [h.routing[0], h.routing[1] ?? h.pin];
    const d = dist(a, b) || 1;
    q = [q[0] - ((b[0] - a[0]) / d) * back, q[1] - ((b[1] - a[1]) / d) * back];
  }
  return blocked(q) ? h.tee : q;
}

/** Player p's basket: moved toward the tee along the hole line by their Short Pin fraction. */
export function pinFor(h: DiscHole, m: Mods): Vec2 {
  if (m.pinCloser <= 0) return h.pin;
  const L = polylineLength(h.routing);
  return pointAt(h.routing, L * (1 - Math.min(0.5, m.pinCloser)));
}

export type PlaceKind = 'sapling' | 'thicket' | 'pond' | 'clear-cut';

export const PLACE_TEXT: Record<PlaceKind, string> = {
  sapling: 'plant a sapling 4–15 m from the basket. Opponents see and hit it; you never do.',
  thicket: 'plant a tree anywhere on the hole. Opponents see and hit it; you never do.',
  pond: 'drop a pond on the hole. For opponents it is water (+1); you never see it.',
  'clear-cut': 'pick a tree on this hole to remove, for you only.',
};

export type Placement =
  | { ok: true; kind: 'sapling' | 'thicket'; tree: Tree }
  | { ok: true; kind: 'pond'; pond: Omit<Pond, 'owner'> }
  | { ok: true; kind: 'clear-cut'; target: Tree }
  | { ok: false; reason: string };

export interface PlaceContext {
  hole: DiscHole;
  /** OB / water / existing course surface check. */
  blocked: (q: Vec2) => boolean;
  /** Trees the placer currently plays with (for Clear-Cut). */
  trees: Tree[];
  rng: () => number;
}

/** Check a click for a placement and build the object. Hexes can't block the tee or sit on the basket. */
export function place(kind: PlaceKind, at: Vec2, c: PlaceContext): Placement {
  const { hole: h } = c;
  const R = (a: number, b: number) => a + c.rng() * (b - a);
  const nearLine = distToPolyline(at, h.routing);
  const dTee = dist(at, h.tee);
  const dPin = dist(at, h.pin);
  if (kind === 'clear-cut') {
    let best: Tree | null = null, bd = 4;
    for (const t of c.trees) {
      const d = Math.hypot(t.x - at[0], t.y - at[1]);
      if (d < bd && distToPolyline([t.x, t.y], h.routing) < 60) { bd = d; best = t; }
    }
    return best ? { ok: true, kind, target: best } : { ok: false, reason: 'Click on a tree near this hole.' };
  }
  if (c.blocked(at)) return { ok: false, reason: 'Not on OB or water.' };
  if (dTee < 6) return { ok: false, reason: 'Too close to the tee.' };
  if (kind === 'sapling') {
    if (dPin < 4 || dPin > 15) return { ok: false, reason: 'Saplings go 4–15 m from the basket.' };
    const height = R(5, 8);
    return { ok: true, kind, tree: { x: at[0], y: at[1], h: height, r: R(2.3, 3.0), b: R(0.3, 0.6), t: 0.15 } };
  }
  if (nearLine > 40) return { ok: false, reason: 'Must be within 40 m of the hole line.' };
  if (kind === 'thicket') {
    if (dPin < 3) return { ok: false, reason: 'Too close to the basket.' };
    const height = R(8, 15);
    return { ok: true, kind, tree: { x: at[0], y: at[1], h: height, r: R(2, 3), b: R(1, 3), t: 0.12 + 0.015 * height } };
  }
  if (dPin < 6) return { ok: false, reason: 'Too close to the basket.' };
  return { ok: true, kind, pond: { c: at, r: POND_RADIUS } };
}

/** Placement steps before a hole: [player, kind] for each charge owned. */
export function placementQueue(all: Mods[]): { player: number; kind: PlaceKind }[] {
  const out: { player: number; kind: PlaceKind }[] = [];
  all.forEach((m, player) => {
    for (let i = 0; i < m.clearCut; i++) out.push({ player, kind: 'clear-cut' });
    if (all.length < 2) return; // hexes need an opponent
    for (let i = 0; i < m.hexSapling; i++) out.push({ player, kind: 'sapling' });
    for (let i = 0; i < m.hexThicket; i++) out.push({ player, kind: 'thicket' });
    for (let i = 0; i < m.hexPond; i++) out.push({ player, kind: 'pond' });
  });
  return out;
}
