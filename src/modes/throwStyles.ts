// Throw styles (Settings → Dev): how a throw's power, and how cleanly it's released, come from the
// player's input. All of them run on one button (the throw key, or the swing button) plus, for the
// flick, the pointer. Times are performance.now() ms; nothing here touches the page.
//
//   classic    hold: the meter fills and empties; let go to throw (the base game)
//   two-stage  hold for power, let go, then press again as the needle sweeps back through the
//              release window: early pulls and hyzers, late pushes and turns it over
//   flick      hold, pull the pointer down (reach back), then flick it up: speed is power, the
//              flick's lean is where it goes
//   xstep      press to start the run-up, tap on the next two beats, press and hold on the third
//              (plant), let go to throw: the rhythm adds or costs distance and steadiness
import type { Execution } from '../disc/flight';
import { meterAt } from './discKit';

export type ThrowStyle = 'classic' | 'two-stage' | 'flick' | 'xstep';
export const THROW_STYLES: [ThrowStyle, string, string][] = [
  ['classic', '1 stage', 'Hold to fill the meter, let go to throw'],
  ['two-stage', '2 stage', 'Hold for power, let go, then press again as the needle crosses the window'],
  ['flick', 'Flick', 'Hold, pull the mouse (or finger) down, then flick it up'],
  ['xstep', 'X-step', 'Press, tap on the next two beats, hold on the third, let go to throw'],
];

export interface ThrowSetup {
  style: ThrowStyle;
  /** × meter speed (augments, hexes): the needle, the beat and the flick all speed up. */
  meterSpeed: number;
  putt: boolean;
  /** The disc's speed number: faster discs have a narrower release window. */
  discSpeed: number;
  /** Tomahawk, thumber, roller: a little less forgiving. */
  special: boolean;
  /** Muscling past 90% costs nothing (Run-Up, Golden Arm). */
  noOverpower: boolean;
}

export interface Release {
  power: number;
  /** Absent: the flight model's own wobble, as in the base game. */
  execution?: Execution;
  /** How it went, for a chip ("Clean release", "Late by 40 ms", "Rhythm 85%"). */
  note?: string;
}

/** What the HUD draws for the throw in progress. */
export interface ThrowView {
  fill: number;
  /** Two-stage: the sweeping needle and the window it should be stopped in (fractions of the bar). */
  needle?: number;
  window?: [number, number];
  /** X-step: each beat's progress (0 → 1 as it arrives) and how well it was hit (null: not yet). */
  beats?: { t: number; hit: number | null }[];
  hint: string;
}

/** Two-stage: where the release window sits on the bar, and how fast the needle sweeps (bars/s). */
export const SNAP = { center: 0.08, sweep: 1.3, half: 0.05, perSpeed: 0.004 };
/** Flick: upward speed for a full-power throw (CSS px/s), and travel that counts as a reach-back. */
export const FLICK = { full: 2200, minReach: 24 };
/** X-step: one beat (ms), and the window either side of a beat that counts as perfect. */
export const XSTEP = { beat: 420, perfect: 45 };

/** Two-stage window half-width: narrower for fast discs, special shots, and past 90% power. */
export function snapHalf(s: ThrowSetup, power: number): number {
  let h = SNAP.half + (14 - s.discSpeed) * SNAP.perSpeed;
  if (s.putt) h *= 1.4;
  if (s.special) h *= 0.85;
  if (!s.noOverpower) h *= 1 - 0.6 * Math.max(0, (power - 0.9) / 0.1);
  return h;
}

/**
 * Two-stage: e = how far from the window's middle the needle was stopped, in half-widths (+ early,
 * − late). Inside the window (|e| ≤ 1) barely moves the throw; past it, each half-width more pulls
 * or pushes ~3° and adds hyzer or turn. Putts move a lot less.
 */
export function snapExecution(e: number, putt: boolean): Execution {
  const a = Math.abs(e), sgn = Math.sign(e);
  const yaw = sgn * Math.min(10, a <= 1 ? a * 1.2 : 1.2 + (a - 1) * 3);
  const bank = sgn * Math.min(0.3, a <= 1 ? a * 0.02 : 0.02 + (a - 1) * 0.06);
  return putt ? { yaw: yaw * 0.4, bank: bank * 0.3, wobble: 0.5 } : { yaw, bank, wobble: 0.5 };
}

/** X-step: how well a press landed on its beat, 0..1 (off: ms from the beat). */
export function beatScore(off: number, beat: number): number {
  const a = Math.abs(off);
  return a <= XSTEP.perfect ? 1 : Math.max(0, 1 - (a - XSTEP.perfect) / (0.4 * beat));
}

type Stage =
  | { k: 'idle' }
  | { k: 'power'; t0: number }
  | { k: 'snap'; t0: number; power: number }
  | { k: 'flick'; t0: number; origin: [number, number]; bottom: [number, number]; tBottom: number; up: boolean; pts: [number, number, number][] }
  | { k: 'steps'; t0: number; hits: number[] }
  | { k: 'plant'; t0: number; hits: number[] };

/** One throw's input, start to release. A result of 'cancel' means the throw was called off. */
export class ThrowControl {
  private stage: Stage = { k: 'idle' };
  private pointer: [number, number] = [0, 0];
  constructor(private readonly s: ThrowSetup) {}

  /** Putts don't get a run-up: X-step putts are thrown the classic way. */
  private get style(): ThrowStyle { return this.s.style === 'xstep' && this.s.putt ? 'classic' : this.s.style; }
  private get beat(): number { return XSTEP.beat / this.s.meterSpeed; }
  get active(): boolean { return this.stage.k !== 'idle'; }

  /** The throw button went down. */
  press(now: number): Release | 'cancel' | null {
    const st = this.stage;
    if (st.k === 'idle') {
      if (this.style === 'flick') this.stage = { k: 'flick', t0: now, origin: [...this.pointer], bottom: [...this.pointer], tBottom: now, up: false, pts: [] };
      else if (this.style === 'xstep') this.stage = { k: 'steps', t0: now, hits: [] };
      else this.stage = { k: 'power', t0: now };
      return null;
    }
    if (st.k === 'snap') return this.snap(now, st);
    if (st.k === 'steps') {
      // This press is for the next beat: steps on beats 1 and 2, the plant on beat 3.
      const k = st.hits.length + 1;
      st.hits.push(beatScore(now - (st.t0 + k * this.beat), this.beat));
      if (k === 3) this.stage = { k: 'plant', t0: now, hits: st.hits };
    }
    return null;
  }

  /** The throw button came up. */
  release(now: number): Release | 'cancel' | null {
    const st = this.stage;
    if (st.k === 'power') {
      const power = this.fillAt(now);
      if (this.style === 'two-stage') {
        if (power < 0.02) { this.stage = { k: 'idle' }; return 'cancel'; }
        this.stage = { k: 'snap', t0: now, power };
        return null;
      }
      this.stage = { k: 'idle' };
      return { power };
    }
    if (st.k === 'flick') {
      this.stage = { k: 'idle' };
      return st.up ? this.flickRelease(now, st) : 'cancel';
    }
    if (st.k === 'plant') {
      this.stage = { k: 'idle' };
      const rhythm = st.hits.reduce((a, b) => a + b, 0) / 3;
      const fill = meterAt(now - st.t0, this.s.meterSpeed);
      return { power: fill * (0.9 + 0.2 * rhythm), execution: { yaw: 0, bank: 0, wobble: 1 + (1 - rhythm) * 0.8 }, note: `Rhythm ${Math.round(rhythm * 100)}%` };
    }
    return null;
  }

  /** The pointer moved (CSS px, page coordinates). */
  move(x: number, y: number, now: number): Release | null {
    this.pointer = [x, y];
    const st = this.stage;
    if (st.k !== 'flick') return null;
    st.pts.push([x, y, now]);
    if (st.pts.length > 12) st.pts.shift();
    if (!st.up) {
      if (y >= st.bottom[1]) { st.bottom = [x, y]; st.tBottom = now; }
      // Coming back up after a real reach-back: the flick has started.
      else if (st.bottom[1] - st.origin[1] >= FLICK.minReach && st.bottom[1] - y > 6) st.up = true;
      return null;
    }
    // Back up past where it started: that's the release.
    if (y <= st.origin[1]) { this.stage = { k: 'idle' }; return this.flickRelease(now, st); }
    return null;
  }

  /** Called every frame: the HUD's view, and a release if the throw ran out of time. */
  frame(now: number): { view: ThrowView; done?: Release } {
    const st = this.stage;
    switch (st.k) {
      case 'idle': return { view: { fill: 0, hint: '' } };
      case 'power': return { view: { fill: this.fillAt(now), hint: this.style === 'two-stage' ? 'Let go to set the power' : '' } };
      case 'snap': {
        const needle = this.needleAt(now, st);
        const h = snapHalf(this.s, st.power);
        // The needle ran off the end: nobody pressed, a shank.
        if (needle < -0.12) { this.stage = { k: 'idle' }; return { view: { fill: st.power, hint: '' }, done: this.snapRelease(-0.12, st) }; }
        return { view: { fill: st.power, needle, window: [SNAP.center - h, SNAP.center + h], hint: 'Press as the needle crosses the window' } };
      }
      case 'flick': {
        const speed = this.upSpeed(st.pts);
        return { view: { fill: st.up ? Math.min(1, speed / this.full) : 0, hint: st.up ? 'Flick!' : 'Pull down, then flick up' } };
      }
      case 'steps': {
        const beats = [1, 2, 3].map((k) => ({ t: Math.min(1, Math.max(0, (now - st.t0) / (k * this.beat))), hit: st.hits[k - 1] ?? null }));
        // A missed beat counts as a stumble; a missed plant plants anyway.
        const due = st.hits.length + 1;
        if (now > st.t0 + (due + 0.5) * this.beat) {
          st.hits.push(0);
          if (due === 3) this.stage = { k: 'plant', t0: now, hits: st.hits };
        }
        return { view: { fill: 0, beats, hint: due < 3 ? 'Tap on the beat' : 'Hold on the beat' } };
      }
      case 'plant': return { view: { fill: meterAt(now - st.t0, this.s.meterSpeed), beats: st.hits.map((hit) => ({ t: 1, hit })), hint: '' } };
    }
  }

  /** Called off from outside (the turn moved on, the window lost focus). */
  cancel(): void { this.stage = { k: 'idle' }; }

  private fillAt(now: number): number {
    const st = this.stage;
    return st.k === 'power' ? meterAt(now - st.t0, this.s.meterSpeed) : 0;
  }
  private needleAt(now: number, st: Extract<Stage, { k: 'snap' }>): number {
    return st.power - ((now - st.t0) / 1000) * SNAP.sweep * this.s.meterSpeed;
  }
  private snap(now: number, st: Extract<Stage, { k: 'snap' }>): Release {
    this.stage = { k: 'idle' };
    return this.snapRelease(this.needleAt(now, st), st);
  }
  private snapRelease(needle: number, st: Extract<Stage, { k: 'snap' }>): Release {
    const e = (needle - SNAP.center) / snapHalf(this.s, st.power);
    const ms = Math.round(Math.abs(needle - SNAP.center) / (SNAP.sweep * this.s.meterSpeed) * 1000);
    return { power: st.power, execution: snapExecution(e, this.s.putt), note: Math.abs(e) <= 1 ? 'Clean release' : `${e > 0 ? 'Early' : 'Late'} by ${ms} ms` };
  }

  private get full(): number { return FLICK.full * this.s.meterSpeed * (this.s.putt ? 0.7 : 1); }
  /** Upward speed over the last few pointer samples (px/s). */
  private upSpeed(pts: [number, number, number][]): number {
    const recent = pts.filter((p) => p[2] >= (pts.at(-1)?.[2] ?? 0) - 80);
    if (recent.length < 2) return 0;
    const a = recent[0], b = recent.at(-1)!;
    return b[2] > a[2] ? ((a[1] - b[1]) / (b[2] - a[2])) * 1000 : 0;
  }
  private flickRelease(now: number, st: Extract<Stage, { k: 'flick' }>): Release {
    // Power: the flick's speed from the bottom of the reach-back. Faster than full is muscled.
    const [x, y] = this.pointer;
    const dt = Math.max(16, now - st.tBottom);
    const speed = Math.max(this.upSpeed(st.pts), ((st.bottom[1] - y) / dt) * 1000);
    const k = speed / this.full;
    // Direction: the flick's lean off vertical. Leaning right pushes it right.
    const lean = (Math.atan2(x - st.bottom[0], Math.max(1, st.bottom[1] - y)) * 180) / Math.PI;
    const yaw = Math.max(-10, Math.min(10, -lean * 0.3)) * (this.s.putt ? 0.4 : 1);
    const over = this.s.noOverpower ? 0 : Math.max(0, k - 1);
    return { power: Math.min(1, k), execution: { yaw, bank: 0, wobble: 0.6 + Math.min(2, over * 2) }, note: k > 1 ? 'Muscled it' : `${Math.round(Math.min(1, k) * 100)}% flick` };
  }
}
