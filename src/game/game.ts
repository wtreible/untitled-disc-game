// Local hot-seat stroke play on one hole (D12, D16).
import { dist, type Vec2 } from '../course/geo';
import type { CourseHole, SurfaceClass } from '../course/types';
import type { ShotResult } from './physics';

export const PLAYER_COLORS = ['#ffffff', '#ffd23f', '#3fc1ff', '#ff6b9a'];

export interface Player {
  name: string;
  color: string;
  ball: Vec2;
  lie: SurfaceClass;
  strokes: number;
  holed: boolean;
  /** Hit the max-strokes cap without holing out. */
  pickedUp: boolean;
  /** Last spot played from (for the shot trail). */
  lastFrom?: Vec2;
}

export function maxStrokes(par: number): number {
  return 2 * par + 2;
}

export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  const names: Record<number, string> = { [-3]: 'Albatross', [-2]: 'Eagle', [-1]: 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' };
  return names[d] ?? `+${d}`;
}

export class HoleGame {
  readonly players: Player[];
  current: number;

  constructor(readonly hole: CourseHole, names: string[]) {
    this.players = names.map((name, i) => ({
      name, color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      ball: [...hole.tee] as Vec2, lie: 'tee', strokes: 0, holed: false, pickedUp: false,
    }));
    this.current = 0;
  }

  get player(): Player {
    return this.players[this.current];
  }

  get finished(): boolean {
    return this.players.every((p) => p.holed || p.pickedUp);
  }

  distanceToPin(p: Player = this.player): number {
    return dist(p.ball, this.hole.pin);
  }

  /** Record a completed shot for the current player and advance the turn. */
  applyShot(r: ShotResult): void {
    const p = this.player;
    p.lastFrom = p.ball;
    p.strokes += 1 + r.penalty;
    p.ball = r.rest;
    p.lie = r.restSurface;
    if (r.holed) p.holed = true;
    else if (p.strokes >= maxStrokes(this.hole.par)) {
      p.strokes = maxStrokes(this.hole.par);
      p.pickedUp = true;
    }
    this.advance();
  }

  /** Golf's "away" rule: the farthest active player plays next; ties go to player order. */
  private advance(): void {
    let best = -1;
    let bestD = -1;
    this.players.forEach((p, i) => {
      if (p.holed || p.pickedUp) return;
      const d = this.distanceToPin(p);
      if (d > bestD + 1e-6) { best = i; bestD = d; }
    });
    if (best >= 0) this.current = best;
  }
}
