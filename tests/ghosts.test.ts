// Ghost discs (src/game/ghosts.ts): the best tee shot per hole, kept and given back exactly.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/game/terrain';
import { beats, ghostKey, loadGhost, offerGhost } from '../src/game/ghosts';

beforeAll(() => {
  const store = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
});

const flight = (n: number, dx: number): Vec3[] => Array.from({ length: n }, (_, k): Vec3 => [Math.round(k * dx * 1000) / 1000, 0, 1.5]);

describe('ghost discs', () => {
  it('holed beats anything; else nearer beats farther; ties keep the old one', () => {
    expect(beats({ holed: false, off: 9 }, null)).toBe(true);
    expect(beats({ holed: true, off: 0 }, { holed: false, off: 0.5 })).toBe(true);
    expect(beats({ holed: false, off: 0.5 }, { holed: true, off: 0 })).toBe(false);
    expect(beats({ holed: false, off: 4 }, { holed: false, off: 6 })).toBe(true);
    expect(beats({ holed: false, off: 6 }, { holed: false, off: 6 })).toBe(false);
  });

  it('keeps the best tee shot per hole and gives the flight back exactly', () => {
    const key = ghostKey('bluelake', '8');
    expect(loadGhost(key)).toBeNull();
    const first = flight(120, 0.37);
    expect(offerGhost(key, first, [44, 0], [50, 0], false)).toBe(true); // 6 m out
    expect(offerGhost(key, flight(90, 0.3), [27, 0], [50, 0], false)).toBe(false); // 23 m out: worse
    expect(loadGhost(key)).toEqual({ samples: first, holed: false, off: 6 });
    const ace = flight(140, 0.36);
    expect(offerGhost(key, ace, [50, 0], [50, 0], true)).toBe(true);
    expect(loadGhost(key)?.holed).toBe(true);
    expect(loadGhost(ghostKey('bluelake', '9'))).toBeNull(); // other holes untouched
  });
});
