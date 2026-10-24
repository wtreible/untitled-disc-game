// Ghost discs: the best tee shot this browser has thrown on each hole, kept to fly alongside the
// next one (Settings → Ghost disc). Best is holed, else the nearest the basket. Flights are stored
// packed, like throws on the wire (src/net/wire.ts): a couple of kB a hole.
import type { Vec2 } from '../course/geo';
import { packTrack, unpackTrack } from '../net/wire';
import type { Vec3 } from './terrain';

export interface GhostFlight {
  samples: Vec3[];
  holed: boolean;
  /** Where it stopped, m from the basket (0 if holed). */
  off: number;
}

const KEY = 'untitled-disc-game:ghosts';
type Stored = Record<string, { s: number[]; holed: boolean; off: number; at: number }>;

function load(): Stored {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Stored; } catch { return {}; }
}

/** A hole's key: the course and the hole's own number. */
export const ghostKey = (course: string, ref: string) => `${course}:${ref}`;

/** The ghost for a hole, if one was saved. */
export function loadGhost(key: string): GhostFlight | null {
  const g = load()[key];
  return g ? { samples: unpackTrack(g.s, 3) as Vec3[], holed: g.holed, off: g.off } : null;
}

/** Is a throw ending `holed` / `off` m out better than the ghost? (No ghost: yes.) */
export const beats = (r: { holed: boolean; off: number }, g: { holed: boolean; off: number } | null): boolean =>
  !g || (r.holed && !g.holed) || (r.holed === g.holed && r.off < g.off - 0.005);

/** Keep a tee shot if it beats the hole's ghost. True: it's the new ghost. */
export function offerGhost(key: string, samples: Vec3[], rest: Vec2, pin: Vec2, holed: boolean): boolean {
  const off = holed ? 0 : Math.round(Math.hypot(rest[0] - pin[0], rest[1] - pin[1]) * 100) / 100;
  const all = load();
  if (!beats({ holed, off }, all[key] ?? null)) return false;
  all[key] = { s: packTrack(samples, 3), holed, off, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { return false; } // full or unavailable
  return true;
}
