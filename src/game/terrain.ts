// Terrain is an interface so lidar heightmaps can replace FlatTerrain later (docs/07-elevation-lidar.md).
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
