// Layouts (src/course/layout.ts): short tees and B pins from a hole's alternates, or a short tee down
// its line when none is mapped.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DiscCourseFile, DiscHole } from '../src/course/disc-types';
import { dist, type Vec2 } from '../src/course/geo';
import { applyLayout, isDefault, layoutOptions } from '../src/course/layout';

const hole = (o: Partial<DiscHole> = {}): DiscHole => ({ ref: '1', par: 3, par_source: 'osm', tee: [0, 0], pin: [0, 100], routing: [[0, 0], [0, 100]], length_m: 100, warnings: [], ...o });

describe('layouts', () => {
  it('the default layout is the course as mapped', () => {
    const holes = [hole()];
    expect(applyLayout(holes, undefined)).toBe(holes);
    expect(applyLayout(holes, { tees: 'long', pins: 'A' })).toBe(holes);
    expect(isDefault({ tees: 'short', pins: 'A' })).toBe(false);
  });

  it('short tees: the longest mapped tee that is properly shorter', () => {
    const [h] = applyLayout([hole({ alt_tees: [[2, 5], [1, 30], [3, 60]] })], { tees: 'short', pins: 'A' });
    expect(h.tee).toEqual([1, 30]); // [2,5] is barely shorter; [3,60] is the shortest, but [1,30] keeps more of the hole
    expect(h.routing[0]).toEqual([1, 30]);
    expect(h.length_m).toBeCloseTo(dist([1, 30], [0, 100]), 6);
  });

  it('short tees with none mapped: a quarter down the line (15–45 m), never in the water', () => {
    const [h] = applyLayout([hole()], { tees: 'short', pins: 'A' });
    expect(h.tee[1]).toBeCloseTo(25, 6);
    const [long] = applyLayout([hole({ pin: [0, 400], routing: [[0, 0], [0, 400]], length_m: 400 })], { tees: 'short', pins: 'A' });
    expect(long.tee[1]).toBeCloseTo(45, 6);
    const wet = (p: Vec2) => p[1] > 15 && p[1] < 30;
    const [dry] = applyLayout([hole()], { tees: 'short', pins: 'A' }, wet);
    expect(wet(dry.tee)).toBe(false);
    expect(dry.tee[1]).toBeLessThanOrEqual(15);
  });

  it('B pins use the alternate basket; mixed picks per hole, the same for the same seed', () => {
    const holes = Array.from({ length: 12 }, (_, i) => hole({ ref: String(i + 1), alt_pins: [[5, 110]] }));
    expect(applyLayout(holes, { tees: 'long', pins: 'B' }).every((h) => h.pin[1] === 110)).toBe(true);
    const a = applyLayout(holes, { tees: 'long', pins: 'mixed', seed: 7 }).map((h) => h.pin[1]);
    expect(applyLayout(holes, { tees: 'long', pins: 'mixed', seed: 7 }).map((h) => h.pin[1])).toEqual(a);
    expect(new Set(a).size).toBe(2); // some of each
    expect(applyLayout([hole()], { tees: 'long', pins: 'B' })[0].pin).toEqual([0, 100]); // no alternate: the A pin
  });

  it('a par from length follows the new length; a mapped par stays', () => {
    const long = hole({ pin: [0, 160], routing: [[0, 0], [0, 160]], length_m: 160, par: 4, par_source: 'length' });
    expect(applyLayout([long], { tees: 'short', pins: 'A' })[0].par).toBe(3);
    expect(applyLayout([{ ...long, par_source: 'osm' }], { tees: 'short', pins: 'A' })[0].par).toBe(4);
  });

  it('pro tees: the farthest mapped tee that is properly longer, through the usual tee', () => {
    const [h] = applyLayout([hole({ alt_tees: [[0, -5], [0, -40], [1, 20]] })], { tees: 'pro', pins: 'A' });
    expect(h.tee).toEqual([0, -40]);
    expect(h.routing.slice(0, 2)).toEqual([[0, -40], [0, 0]]);
    expect(applyLayout([hole()], { tees: 'pro', pins: 'A' })[0].tee).toEqual([0, 0]); // none mapped: its own tee
  });

  it('Kincaid has a second basket on every hole', () => {
    const c: DiscCourseFile = JSON.parse(readFileSync('public/courses/kincaid.json', 'utf8'));
    expect(layoutOptions(c.holes).altPins).toBe(18);
  });
});
