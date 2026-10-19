import type { Tree } from '../course/disc-types';

/** Uniform-grid spatial hash. Crown radii are < CELL, so a 3×3 neighborhood covers any contact. */
export class TreeIndex {
  static readonly CELL = 5;
  private readonly cells = new Map<number, Tree[]>();

  constructor(readonly trees: Tree[]) {
    for (const t of trees) {
      const k = this.key(Math.floor(t.x / TreeIndex.CELL), Math.floor(t.y / TreeIndex.CELL));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(t);
    }
  }

  private key(cx: number, cy: number): number {
    return (cx + 50000) * 100000 + (cy + 50000);
  }

  /** Trees whose crown or trunk might touch (x, y). */
  near(x: number, y: number, out: Tree[] = []): Tree[] {
    out.length = 0;
    const cx = Math.floor(x / TreeIndex.CELL);
    const cy = Math.floor(y / TreeIndex.CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.cells.get(this.key(cx + dx, cy + dy));
        if (list) for (const t of list) out.push(t);
      }
    }
    return out;
  }
}
