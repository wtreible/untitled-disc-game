// Throw styles (src/modes/throwStyles.ts): each one's input, start to release, and what a release's
// execution does to the flight.
import { describe, expect, it } from 'vitest';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type ThrowInput } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { FLICK, RETICLE, SNAP, SNAP_LANE, ThrowControl, XSTEP, beatAt, beatScore, idleView, reticleAt, snapExecution, snapHalf, type Release, type ThrowSetup } from '../src/modes/throwStyles';

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
      expect(c.release(600)).toBeNull(); // power set: the needle starts at the lane's right end
      return rel(c.press(600 + SNAP.lead + ((SNAP_LANE[1] - needle) / SNAP.sweep) * 1000));
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

  it('2 stage: the needle bounces off the lane ends, so a miss gets another pass', () => {
    const [lo, hi] = SNAP_LANE, w = hi - lo;
    const c = new ThrowControl(setup('two-stage'));
    c.press(0);
    c.release(500);
    expect(c.frame(500 + SNAP.lead).view.needle).toBe(hi); // waits at the start
    const at = (d: number) => 500 + SNAP.lead + (d / SNAP.sweep) * 1000;
    expect(c.frame(at(w * 0.9)).view.needle).toBeCloseTo(lo + w * 0.1, 5); // first pass, heading left
    expect(c.frame(at(w * 1.25)).view.needle).toBeCloseTo(lo + w * 0.25, 5); // bounced, heading right
    expect(c.frame(at(w * (SNAP.passes - 0.01))).done).toBeUndefined(); // last pass still live
    // Coming back through the window on the second pass is as clean as the first.
    expect(rel(c.press(at(w + (SNAP.center - lo)))).note).toBe('Clean release');
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

  /** Press at (400, 400), pull back 60 px, then swing up at `deg` off straight up at `pxs` px/s for `ms`; `hold` ms still before letting go. */
  const swing = (deg: number, pxs: number, o: Partial<ThrowSetup> = {}, ms = 152, hold = 0) => {
    const c = new ThrowControl(setup('flick', o));
    c.move(400, 400, 0);
    c.press(0);
    for (let t = 10; t <= 100; t += 10) c.move(400, 400 + (60 * t) / 100, t); // the backswing
    const a = (deg * Math.PI) / 180;
    for (let t = 8; t <= ms; t += 8) c.move(400 + Math.sin(a) * pxs * t / 1000, 460 - Math.cos(a) * pxs * t / 1000, 100 + t);
    return { c, out: c.release(100 + ms + hold) };
  };

  it('flick: the speed it is let go at is power, its direction is accuracy', () => {
    const soft = rel(swing(0, FLICK.full * 0.5).out), hard = rel(swing(0, FLICK.full * 1.5).out), right = rel(swing(15, FLICK.full * 0.6).out);
    expect(soft.power).toBeCloseTo(0.5, 1);
    expect(soft.note).toBe('50% · straight');
    expect(hard.power).toBe(1);
    expect(hard.note).toMatch(/^Muscled/);
    expect(hard.execution!.wobble).toBeGreaterThan(soft.execution!.wobble);
    expect(Math.abs(soft.execution!.yaw)).toBeLessThan(0.01);
    expect(right.execution!.yaw).toBeLessThan(-2); // swung up and to the right: pushed right
    expect(right.note).toMatch(/° right$/);
    // A forehand's screen direction is the same: right is still right.
    expect(rel(swing(15, FLICK.full * 0.6, { mirror: true }).out).execution!.yaw).toBeGreaterThan(2);
    // Within a couple of degrees of straight up is dead straight.
    expect(rel(swing(2, FLICK.full * 0.6).out).execution!.yaw).toBe(-0);
  });

  it('flick: only the end of the swing counts, so speeding up at the release is what matters', () => {
    const c = new ThrowControl(setup('flick'));
    c.move(400, 400, 0);
    c.press(0);
    c.move(400, 440, 60);
    for (let t = 8; t <= 400; t += 8) c.move(400, 440 - 0.3 * t, 60 + t); // slow…
    for (let t = 8; t <= 80; t += 8) c.move(400, 320 - 1.2 * t, 460 + t); // …then fast
    expect(rel(c.release(540)).power).toBeCloseTo(1200 / FLICK.full, 1);
  });

  it('flick: outside the fan is a shank; a wider fan (timing) forgives it', () => {
    const out = rel(swing(40, FLICK.full * 0.6).out);
    expect(out.note).toBe('Shanked right');
    expect(Math.abs(out.execution!.yaw)).toBeGreaterThan(8);
    expect(rel(swing(30, FLICK.full * 0.6, { timing: 1.4 }).out).note).not.toMatch(/Shanked/);
  });

  it('flick: the fan follows the backswing; let go before swinging up, or after stopping, calls it off', () => {
    const c = new ThrowControl(setup('flick'));
    c.move(400, 400, 0);
    c.press(0);
    c.move(410, 450, 50);
    const f = c.frame(60).view.flick!;
    expect(f.started).toBe(false);
    expect(f.at).toEqual([410, 450]);
    expect(c.release(100)).toBe('cancel');
    expect(swing(0, FLICK.full * 0.6, {}, 152, 400).out).toBe('cancel'); // swung, then held still
    // Swinging, the fan stays put and the trail runs from the press.
    const s = new ThrowControl(setup('flick'));
    s.move(400, 400, 0);
    s.press(0);
    s.move(400, 450, 50);
    s.move(400, 400, 80);
    const g = s.frame(80).view.flick!;
    expect(g.started).toBe(true);
    expect(g.at).toEqual([400, 450]);
    expect(g.trail.length).toBe(3);
    expect(g.angle).toBeCloseTo(0, 5);
  });

  /** X-step flick: press at (400, 400), reach back 60 px (the run-up starts at 40), tap the steps `offs` ms off beats 1 and 2, then swing straight up at `pxs` and let go `late` ms off beat 3. */
  const hybrid = (offs: (number | null)[], late: number, pxs = FLICK.full * 0.6, o: Partial<ThrowSetup> = {}) => {
    const c = new ThrowControl(setup('hybrid', o));
    c.move(400, 400, 0);
    c.press(0);
    let t0 = 0;
    for (let t = 10; t <= 60; t += 10) { c.move(400, 400 + t, t); if (t === 40) t0 = t; }
    offs.forEach((off, i) => { if (off !== null) { c.frame(t0 + beatAt(i + 1) * XSTEP.beat + off - 1); c.press(t0 + beatAt(i + 1) * XSTEP.beat + off); } });
    const end = t0 + beatAt(3) * XSTEP.beat + late;
    for (let t = end - 144; t <= end; t += 8) c.move(400, 460 - pxs * (t - end + 144) / 1000, t);
    return c.release(end);
  };

  it('X-step flick: the flick\'s power and direction, with the run-up\'s rhythm on top', () => {
    const good = rel(hybrid([0, 10], 0)), bad = rel(hybrid([150, -150], 200));
    expect(good.note).toBe('60% · straight · rhythm 100%');
    expect(good.power).toBeCloseTo(0.6 * 1.1, 1);
    expect(bad.power).toBeLessThan(0.6);
    expect(bad.execution!.wobble).toBeGreaterThan(good.execution!.wobble);
    // A skipped step is a stumble.
    expect(rel(hybrid([0, null], 0)).note).toMatch(/rhythm 67%$/);
  });

  it('X-step flick: letting go before reaching back calls it off; the timeline waits for the reach', () => {
    const c = new ThrowControl(setup('hybrid'));
    c.move(400, 400, 0);
    c.press(0);
    c.move(400, 420, 30);
    const v = c.frame(500).view;
    expect(v.track!.cursor).toBe(0);
    expect(v.track!.beats.map((b) => b.label)).toEqual(['1', '2', 'FLICK']);
    expect(c.release(520)).toBe('cancel');
  });

  it('X-step flick putts and standstill throws are plain flicks', () => {
    for (const o of [{ putt: true }, { standstill: true }]) expect(new ThrowControl(setup('hybrid', o)).style).toBe('flick');
  });

  it('X-step: on the beat adds distance, off it costs distance and adds wobble', () => {
    const run = (offs: number[]) => {
      const c = new ThrowControl(setup('xstep'));
      c.press(0);
      offs.forEach((o, i) => { c.frame(beatAt(i + 1) * XSTEP.beat + o - 1); c.press(beatAt(i + 1) * XSTEP.beat + o); });
      return rel(c.release(beatAt(3) * XSTEP.beat + offs[2] + 800));
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
    for (let t = 0; t <= beatAt(4) * XSTEP.beat; t += 16) c.frame(t);
    expect(c.frame(beatAt(4) * XSTEP.beat).view.track!.beats.every((b) => b.hit === 0)).toBe(true);
    expect(rel(c.release(beatAt(4) * XSTEP.beat + 300)).note).toBe('Rhythm 0%');
  });

  it('X-step: the first beat comes after a lead-in, the others a beat apart', () => {
    expect(beatAt(1) / 1).toBeGreaterThanOrEqual(1.25);
    expect(beatAt(1)).toBeLessThanOrEqual(1.5);
    expect(beatAt(2) - beatAt(1)).toBe(1);
    // Pressing a plain beat after the start is now early for beat 1.
    const c = new ThrowControl(setup('xstep'));
    c.press(0);
    c.press(XSTEP.beat);
    expect(c.frame(XSTEP.beat + 1).view.track!.beats[0].hit).toBeLessThan(1);
  });

  it('X-step: the timeline shows the beats ahead and the cursor moving toward them', () => {
    const c = new ThrowControl(setup('xstep'));
    c.press(0);
    const t = c.frame(XSTEP.beat / 2).view.track!;
    expect(t.beats.map((b) => b.label)).toEqual(['1', '2', 'HOLD']);
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

  it('before the throw, the HUD shows the lanes the style will use', () => {
    expect(idleView(setup('two-stage'), 0.5).window).toBeDefined();
    expect(idleView(setup('two-stage', { putt: true }), 0.5).window).toBeUndefined();
    expect(idleView(setup('xstep'), 0.5).track!.beats.map((b) => b.hit)).toEqual([null, null, null]);
    expect(idleView(setup('xstep', { standstill: true }), 0.5).track).toBeUndefined();
    expect(idleView(setup('flick'), 0.5)).toEqual({ fill: 0, hint: '' });
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
