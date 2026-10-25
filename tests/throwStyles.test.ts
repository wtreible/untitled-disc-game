// Throw styles (src/modes/throwStyles.ts): each one's input, start to release, and what a release's
// execution does to the flight.
import { describe, expect, it } from 'vitest';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type ThrowInput } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { FLICK, RETICLE, SNAP, ThrowControl, XSTEP, beatScore, reticleAt, snapExecution, snapHalf, type Release, type ThrowSetup } from '../src/modes/throwStyles';

const setup = (style: ThrowSetup['style'], over: Partial<ThrowSetup> = {}): ThrowSetup => ({ style, meterSpeed: 1, putt: false, discSpeed: 7, special: false, noOverpower: false, ...over });
const rel = (r: Release | 'cancel' | null | undefined): Release => { expect(r).toBeTypeOf('object'); return r as Release; };

describe('throw styles', () => {
  it('1 stage: hold and let go, as the base game', () => {
    const c = new ThrowControl(setup('classic'));
    c.press(0);
    expect(c.frame(500).view.fill).toBeCloseTo(0.5, 5);
    const r = rel(c.release(700));
    expect(r.power).toBeCloseTo(0.7, 5);
    expect(r.execution).toBeUndefined();
  });

  it('2 stage: a snap in the window is clean, early pulls and hyzers, late pushes and turns', () => {
    const snapAt = (needle: number) => {
      const c = new ThrowControl(setup('two-stage'));
      c.press(0);
      expect(c.release(600)).toBeNull(); // power set: the needle starts back from 0.6
      return rel(c.press(600 + ((0.6 - needle) / SNAP.sweep) * 1000));
    };
    const clean = snapAt(SNAP.center);
    expect(clean.power).toBeCloseTo(0.6, 5);
    expect(Math.abs(clean.execution!.yaw)).toBeLessThan(0.01);
    expect(clean.note).toBe('Clean release');
    const early = snapAt(SNAP.center + 0.2), late = snapAt(SNAP.center - 0.15);
    expect(early.execution!.yaw).toBeGreaterThan(3);
    expect(early.execution!.bank).toBeGreaterThan(0);
    expect(early.note).toMatch(/^Early by \d+ ms$/);
    expect(late.execution!.yaw).toBeLessThan(-3);
    expect(late.execution!.bank).toBeLessThan(0);
  });

  it('2 stage: nobody presses, the needle runs out and it shanks late', () => {
    const c = new ThrowControl(setup('two-stage'));
    c.press(0);
    c.release(500);
    expect(c.frame(600).done).toBeUndefined();
    const r = rel(c.frame(500 + 2000).done);
    expect(r.execution!.yaw).toBeLessThan(-5);
  });

  it('2 stage: the window narrows for fast discs and past 90%, and widens for putts', () => {
    expect(snapHalf(setup('two-stage', { discSpeed: 12 }), 0.5)).toBeLessThan(snapHalf(setup('two-stage', { discSpeed: 2 }), 0.5));
    expect(snapHalf(setup('two-stage'), 1)).toBeLessThan(snapHalf(setup('two-stage'), 0.85) * 0.5);
    expect(snapHalf(setup('two-stage', { noOverpower: true }), 1)).toBeCloseTo(snapHalf(setup('two-stage', { noOverpower: true }), 0.85), 9);
    expect(snapHalf(setup('two-stage', { putt: true }), 0.5)).toBeGreaterThan(snapHalf(setup('two-stage'), 0.5));
    expect(Math.abs(snapExecution(3, true).yaw)).toBeLessThan(Math.abs(snapExecution(3, false).yaw));
  });

  /** Press at (400, 400), then swipe at `deg` off straight up, out to `to` px, taking `ms`. */
  const swipe = (deg: number, ms: number, o: Partial<ThrowSetup> = {}, to = FLICK.R + 1) => {
    const c = new ThrowControl(setup('flick', o));
    c.move(400, 400, 0);
    c.press(0);
    const a = (deg * Math.PI) / 180;
    let out: Release | null = null;
    for (let k = 1; k <= 20 && !out; k++) out = c.move(400 + Math.sin(a) * (to * k) / 20, 400 - Math.cos(a) * (to * k) / 20, (ms * k) / 20);
    return { c, out };
  };

  it('flick: swipe out through the slice; speed is power, where it leaves is direction', () => {
    const soft = rel(swipe(0, 220).out), hard = rel(swipe(0, 60).out), right = rel(swipe(18, 150).out);
    expect(soft.power).toBeGreaterThan(0.3);
    expect(soft.power).toBeLessThan(0.7);
    expect(hard.power).toBe(1);
    expect(hard.note).toBe('Muscled it');
    expect(hard.execution!.wobble).toBeGreaterThan(soft.execution!.wobble);
    expect(Math.abs(soft.execution!.yaw)).toBeLessThan(0.01);
    expect(right.execution!.yaw).toBeLessThan(-2); // out the right of the slice: pushed right
    // A forehand's screen direction is the same: right is still right.
    expect(rel(swipe(18, 150, { mirror: true }).out).execution!.yaw).toBeGreaterThan(2);
  });

  it('flick: out through the side of the slice is a shank; a wider slice (timing) forgives it', () => {
    const out = rel(swipe(40, 150).out);
    expect(out.note).toMatch(/shanked/);
    expect(Math.abs(out.execution!.yaw)).toBeGreaterThan(8);
    expect(rel(swipe(30, 150, { timing: 1.4 }).out).note).not.toMatch(/shanked/);
  });

  it('flick: the slice follows the pointer until the swipe starts; letting go before then calls it off', () => {
    const c = new ThrowControl(setup('flick'));
    c.move(400, 400, 0);
    c.press(0);
    c.move(400, 440, 50); // backwards: not a swipe
    const w = c.frame(60).view.wedge!;
    expect(w.started).toBe(false);
    expect(w.at[1]).toBeGreaterThan(420);
    expect(c.release(100)).toBe('cancel');
    // Let go part way through a swipe: thrown with it so far.
    expect(rel(swipe(0, 150, {}, 100).c.release(160)).power).toBeGreaterThan(0);
  });

  it('X-step: on the beat adds distance, off it costs distance and adds wobble', () => {
    const run = (offs: number[]) => {
      const c = new ThrowControl(setup('xstep'));
      c.press(0);
      offs.forEach((o, i) => { c.frame((i + 1) * XSTEP.beat + o - 1); c.press((i + 1) * XSTEP.beat + o); });
      return rel(c.release(3 * XSTEP.beat + offs[2] + 800));
    };
    const good = run([0, 10, -20]), bad = run([150, -150, 160]);
    expect(good.note).toBe('Rhythm 100%');
    expect(good.power).toBeCloseTo(0.8 * 1.1, 5);
    expect(bad.power).toBeLessThan(0.8);
    expect(bad.execution!.wobble).toBeGreaterThan(good.execution!.wobble);
    expect(beatScore(0, XSTEP.beat)).toBe(1);
    expect(beatScore(XSTEP.beat, XSTEP.beat)).toBe(0);
  });

  it('X-step: missed beats are stumbles, and a missed plant plants anyway', () => {
    const c = new ThrowControl(setup('xstep'));
    c.press(0);
    for (let t = 0; t <= 4 * XSTEP.beat; t += 16) c.frame(t);
    expect(c.frame(4 * XSTEP.beat).view.track!.beats.every((b) => b.hit === 0)).toBe(true);
    expect(rel(c.release(4 * XSTEP.beat + 300)).note).toBe('Rhythm 0%');
  });

  it('X-step: the timeline shows the beats ahead and the cursor moving toward them', () => {
    const c = new ThrowControl(setup('xstep'));
    c.press(0);
    const t = c.frame(XSTEP.beat / 2).view.track!;
    expect(t.beats.map((b) => b.hold)).toEqual([false, false, true]);
    expect(t.cursor).toBeGreaterThan(0);
    expect(t.cursor).toBeLessThan(t.beats[0].at);
  });

  it('2-stage putts: a breathing reticle; pressed tight is steadier than pressed wide', () => {
    const putt = (wait: number) => {
      const c = new ThrowControl(setup('two-stage', { putt: true }));
      c.press(0);
      c.release(500);
      expect(c.frame(500 + wait).view.reticle).toBeDefined();
      return rel(c.press(500 + wait));
    };
    const tight = putt(0), wide = putt(RETICLE.period / 2);
    expect(tight.execution!.wobble).toBeLessThan(wide.execution!.wobble);
    expect(tight.note).toBe('Steady');
    expect(reticleAt(0, setup('two-stage', { timing: 1.4 }))).toBeLessThan(reticleAt(0, setup('two-stage')));
  });

  it('timing widens the 2-stage window and the X-step beats', () => {
    expect(snapHalf(setup('two-stage', { timing: 1.4 }), 0.5)).toBeCloseTo(snapHalf(setup('two-stage'), 0.5) * 1.4, 9);
    expect(beatScore(100, XSTEP.beat, 1.4)).toBeGreaterThan(beatScore(100, XSTEP.beat));
  });

  it('X-step putts are thrown the 1-stage way', () => {
    const c = new ThrowControl(setup('xstep', { putt: true }));
    c.press(0);
    expect(rel(c.release(400)).execution).toBeUndefined();
  });
});

describe('execution in the flight model', () => {
  const sq: [number, number][][] = [[[-150, -150], [150, -150], [150, 150], [-150, 150]]];
  const grid = SurfaceGrid.fromHole({ bounds: [[-200, -200], [200, 200]], boundary: [sq], features: [], trees: [] }, 0.5);
  const world = { grid, terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [0, 150] as [number, number] };
  const base: ThrowInput = { start: [0, 0], aim: Math.PI / 2, power: 0.7, disc: DISCS[2], hyzer: 0 };
  const restX = (i: ThrowInput) => simulateThrow(i, world, () => 0.5).rest[0];

  it('a pull lands left, a push right, mirrored for forehand; Perfect Form ignores it', () => {
    const plain = restX(base);
    expect(restX({ ...base, execution: { yaw: 5, bank: 0, wobble: 1 } })).toBeLessThan(plain - 3);
    expect(restX({ ...base, execution: { yaw: -5, bank: 0, wobble: 1 } })).toBeGreaterThan(plain + 3);
    const fh = restX({ ...base, mirror: true });
    expect(restX({ ...base, mirror: true, execution: { yaw: 5, bank: 0, wobble: 1 } })).toBeGreaterThan(fh + 3);
    expect(restX({ ...base, perfect: true, execution: { yaw: 5, bank: 0, wobble: 1 } })).toBeCloseTo(restX({ ...base, perfect: true }), 6);
  });

  it('wobble 0 takes the random error away', () => {
    const a = simulateThrow({ ...base, execution: { yaw: 0, bank: 0, wobble: 0 } }, world, () => 0.9).rest;
    const b = simulateThrow({ ...base, execution: { yaw: 0, bank: 0, wobble: 0 } }, world, () => 0.1).rest;
    expect(a[0]).toBeCloseTo(b[0], 6);
  });
});
