// Rasterized surface lookup: classAt(x, y) in O(1). See docs/02-architecture.md.
import type { Vec2 } from '../course/geo';
import { SURFACE_CLASSES, surfacePriority, type CourseHole, type Rings, type SurfaceClass } from '../course/types';

export type SurfaceSource = Pick<CourseHole, 'bounds' | 'boundary' | 'trees' | 'features'> & { ob?: Rings[] };

export class SurfaceGrid {
  readonly cols: number;
  readonly rows: number;
  /** Index into SURFACE_CLASSES per cell; row 0 is minY. */
  readonly cls: Uint8Array;
  /** Canopy height in meters per cell (0 = no tree). */
  readonly canopy: Float32Array;

  constructor(readonly min: Vec2, readonly max: Vec2, readonly cell: number) {
    this.cols = Math.ceil((max[0] - min[0]) / cell);
    this.rows = Math.ceil((max[1] - min[1]) / cell);
    this.cls = new Uint8Array(this.cols * this.rows); // 0 = oob
    this.canopy = new Float32Array(this.cols * this.rows);
  }

  /** Works for a golf hole or a whole disc course; `ob` polygons are forced out of bounds last. */
  static fromHole(hole: SurfaceSource, cell = 0.25): SurfaceGrid {
    const g = new SurfaceGrid(hole.bounds[0], hole.bounds[1], cell);
    const rough = surfacePriority('rough');
    for (const b of hole.boundary) g.fill(b, (i) => { g.cls[i] = rough; });
    // Trees sit under everything else in priority, so fill them before features.
    const trees = surfacePriority('trees');
    for (const t of hole.trees) {
      g.fill(t.rings, (i) => {
        if (g.cls[i] === 0) return; // trees outside the course stay OOB for lies, but still block
        if (g.cls[i] <= trees) g.cls[i] = trees;
      });
      g.fill(t.rings, (i) => { g.canopy[i] = Math.max(g.canopy[i], t.height_m); });
    }
    const sorted = [...hole.features].sort((a, b) => surfacePriority(a.class) - surfacePriority(b.class));
    for (const f of sorted) {
      const p = surfacePriority(f.class);
      // Water and bunkers outside the boundary polygon still count as themselves.
      g.fill(f.rings, (i) => { if (p >= g.cls[i]) g.cls[i] = p; });
    }
    for (const rings of hole.ob ?? []) g.fill(rings, (i) => { g.cls[i] = 0; });
    return g;
  }

  private index(x: number, y: number): number {
    const c = Math.floor((x - this.min[0]) / this.cell);
    const r = Math.floor((y - this.min[1]) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  classAt(x: number, y: number): SurfaceClass {
    const i = this.index(x, y);
    return i < 0 ? 'oob' : SURFACE_CLASSES[this.cls[i]];
  }

  canopyAt(x: number, y: number): number {
    const i = this.index(x, y);
    return i < 0 ? 0 : this.canopy[i];
  }

  /** Scanline fill (even-odd across all rings) of cell centers inside the polygon. */
  fill(rings: Rings, visit: (i: number) => void): void {
    let minY = Infinity, maxY = -Infinity;
    for (const p of rings[0]) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const r0 = Math.max(0, Math.floor((minY - this.min[1]) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.ceil((maxY - this.min[1]) / this.cell));
    const xs: number[] = [];
    for (let r = r0; r <= r1; r++) {
      const y = this.min[1] + (r + 0.5) * this.cell;
      xs.length = 0;
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - this.min[0]) / this.cell - 0.5));
        const c1 = Math.min(this.cols - 1, Math.floor((xs[k + 1] - this.min[0]) / this.cell - 0.5));
        for (let c = c0; c <= c1; c++) visit(r * this.cols + c);
      }
    }
  }
}
