// The event-driven round (src/modes/discRound.ts): replaying the log, as JSON, rebuilds the round.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTrees, type DiscCourseFile } from '../src/course/disc-types';
import { dist, type Vec2 } from '../src/course/geo';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { DiscRound, type RoundEvent, type RoundOptions } from '../src/modes/discRound';
import { place, pondsFor, treesFor } from '../src/rogue/course';

const course: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali-simple.json', 'utf8'));
const trees = decodeTrees(course.trees);
const grid = SurfaceGrid.fromHole({ bounds: course.bounds, boundary: course.boundary, features: course.features, ob: course.ob, trees: [] }, 1);
const blocked = (q: Vec2) => { const c = grid.classAt(q[0], q[1]); return c === 'oob' || c === 'water'; };
const index = new TreeIndex(trees);

/** The parts of a round players see: positions, strokes, scores, augments, course changes. */
const snapshot = (r: DiscRound) => JSON.stringify({
  index: r.round.index, current: r.game.current, scores: r.round.scores,
  players: r.game.players.map((p) => ({ ball: p.ball, lie: p.lie, strokes: p.strokes, holed: p.holed, pickedUp: p.pickedUp })),
  owned: r.owned, mulligans: r.mulligansLeft, perfect: r.perfectLeft, wind: r.wind, version: r.version,
  removed: r.removed.size, placed: r.changes.trees.length, ponds: r.changes.ponds.length, cleared: r.changes.cleared.map((c) => c.size),
  mods: r.mods,
});

/** Play the current player's turn the way the game does: simulate, wire, apply (through JSON). */
function throwTurn(r: DiscRound, seed: number): RoundEvent {
  const i = r.game.current;
  const p = r.game.players[i];
  const pin = r.game.pins[i];
  const w: DiscWorld = {
    grid, terrain: new FlatTerrain(), basket: pin, branchDensity: course.branch_density, wind: r.wind,
    trees: r.version === 0 && r.changes.trees.length === 0 && r.removed.size === 0 ? index : new TreeIndex(treesFor(trees, r.removed, r.changes, i)),
    hazards: pondsFor(r.changes, i),
  };
  const d = dist(p.ball, pin);
  const disc = d < 20 ? PUTTER_DISC : DISCS[1];
  const result = simulateThrow({ start: p.ball, aim: Math.atan2(pin[1] - p.ball[1], pin[0] - p.ball[0]), power: Math.min(1, d / 90 + 0.15), disc, hyzer: 0, style: d < 20 ? 'putt' : 'drive' }, w, mulberry32(seed));
  const e: RoundEvent = { t: 'throw', player: i, perfect: false, result: r.wire(result) };
  r.apply(JSON.parse(JSON.stringify(e)));
  return e;
}

const playHole = (r: DiscRound, seed: number) => { for (let k = 0; k < 40 && !r.game.finished; k++) throwTurn(r, seed * 100 + k); };
const replayed = (r: DiscRound, opts: RoundOptions) => DiscRound.replay(course.holes, trees, opts, blocked, JSON.parse(JSON.stringify(r.log)));

describe('event-driven round', () => {
  it('hot seat: three holes from events; replaying the JSON log rebuilds the same round', () => {
    const opts: RoundOptions = { names: ['A', 'B'], first: 0, count: 3, rogue: false };
    const r = new DiscRound(course.holes, trees, opts, blocked);
    for (let h = 0; h < 3; h++) {
      r.apply({ t: 'hole-start', wind: [h * 0.7, -1] });
      expect(r.round.index).toBe(h);
      playHole(r, h + 1);
      expect(r.game.finished).toBe(true);
    }
    // Every hole is on the card, for both players.
    for (const s of r.round.scores) expect(s.slice(0, 3).every((v) => typeof v === 'number' && v > 0)).toBe(true);
    expect(snapshot(replayed(r, opts))).toBe(snapshot(r));
  });

  it('Crazy mode: drafts, rerolls, placements, Lumberjack and a mulligan replay the same too', () => {
    const opts: RoundOptions = { names: ['A', 'B'], first: 0, count: 2, rogue: true };
    const r = new DiscRound(course.holes, trees, opts, blocked);
    const ap = (e: RoundEvent) => r.apply(JSON.parse(JSON.stringify(e)));
    ap({ t: 'grant', player: 0, id: 'lumberjack' });
    ap({ t: 'offer', player: 0, tier: 'epic', cards: ['mulligan', 'clear-cut'], bumped: null, starter: true });
    expect(r.offer?.player).toBe(0);
    ap({ t: 'pick', player: 0, id: 'mulligan' });
    expect(r.offer).toBeNull();
    ap({ t: 'grant', player: 1, id: 'reroll-token' });
    ap({ t: 'reroll', player: 1 });
    ap({ t: 'offer', player: 1, tier: 'common', cards: ['sapling', 'reroll-token'], bumped: null, starter: true });
    ap({ t: 'pick', player: 1, id: 'sapling' });
    ap({ t: 'grant', player: 1, id: 'clear-cut' });
    expect(r.mods[1].rerolls).toBe(2); // Reroll Token: +3, one spent

    ap({ t: 'hole-start', wind: [2, 0] });
    // B: a clear-cut (personal) then a sapling (hex on A), in queue order.
    expect(r.placing.map((s) => `${s.player}:${s.kind}`)).toEqual(['1:clear-cut', '1:sapling']);
    const h = r.hole;
    const near = trees.reduce((a, b) => (dist([b.x, b.y], h.tee) < dist([a.x, a.y], h.tee) && dist([b.x, b.y], h.tee) > 8 ? b : a));
    const cut = place('clear-cut', [near.x, near.y], { hole: h, blocked, trees: treesFor(trees, r.removed, r.changes, 1), rng: () => 0.5 });
    expect(cut.ok).toBe(true);
    if (cut.ok && cut.kind === 'clear-cut') ap({ t: 'place', player: 1, kind: 'clear-cut', target: r.refOf(cut.target) });
    const toward = (f: number): Vec2 => [h.pin[0] + (h.tee[0] - h.pin[0]) * f, h.pin[1] + (h.tee[1] - h.pin[1]) * f];
    const at = toward(8 / dist(h.tee, h.pin));
    const sap = place('sapling', at, { hole: h, blocked, trees: [], rng: () => 0.5 });
    expect(sap.ok).toBe(true);
    if (sap.ok && sap.kind === 'sapling') ap({ t: 'place', player: 1, kind: 'sapling', tree: sap.tree });
    expect(r.placing).toEqual([]);
    expect(r.changes.cleared[1].size).toBe(1);
    expect(r.changes.trees.length).toBe(1);

    // A throws, takes it back (Mulligan), throws again.
    expect(r.mulligansLeft[0]).toBe(1);
    const before = JSON.stringify(r.game.players[0]);
    throwTurn(r, 7);
    ap({ t: 'mulligan', player: 0 });
    expect(JSON.stringify(r.game.players[0])).toBe(before);
    expect(r.mulligansLeft[0]).toBe(0);
    playHole(r, 3);
    ap({ t: 'hole-start', wind: [0, 3] });
    playHole(r, 4);
    expect(r.game.finished).toBe(true);
    expect(snapshot(replayed(r, opts))).toBe(snapshot(r));
  });

  it('a throw that hits trees, by a Lumberjack, cuts them down: on replay too', () => {
    const opts: RoundOptions = { names: ['A'], first: 2, count: 1, rogue: true };
    const r = new DiscRound(course.holes, trees, opts, blocked);
    r.apply({ t: 'grant', player: 0, id: 'lumberjack' });
    r.apply({ t: 'hole-start', wind: [0, 0] });
    // Aim well off the line into the woods until some throw touches a tree.
    const p = r.game.players[0];
    const pin = r.game.pins[0];
    let hit = false;
    for (let k = 0; k < 30 && !hit; k++) {
      const aim = Math.atan2(pin[1] - p.ball[1], pin[0] - p.ball[0]) + (k % 2 ? 1 : -1) * (0.3 + 0.05 * k);
      const w: DiscWorld = { grid, terrain: new FlatTerrain(), basket: pin, trees: new TreeIndex(treesFor(trees, r.removed, r.changes, 0)), branchDensity: course.branch_density };
      const res = simulateThrow({ start: r.game.players[0].ball, aim, power: 0.9, disc: DISCS[0], hyzer: 0 }, w, mulberry32(k + 1));
      r.apply(JSON.parse(JSON.stringify({ t: 'throw', player: 0, perfect: false, result: r.wire(res) })));
      hit = res.treesHit.length > 0;
    }
    expect(hit).toBe(true);
    expect(r.removed.size).toBeGreaterThan(0);
    expect(snapshot(replayed(r, opts))).toBe(snapshot(r));
  });
});
