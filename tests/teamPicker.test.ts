// Team assignments (src/game/teams.ts): any split into two or more teams, however uneven.
import { describe, expect, it } from 'vitest';
import { defaultTeams, nextTeam, teamGroups, teamsLabel } from '../src/game/teams';

describe('team assignments', () => {
  it('groups players by team, numbered by their first player; uneven is fine', () => {
    expect(teamGroups([1, 0, 0], 3)).toEqual([[0], [1, 2]]); // 1 v 2
    expect(teamGroups([0, 1, 2, 2], 4)).toEqual([[0], [1], [2, 3]]); // 1 v 1 v 2
    expect(teamGroups([0, 1, 0, 1, 1], 5)).toEqual([[0, 2], [1, 3, 4]]); // 2 v 3, not by seat blocks
    expect(teamsLabel(teamGroups([0, 1, 0, 1, 1], 5)!)).toBe('2 v 3');
  });

  it("isn't a match with one team, the wrong count, or junk", () => {
    expect(teamGroups([0, 0, 0], 3)).toBeNull();
    expect(teamGroups([0, 1], 3)).toBeNull();
    expect(teamGroups([0, 'x', 1], 3)).toBeNull();
    expect(teamGroups([0, 7, 1], 3)).toBeNull();
    expect(teamGroups(undefined, 3)).toBeNull();
  });

  it('starts as halves by seat (the bigger half second) and clicks round every possible team', () => {
    expect(defaultTeams(3)).toEqual([0, 1, 1]);
    expect(defaultTeams(4)).toEqual([0, 0, 1, 1]);
    expect(defaultTeams(5)).toEqual([0, 0, 1, 1, 1]);
    expect([0, 1, 2, 3, 4].map((t) => nextTeam(t, 6))).toEqual([1, 2, 3, 4, 0]); // 6 players: up to 5 teams
    expect([0, 1].map((t) => nextTeam(t, 2))).toEqual([1, 0]);
  });
});
