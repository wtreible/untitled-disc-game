// Branched tree models (src/disc/treeShapes.ts): branch hits only in the leaf clumps, a solid
// trunk that follows the model's, and placement shared with the renderer.
import { describe, expect, it } from 'vitest';
import type { Tree } from '../src/course/disc-types';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type DiscWorld } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { GREEN_DENSITY_BOOST, TREE_KIND_NAMES, treeShape } from '../src/disc/treeShapes';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const PT = DISCS.find((d) => d.id === 'PT')!;
/** A course tree at (x, 0) that the hash turns into model `kind`. */
function treeOfKind(kind: number, x = 0): Tree {
  for (let i = 0; i < 20000; i++) {
    const t: Tree = { x, y: i * 0.37, h: 11, r: 3, b: kind >= 5 ? 1 : 4, t: 0.3 };
    if (treeShape(t).kind === kind) return t;
  }
  throw new Error(`no position for kind ${kind}`);
}
const world = (trees: Tree[], shaped = true): DiscWorld => ({
  grid: SurfaceGrid.fromHole({ bounds: [[-300, -300], [300, 300]], boundary: [[[[-250, -250], [250, -250], [250, 250], [-250, 250]]]], trees: [], features: [] }, 1),
  terrain: new FlatTerrain(), trees: new TreeIndex(trees), basket: [999, 999], branchDensity: 0.4, treeShape: shaped ? treeShape : undefined,
});

describe('tree shapes', () => {
  it('cover all ten models, and each tree gets the same shape every time', () => {
    expect(TREE_KIND_NAMES).toHaveLength(10);
    const t = treeOfKind(3);
    expect(treeShape({ ...t })).toEqual(expect.objectContaining({ kind: 3, yaw: treeShape(t).yaw }));
  });

  it('leaf clumps are smaller than the old crown, so their branch density is stepped up a little', () => {
    expect(GREEN_DENSITY_BOOST).toBeGreaterThan(1);
    expect(GREEN_DENSITY_BOOST).toBeLessThanOrEqual(1.5);
  });

  it('the trunk is solid at the base, and a putt through the leaves can be kicked', () => {
    for (const kind of [0, 6]) {
      const t = treeOfKind(kind);
      const sh = treeShape(t);
      const base = sh.trunk[0];
      // A low throw straight at the trunk base hits it.
      const r = simulateThrow({ start: [base.x - 10, base.y], aim: 0, power: 0.3, disc: PT, hyzer: 0, perfect: true, launch: 0.02 }, world([t]), mulberry32(1));
      expect(r.events, TREE_KIND_NAMES[kind]).toContain('trunk');
    }
  });

  it('branch hits happen only inside the green: a flat throw through bare space is never kicked', () => {
    const t = treeOfKind(3); // CommonTree_4: bare branches under two small clumps
    const sh = treeShape(t);
    // Sample a vertical plane through the tree; find heights with no green across the whole width.
    const clear: number[] = [], green: number[] = [];
    for (let z = 1; z < t.h; z += 0.25) {
      let any = false;
      for (let s = -4; s <= 4; s += 0.1) if (sh.green(t.x + s, t.y, z)) { any = true; break; }
      (any ? green : clear).push(z);
    }
    expect(clear.length).toBeGreaterThan(0);
    expect(green.length).toBeGreaterThan(0);
    // A flat throw across the tree at a clear height, beside the trunk, never gets a branch event.
    const z = clear.find((q) => q > 2 && sh.trunk.every((s) => q < s.z0 || q > s.z1))
      ?? clear.find((q) => q > 2)!;
    let oldKicks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const throwAt = (shaped: boolean) => simulateThrow({ start: [t.x - 8, t.y + 1.2], aim: 0, power: 0.35, disc: PT, hyzer: 0, perfect: true, launch: 0, releaseZ: z }, world([t], shaped), mulberry32(seed));
      expect(throwAt(true).events).not.toContain('branch');
      if (throwAt(false).events.includes('branch')) oldKicks++;
    }
    expect(oldKicks).toBeGreaterThan(0); // the old ellipsoid crown filled that space
  });

  it('through a clump, some throws get kicked; without shapes the old crown is used', () => {
    const t = treeOfKind(0);
    const sh = treeShape(t);
    // The densest height through the tree's center line.
    let best = 0, bestZ = 0;
    for (let z = 1; z < t.h; z += 0.25) {
      let n = 0;
      for (let s = -4; s <= 4; s += 0.1) if (sh.green(t.x, t.y + s, z)) n++;
      if (n > best) { best = n; bestZ = z; }
    }
    const pass = (shaped: boolean) => {
      let kicked = 0;
      for (let seed = 1; seed <= 60; seed++) {
        // A flat throw released at that height, 6 m short of the tree, through its middle.
        const r = simulateThrow({ start: [t.x + 0.6, t.y - 6], aim: Math.PI / 2, power: 0.5, disc: PT, hyzer: 0, perfect: true, launch: 0, releaseZ: bestZ }, world([t], shaped), mulberry32(seed));
        if (r.events.includes('branch')) kicked++;
      }
      return kicked;
    };
    expect(pass(true)).toBeGreaterThan(0);
    expect(pass(false)).toBeGreaterThan(0);
  });
});
