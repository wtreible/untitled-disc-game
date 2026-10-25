// Terrain: flat for the arcade courses, a lidar heightmap for the real ones (docs/07-elevation-lidar.md).
export type Vec3 = [number, number, number];

export interface Terrain {
  heightAt(x: number, y: number): number;
  normalAt(x: number, y: number): Vec3;
}

export class FlatTerrain implements Terrain {
  heightAt(): number {
    return 0;
  }
  normalAt(): Vec3 {
    return [0, 0, 1];
  }
}

/** A real course's ground: heights (m) on a grid, bilinear between cells, flat past the edges. */
export class HeightmapTerrain implements Terrain {
  constructor(readonly heights: Float32Array, readonly cols: number, readonly rows: number, readonly min: [number, number], readonly cell: number) {}

  /** From scripts/build-elevation.ts's file: Uint16 centimeters, row by row from the south-west. */
  static fromCentimeters(buf: ArrayBuffer, g: { cols: number; rows: number; min: [number, number]; cell: number }): HeightmapTerrain {
    const cm = new Uint16Array(buf);
    if (cm.length !== g.cols * g.rows) throw new Error(`Heightmap is ${cm.length} cells, expected ${g.cols}×${g.rows}`);
    const h = new Float32Array(cm.length);
    for (let i = 0; i < cm.length; i++) h[i] = cm[i] / 100;
    return new HeightmapTerrain(h, g.cols, g.rows, g.min, g.cell);
  }

  heightAt(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1, (x - this.min[0]) / this.cell));
    const fy = Math.max(0, Math.min(this.rows - 1, (y - this.min[1]) / this.cell));
    const i = Math.min(this.cols - 2, Math.floor(fx)), j = Math.min(this.rows - 2, Math.floor(fy)), tx = fx - i, ty = fy - j;
    const h = this.heights, k = j * this.cols + i;
    return (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - ty) + (h[k + this.cols] * (1 - tx) + h[k + this.cols + 1] * tx) * ty;
  }

  normalAt(x: number, y: number): Vec3 {
    const d = this.cell;
    const gx = (this.heightAt(x + d, y) - this.heightAt(x - d, y)) / (2 * d);
    const gy = (this.heightAt(x, y + d) - this.heightAt(x, y - d)) / (2 * d);
    const n = Math.hypot(gx, gy, 1);
    return [-gx / n, -gy / n, 1 / n];
  }
}
