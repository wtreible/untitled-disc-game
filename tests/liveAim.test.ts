// Live aim's send rate (LiveGate, src/modes/discSync.ts) and the meter watchers run themselves.
import { describe, expect, it } from 'vitest';
import { meterAt } from '../src/modes/discKit';
import { LiveGate } from '../src/modes/discSync';

describe('live aim', () => {
  it('a 60 fps aim that changes every frame for 3 s sends at most 5 a second', () => {
    const g = new LiveGate(200);
    let sent = 0;
    for (let f = 0; f < 180; f++) if (g.pass(`yaw ${f}`, f * (1000 / 60))) sent++;
    expect(sent).toBeLessThanOrEqual(15);
    expect(sent).toBeGreaterThanOrEqual(14);
  });

  it('nothing goes while nothing changes; the last change goes once the limit is up', () => {
    const g = new LiveGate(200);
    expect(g.pass('a', 0)).toBe(true);
    expect(g.pass('a', 500)).toBe(false);
    expect(g.pass('b', 550)).toBe(true);
    expect(g.pass('c', 600)).toBe(false); // too soon: held back…
    expect(g.pass('c', 700)).toBe(false);
    expect(g.pass('c', 760)).toBe(true); // …and sent once the time is up
    g.reset();
    expect(g.pass('c', 1000)).toBe(true); // a new turn: straight away
  });

  it('the meter: up to full, back down, round again, at the mods speed', () => {
    expect(meterAt(0, 1)).toBe(0);
    expect(meterAt(500, 1)).toBeCloseTo(0.5);
    expect(meterAt(1000, 1)).toBeCloseTo(1);
    expect(meterAt(1500, 1)).toBeCloseTo(0.5);
    expect(meterAt(2500, 1)).toBeCloseTo(0.5);
    expect(meterAt(500, 1.5)).toBeCloseTo(0.75);
  });
});
