// End-of-round highlights from the event log (src/modes/roundStats.ts).
import { describe, expect, it } from 'vitest';
import type { RoundEvent, WireResult } from '../src/modes/discRound';
import { roundStats } from '../src/modes/roundStats';

const shot = (player: number, from: [number, number], to: [number, number], o: Partial<WireResult> = {}): RoundEvent => ({
  t: 'throw', player, perfect: false,
  result: { samples: [[from[0], from[1], 1], [to[0], to[1], 0]], banks: [0, 0], rest: to, restSurface: 'fairway', holed: false, penalty: 0, events: [], treesHit: [], ...o },
});
const wind: RoundEvent = { t: 'hole-start', wind: [0, 0] };

describe('roundStats', () => {
  it('finds the longest throw, the longest make, aces and trees, per hole', () => {
    const log: RoundEvent[] = [
      wind,
      shot(0, [0, 0], [0, 90], { treesHit: [1, 2] }),
      shot(1, [0, 0], [0, 60]),
      shot(0, [0, 90], [0, 100], { holed: true }),
      shot(1, [0, 60], [0, 100], { holed: true }),
      wind,
      shot(0, [0, 0], [0, 50], { holed: true }),
      shot(1, [0, 0], [0, 200], { penalty: 1, events: ['oob'] }),
    ];
    const r = roundStats(log, 2, 4);
    expect(r.longest).toMatchObject({ player: 0, hole: 4, dist: 90, at: 1 });
    expect(r.bestMake).toMatchObject({ player: 0, hole: 5, dist: 50 });
    expect(r.players[0]).toMatchObject({ throws: 3, trees: 2, aces: 1, penalties: 0, longest: 90 });
    expect(r.players[1]).toMatchObject({ throws: 3, aces: 0, penalties: 1, longest: 60 }); // the OB throw doesn't count as long
  });
  it('drops a throw taken back with a mulligan', () => {
    const log: RoundEvent[] = [wind, shot(0, [0, 0], [0, 120]), { t: 'mulligan', player: 0 }, shot(0, [0, 0], [0, 80], { holed: true })];
    const r = roundStats(log, 1, 0);
    expect(r.longest?.dist).toBe(80);
    expect(r.players[0]).toMatchObject({ throws: 1, aces: 1 });
  });
});
