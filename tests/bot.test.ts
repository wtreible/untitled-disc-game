// Bots (src/game/bot.ts): what they plan, how they throw it, and how they score by level.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import type { Rings } from '../src/course/types';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type DiscWorld } from '../src/disc/flight';
import { neutralMods } from '../src/disc/mods';
import { TreeIndex } from '../src/disc/trees';
import { botClient, botOfClient, botRelease, planInput, planThrow, type BotLevel, type BotSituation } from '../src/game/bot';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const sq = (n: number): Rings => [[[-n, -n], [n, -n], [n, n], [-n, n]]];
const grid = SurfaceGrid.fromHole({ bounds: [[-300, -300], [300, 300]], boundary: [sq(280)], features: [], trees: [] }, 0.5);
const world = (pin: Vec2): DiscWorld => ({ grid, terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: pin });
const situation = (start: Vec2, pin: Vec2, o: Partial<BotSituation> = {}): BotSituation => ({
  start, pin, routing: [[0, 0], pin], discs: DISCS.filter((d) => d.suggest), world: world(pin), mods: neutralMods(), fromTee: true, ...o,
});

describe('bots', () => {
  it('a bot seat says what it is in its client id', () => {
    expect(botOfClient(botClient('pro', 0))).toBe('pro');
    expect(botOfClient('bot-easy-12')).toBe('easy');
    expect(botOfClient('client-aaaa')).toBeNull();
    expect(botOfClient(undefined)).toBeNull();
  });

  it('putts inside 20 m, at the basket, hard enough to reach the chains', async () => {
    const plan = await planThrow(situation([0, 0], [0, 9]), 'pro', mulberry32(1));
    expect(plan.putt).toBe(true);
    expect(plan.yaw).toBeCloseTo(Math.PI / 2, 6);
    const r = simulateThrow({ ...planInput(plan, situation([0, 0], [0, 9])), perfect: true }, world([0, 9]));
    expect(r.holed).toBe(true);
  });

  it('goes for a basket in reach, and lays up down the line when it is not', async () => {
    const near = await planThrow(situation([0, 0], [0, 90]), 'pro', mulberry32(2));
    expect(near.putt).toBe(false);
    expect(near.target).toEqual([0, 90]);
    const far = await planThrow(situation([0, 0], [0, 260]), 'pro', mulberry32(3));
    expect(far.target[1]).toBeLessThan(250);
    expect(Math.abs(far.target[0])).toBeLessThan(1); // down the line
  });

  it("an Easy bot's throws scatter more than a Pro's", () => {
    const plan = { disc: DISCS[2], hyzer: 0, yaw: 0, power: 0.7, putt: false, target: [0, 0] as Vec2 };
    const spread = (lv: BotLevel) => {
      const ys = Array.from({ length: 200 }, (_, s) => botRelease(plan, lv, mulberry32(s + 1)).execution.yaw);
      return Math.sqrt(ys.reduce((a, y) => a + y * y, 0) / ys.length);
    };
    expect(spread('easy')).toBeGreaterThan(spread('medium'));
    expect(spread('medium')).toBeGreaterThan(spread('pro'));
  });

  it('plays an open par 3 out, a Pro in fewer throws than an Easy bot', async () => {
    const pin: Vec2 = [0, 110];
    const play = async (lv: BotLevel, seed: number) => {
      const rng = mulberry32(seed);
      let ball: Vec2 = [0, 0], n = 0;
      while (n < 8) {
        const s = situation(ball, pin, { fromTee: n === 0 });
        const plan = await planThrow(s, lv, rng);
        const { power, execution } = botRelease(plan, lv, rng);
        const r = simulateThrow({ ...planInput(plan, s), power, execution }, s.world, rng);
        n += 1 + r.penalty;
        if (r.holed) break;
        ball = r.rest;
      }
      return n;
    };
    let pro = 0, easy = 0;
    for (let s = 1; s <= 6; s++) { pro += await play('pro', s); easy += await play('easy', s); }
    expect(pro / 6).toBeLessThanOrEqual(3.5);
    expect(easy).toBeGreaterThan(pro);
  }, 60000);
});
