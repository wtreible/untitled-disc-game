// Best shot teams: which team each player is on (a number per player, in seat order), however
// uneven: 1 v 2, 1 v 1 v 2, 2 v 3… The round (src/modes/discRound.ts) groups them; the menu and
// the room's lobby edit them (src/main.ts).

/**
 * The teams as groups of players (by seat), numbered in order of their first player; null if they
 * don't make a match (fewer than two teams, or not one number per player).
 */
export function teamGroups(teams: readonly unknown[] | undefined, players: number): number[][] | null {
  if (!teams || teams.length !== players || !teams.every((t) => Number.isInteger(t) && (t as number) >= 0 && (t as number) < players)) return null;
  const groups = new Map<number, number[]>();
  teams.forEach((t, p) => { const g = groups.get(t as number) ?? []; g.push(p); groups.set(t as number, g); });
  const out = [...groups.values()].sort((a, b) => a[0] - b[0]);
  return out.length >= 2 ? out : null;
}

/** A first split: two teams, halves by seat order (the bigger half second: 1 v 2, 2 v 3). */
export const defaultTeams = (players: number): number[] => Array.from({ length: players }, (_, p) => (p < Math.floor(players / 2) ? 0 : 1));

/** The next team for a player when their team is clicked: through every team there could be, and round. */
export const nextTeam = (team: number, players: number): number => (team + 1) % Math.max(2, players - 1);

/** How a split reads: "1 v 2", "2 v 2 v 2". */
export const teamsLabel = (groups: number[][]): string => groups.map((g) => g.length).join(' v ');
