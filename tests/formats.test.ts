// Round formats (src/game/formats.ts) and the round model's alternate shot and Bounty.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DiscCourseFile } from '../src/course/disc-types';
import type { Vec2 } from '../src/course/geo';
import { effectiveMods } from '../src/disc/mods';
import { BOUNTY, bountyLeader, matchOf, matchText, skinsOf } from '../src/game/formats';
import { DiscRound, type RoundEvent, type WireResult } from '../src/modes/discRound';

describe('skins', () => {
  it('the lowest score alone takes the pot; a tie carries it on', () => {
    const s = skinsOf([[3, 3, 2, 4], [3, 4, 3, 3], [4, 3, 3, 5]], [0, 1, 2, 3]);
    // Hole 1 tied (A and B 3), hole 2 tied (A and C 3), hole 3 A alone (2): 3 skins; hole 4 B alone.
    expect(s.holes.map((h) => [h.winner, h.worth])).toEqual([[null, 1], [null, 2], [0, 3], [1, 1]]);
    expect(s.won).toEqual([3, 1, 0]);
    expect(s.carry).toBe(0);
  });
  it("stops at a hole someone hasn't finished, and counts what's riding", () => {
    const s = skinsOf([[3, 3, undefined], [3, 4, undefined]], [0, 1, 2]);
    expect(s.holes).toHaveLength(2);
    expect(s.carry).toBe(0);
    expect(skinsOf([[3, undefined], [3, undefined]], [0, 1]).carry).toBe(1);
  });
});

describe('match play', () => {
  it('holes up, holes left, and decided early', () => {
    const m = matchOf([3, 3, 2, 3, 3], [4, 3, 3, 4, 3], [0, 1, 2, 3, 4, 5, 6]);
    expect(m.up).toBe(3);
    expect(m.left).toBe(2);
    expect(m.decided).toBe(true);
    expect(matchText(m, ['Ann', 'Bo'])).toBe('Ann wins 3 & 2');
    expect(matchText(matchOf([3], [3], [0, 1]), ['Ann', 'Bo'])).toBe('All square');
    expect(matchText(matchOf([4, 3], [3, 3], [0, 1, 2]), ['Ann', 'Bo'])).toBe('Bo 1 up');
  });
});

describe('Bounty', () => {
  it('only an outright leader carries it', () => {
    expect(bountyLeader([-1, 0, 2])).toBe(0);
    expect(bountyLeader([-1, -1, 2])).toBeNull();
  });
});

// The round model, with throws handed in directly (where they land is all that matters here).
const course: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali-simple.json', 'utf8'));
const wr = (rest: Vec2, holed = false): WireResult => ({ samples: [], banks: [], rest, restSurface: 'fairway', holed, penalty: 0, events: [], treesHit: [] });

describe('alternate shot', () => {
  it('one disc per team: teammates take turns, and tee shots go round the team hole by hole', () => {
    const r = new DiscRound(course.holes, [], { names: ['A', 'B', 'C', 'D'], first: 0, count: 2, rogue: false, teams: [0, 0, 1, 1], teamPlay: 'alternate' }, () => false);
    r.apply({ t: 'hole-start', wind: [0, 0] });
    const pin = r.game.pins[0];
    const thrower = () => r.game.current;
    const throwBy = (rest: Vec2, holed = false) => { const e: RoundEvent = { t: 'throw', player: thrower(), perfect: false, result: wr(rest, holed) }; r.apply(e); };
    // Hole 1: A tees for team 0 (index 0), C for team 1.
    expect([0, 2]).toContain(thrower());
    const firstTeam = r.teamOf(thrower());
    const teeBy = thrower();
    throwBy([pin[0] - 60, pin[1]]);
    // Each throw is the team's stroke: both members moved, one stroke each.
    const mates = r.teams![firstTeam];
    for (const p of mates) expect(r.game.players[p].strokes).toBe(1);
    // The other team tees; then the first team's second throw is the other member's.
    throwBy([pin[0] - 50, pin[1]]);
    while (r.teamOf(thrower()) !== firstTeam) throwBy(pin, true);
    expect(thrower()).toBe(mates.find((p) => p !== teeBy));
  });
});

describe('Bounty in the round', () => {
  it('the hole-start event says who carries it; their modifiers take the handicap', () => {
    const r = new DiscRound(course.holes, [], { names: ['A', 'B'], first: 0, count: 2, rogue: false }, () => false);
    r.apply({ t: 'hole-start', wind: [0, 0], bounty: { players: [1], hex: 'tight' } });
    expect(r.bounty).toEqual({ players: [1], hex: 'tight' });
    const m = effectiveMods(r.mods, 1);
    BOUNTY.tight.apply(m);
    expect(m.basketScale).toBeCloseTo(0.85, 6);
    r.apply({ t: 'hole-start', wind: [0, 0] });
    expect(r.bounty).toBeNull();
  });
});
