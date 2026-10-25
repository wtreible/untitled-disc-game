// When a throw makes noise. The flight model doesn't timestamp its events, so the cues are read
// back off the samples (60 Hz): a sudden change of velocity is a hit, the first touch of the
// ground is the landing, and getting near the basket is chains or metal. Played as the disc
// passes each cue, live and again in the replay.
import type { Vec2 } from '../course/geo';
import type { SurfaceClass } from '../course/types';
import type { Mark, ThrowEvent } from '../disc/flight';
import type { Vec3 } from '../game/terrain';

/** `mark`: an augment at work (the flight model's marks), shown and sometimes heard. */
export type CueSound = 'tree' | 'branch' | 'bonk' | 'chains' | 'clank' | 'land' | 'splash' | 'ob' | 'mark';

export interface Cue {
  /** Sample index (60 Hz) at which it plays. */
  k: number;
  sound: CueSound;
  /** Where it happens (for distance falloff). */
  at: Vec3;
  /** Landing: what it landed on. */
  surface?: SurfaceClass;
  /** An augment at work ('mark' cues). */
  mark?: Mark;
}

/** What a cue needs from a throw (a ThrowResult or its wire form). */
interface Throw {
  samples: Vec3[];
  holed: boolean;
  events: ThrowEvent[];
  restSurface: SurfaceClass;
  propHits?: string[];
}

/** Velocity change (m/s) between consecutive samples that counts as a hit (gravity is ~0.16). */
const HIT_DV = 2.5;
/** A kick this hard is a trunk (or a prop); softer is branches. */
const TRUNK_DV = 7;
/** Within this of the pin (horizontally), a hit is the basket. */
const BASKET_R = 0.9;
/** Below this the disc is on the ground (a roller rides at its radius). */
const ON_GROUND = 0.13;
/** Quiet time after a hit, in samples, so one crown full of branches isn't a drum roll. */
const DEBOUNCE = 8;

/** `ground`: the ground height (real courses); heights are read above it. */
export function throwCues(r: Throw, pin: Vec2, surfaceAt: (x: number, y: number) => SurfaceClass, ground: (x: number, y: number) => number = () => 0): Cue[] {
  const s = r.samples;
  const up = (p: Vec3) => p[2] - ground(p[0], p[1]);
  const pinZ = ground(pin[0], pin[1]);
  const cues: Cue[] = [];
  const nearPin = (p: Vec3) => Math.hypot(p[0] - pin[0], p[1] - pin[1]) < BASKET_R;
  const caught = r.holed || r.events.some((e) => e === 'chains' || e === 'spit' || e === 'cut');
  const props = (r.propHits?.length ?? 0) > 0 && !r.events.some((e) => e === 'trunk' || e === 'branch');
  let basket = false, landed = false, quietUntil = -1;
  for (let k = 1; k < s.length; k++) {
    const p = s[k];
    const a = s[Math.max(0, k - 2)], b = s[k - 1];
    const dv = k < 2 ? 0 : 60 * Math.hypot(p[0] - 2 * b[0] + a[0], p[1] - 2 * b[1] + a[1], p[2] - 2 * b[2] + a[2]);
    // Into the chains (or a tap-in), or off the band, tray or pole.
    if (!basket && nearPin(p) && p[2] - pinZ > ON_GROUND && p[2] - pinZ < 1.7 && (caught || dv >= HIT_DV)) {
      basket = true;
      cues.push({ k, sound: caught ? 'chains' : 'clank', at: p });
      quietUntil = k + DEBOUNCE * 2;
      continue;
    }
    if (!landed && up(p) < ON_GROUND && up(b) >= ON_GROUND) {
      landed = true;
      const surface = surfaceAt(p[0], p[1]);
      cues.push({ k, sound: surface === 'water' ? 'splash' : 'land', at: p, surface });
      continue;
    }
    if (landed || k <= quietUntil || dv < HIT_DV || nearPin(p)) continue;
    cues.push({ k, sound: props ? 'bonk' : dv > TRUNK_DV ? 'tree' : 'branch', at: p });
    quietUntil = k + DEBOUNCE;
  }
  // OB: the buzzer goes when it comes to rest (water has splashed already).
  if (r.events.some((e) => e === 'oob' || e === 'mando' || e === 'island')) cues.push({ k: s.length - 1, sound: 'ob', at: s[s.length - 1] });
  return cues;
}
