// The ground the 3D world stands on: the course's terrain (flat on the arcade courses). One course
// is drawn at a time, so the scene sets it once and everything placed "on the ground" reads it.
import type { Terrain } from '../game/terrain';

let terrain: Terrain | null = null;

export function setGround(t: Terrain | null): void {
  terrain = t;
}

/** Ground height (m) at x, y. */
export function groundAt(x: number, y: number): number {
  return terrain ? terrain.heightAt(x, y) : 0;
}
