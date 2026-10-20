// A multi-hole round: scorecard, hole progression, and honors (lowest score on the last hole tees
// off first, ties keep the previous order). Used by disc golf; golf v1 is a single hole.
import type { Vec2 } from '../course/geo';
import { HoleGame, type HoleLike } from './game';

export class Round {
  /** scores[player][holeIndex]; undefined until the hole is played. */
  readonly scores: (number | undefined)[][];
  index: number;
  game: HoleGame;
  private order: number[];
  /** Per-player extra throws before pick-up, applied to each new hole. */
  readonly capBonus: number[];

  /** Optional per-player tees and baskets for a hole (roguelike personal course changes). */
  setup?: (holeIndex: number) => { tees: Vec2[]; pins: Vec2[] };

  constructor(readonly holes: HoleLike[], readonly names: string[], readonly first = 0, readonly count = holes.length) {
    this.scores = names.map(() => holes.map(() => undefined));
    this.index = first;
    this.order = names.map((_, i) => i);
    this.capBonus = names.map(() => 0);
    this.game = new HoleGame(holes[first], names, this.order, this.capBonus);
  }

  get hole(): HoleLike {
    return this.holes[this.index];
  }

  get holesPlayed(): number {
    return this.index - this.first + (this.game.finished ? 1 : 0);
  }

  get isLastHole(): boolean {
    return this.index >= this.first + this.count - 1;
  }

  /** Record the finished hole. Returns false when the round is over. */
  nextHole(): boolean {
    this.recordCurrent();
    if (this.isLastHole) return false;
    const last = this.index;
    this.order = [...this.order].sort((a, b) => (this.scores[a][last] ?? 0) - (this.scores[b][last] ?? 0));
    this.index++;
    this.game = this.makeGame();
    return true;
  }

  /** Rebuild the current hole's game (after setup or capBonus change, before anyone throws). */
  restartHole(): void {
    this.game = this.makeGame();
  }

  private makeGame(): HoleGame {
    const s = this.setup?.(this.index);
    return new HoleGame(this.holes[this.index], this.names, this.order, this.capBonus, s?.tees, s?.pins);
  }

  recordCurrent(): void {
    this.game.players.forEach((p, i) => { this.scores[i][this.index] = p.strokes; });
  }

  total(player: number): number {
    return this.scores[player].reduce<number>((s, v) => s + (v ?? 0), 0);
  }

  /** Strokes relative to par over the holes this player has completed. */
  toPar(player: number): number {
    let d = 0;
    this.scores[player].forEach((v, h) => { if (v !== undefined) d += v - this.holes[h].par; });
    return d;
  }
}
