// The putting ladder (src/modes/putting.ts), worked out from the round's throws.
import { describe, expect, it } from 'vitest';
import type { RoundEvent } from '../src/modes/discRound';
import { PERFECT, PUTTS, STATIONS, puttingState, stationBasket } from '../src/modes/putting';

/** Range throws in turn order (player 0, 1, 0, 1, …), made or missed. */
const putts = (players: number, made: boolean[]): RoundEvent[] => made.map((h, i) => ({ t: 'throw', player: i % players, perfect: false, result: { samples: [], banks: [], rest: [0, 0], restSurface: 'green', holed: h, penalty: 0, events: [], treesHit: [] } }) as RoundEvent);

describe('putting ladder', () => {
  it('stations move on after three putts each, makes score the station\'s points', () => {
    expect(PERFECT).toBe(45);
    const log: RoundEvent[] = [{ t: 'hole-start', wind: [0, 0] }, ...putts(2, [true, false, true, true, false, false])];
    const s = puttingState(log, 2);
    expect(s.station).toBe(1); // 6 putts = 3 each: station 2
    expect(s.putts[0][0]).toEqual([true, true, false]);
    expect(s.putts[1][0]).toEqual([false, true, false]);
    expect(s.scores).toEqual([2, 1]);
    expect(s.done).toBe(false);
  });

  it('a perfect solo ladder is 45 and done; Play again starts counting afresh', () => {
    const all = putts(1, Array(STATIONS.length * PUTTS).fill(true));
    const s = puttingState(all, 1);
    expect([s.done, s.station, s.scores[0]]).toEqual([true, STATIONS.length, 45]);
    const again = [...all, ...putts(1, [true])];
    const t = puttingState(again, 1, all.length);
    expect([t.done, t.station, t.scores[0], t.putts[0][0]]).toEqual([false, 0, 1, [true]]);
  });

  it('baskets go straight downrange, farther each station', () => {
    expect(stationBasket(0)[0]).toBe(0);
    expect(stationBasket(4)[1]).toBeGreaterThan(stationBasket(0)[1]);
    expect(stationBasket(99)).toEqual(stationBasket(STATIONS.length - 1));
  });
});
