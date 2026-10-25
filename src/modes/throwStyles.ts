// Throw styles (Settings → Dev): how a throw's power, and how cleanly it's released, come from the
// player's input. All of them run on one button (the throw key, or the swing button) plus, for the
// flick, the pointer. Times are performance.now() ms; nothing here touches the page.
//
//   classic    hold: the meter fills and empties; let go to throw (the base game)
//   two-stage  hold for power, let go, then press again as the needle sweeps back into the SNAP
//              window: early pulls and hyzers, late pushes and turns it over. Putts instead get a
//              breathing reticle on the basket: press again while it's small
//   flick      press, and a slice appears at the pointer: swipe out through it. How fast is power;
//              where it leaves the slice is where it goes, and out the side is a shank
//   xstep      press to start the run-up, then press as the cursor crosses each beat of the
//              timeline: tap, tap, hold on the last; let go to throw. The rhythm adds or costs
//              distance and steadiness
import type { Execution } from '../disc/flight';
import { meterAt } from './discKit';

export type ThrowStyle = 'classic' | 'two-stage' | 'flick' | 'xstep';
export const THROW_STYLES: [ThrowStyle, string, string][] = [
  ['classic', '1 stage', 'Hold to fill the meter, let go to throw'],
  ['two-stage', '2 stage', 'Hold for power, let go, then press again as the needle reaches the SNAP window (putts: when the reticle is smallest)'],
  ['flick', 'Flick', 'Press the throw key, then swipe the mouse (or finger) out through the slice: faster is farther, stay inside it'],
  ['xstep', 'X-step', 'Press to start, then press as the cursor crosses each beat: tap, tap, hold, and let go to throw'],
];

/** The styles that can be picked for now; the others are greyed out in Settings → Dev until they're right. */
export const ENABLED_STYLES: ThrowStyle[] = ['classic'];
/** The style a throw uses: the chosen one if it's enabled, else 1 stage. */
export const usableStyle = (s: ThrowStyle): ThrowStyle => (ENABLED_STYLES.includes(s) ? s : 'classic');

export interface ThrowSetup {
  style: ThrowStyle;
  /** × meter speed (augments, hexes): the needle, the beat, the reticle and the flick all speed up. */
  meterSpeed: number;
  putt: boolean;
  /** The disc's speed number: faster discs have a narrower release window. */
  discSpeed: number;
  /** Tomahawk, thumber, roller: a little less forgiving. */
  special: boolean;
  /** Muscling past 90% costs nothing (Run-Up, Golden Arm). */
  noOverpower: boolean;
  /** No room for a run-up (under the trees): X-step throws go the 1-stage way. */
  standstill?: boolean;
  /** × every window and slice (Clean Release widens them, Jitters narrows them). Default 1. */
  timing?: number;
  /** A forehand (mirrored throw): a flick's screen direction is absolute, so it's mirrored back. */
  mirror?: boolean;
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
  /** Two-stage: the sweeping needle and the SNAP window it should be stopped in (fractions of the bar). */
  needle?: number;
  window?: [number, number];
  /** X-step: the timeline. The cursor and each beat as fractions of it; each beat's hit (null: not yet). */
  track?: { cursor: number; beats: { at: number; hit: number | null; hold: boolean }[] };
  /** Flick: the slice, anchored where the pointer was (CSS px). `reach` 0..1 of the way out; `angle` off its middle (rad, + right). */
  wedge?: { at: [number, number]; half: number; r0: number; R: number; reach: number; angle: number; started: boolean };
  /** Two-stage putts: the reticle's size, 0 (tight) … 1 (wide). */
  reticle?: number;
  hint: string;
}

/** Two-stage: where the SNAP window sits on the bar, and how fast the needle sweeps (bars/s). */
export const SNAP = { center: 0.15, sweep: 1.3, half: 0.05, perSpeed: 0.004 };
/** Flick: the slice's half-angle, its inner and outer radius (CSS px), and the swipe speed through it for full power (px/s). */
export const FLICK = { half: (26 * Math.PI) / 180, r0: 18, R: 170, full: 1500 };
/** X-step: one beat (ms), the window either side of a beat that counts as perfect, and the timeline's length (beats). */
export const XSTEP = { beat: 420, perfect: 45, span: 3.6 };
/** Two-stage putts: the reticle's breath (ms per cycle), and how long before it lets go on its own. */
export const RETICLE = { period: 1300, timeout: 4000 };

const timingOf = (s: ThrowSetup) => s.timing ?? 1;

/** Two-stage window half-width: narrower for fast discs, special shots, and past 90% power. */
export function snapHalf(s: ThrowSetup, power: number): number {
  let h = (SNAP.half + (14 - s.discSpeed) * SNAP.perSpeed) * timingOf(s);
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
export function beatScore(off: number, beat: number, timing = 1): number {
  const a = Math.abs(off), perfect = XSTEP.perfect * timing;
  return a <= perfect ? 1 : Math.max(0, 1 - (a - perfect) / (0.4 * beat * timing));
}

/** Two-stage putts: the reticle at time t into its breathing, 0 (tight) … 1 (wide). The tightest it gets shrinks with timing. */
export function reticleAt(ms: number, s: ThrowSetup): number {
  const min = 0.25 / timingOf(s);
  return min + (1 - min) * Math.abs(Math.sin((Math.PI * ms * s.meterSpeed) / RETICLE.period));
}

type Stage =
  | { k: 'idle' }
  | { k: 'power'; t0: number }
  | { k: 'snap'; t0: number; power: number }
  | { k: 'steady'; t0: number; power: number }
  | { k: 'flick'; t0: number; origin: [number, number]; tIn: number | null }
  | { k: 'steps'; t0: number; hits: number[] }
  | { k: 'plant'; t0: number; hits: number[] };

/** One throw's input, start to release. A result of 'cancel' means the throw was called off. */
export class ThrowControl {
  private stage: Stage = { k: 'idle' };
  private pointer: [number, number] = [0, 0];
  constructor(private readonly s: ThrowSetup) {}

  /** Putts and standstill throws don't get a run-up: X-step goes the classic way. */
  private get style(): ThrowStyle { return this.s.style === 'xstep' && (this.s.putt || this.s.standstill) ? 'classic' : this.s.style; }
  private get beat(): number { return XSTEP.beat / this.s.meterSpeed; }
  private get half(): number { return Math.min(Math.PI / 2.2, FLICK.half * timingOf(this.s) * (this.s.putt ? 1.3 : 1)); }
  get active(): boolean { return this.stage.k !== 'idle'; }

  /** The throw button went down. */
  press(now: number): Release | 'cancel' | null {
    const st = this.stage;
    if (st.k === 'idle') {
      if (this.style === 'flick') this.stage = { k: 'flick', t0: now, origin: [...this.pointer], tIn: null };
      else if (this.style === 'xstep') this.stage = { k: 'steps', t0: now, hits: [] };
      else this.stage = { k: 'power', t0: now };
      return null;
    }
    if (st.k === 'snap') return this.snap(now, st);
    if (st.k === 'steady') { this.stage = { k: 'idle' }; return this.steadyRelease(now, st); }
    if (st.k === 'steps') {
      // This press is for the next beat: steps on beats 1 and 2, the plant (hold) on beat 3.
      const k = st.hits.length + 1;
      st.hits.push(beatScore(now - (st.t0 + k * this.beat), this.beat, timingOf(this.s)));
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
        this.stage = this.s.putt ? { k: 'steady', t0: now, power } : { k: 'snap', t0: now, power };
        return null;
      }
      this.stage = { k: 'idle' };
      return { power };
    }
    if (st.k === 'flick') {
      // Let go mid-swipe: thrown with the swipe so far; before it started, called off.
      this.stage = { k: 'idle' };
      return st.tIn === null ? 'cancel' : this.flickRelease(now, st);
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
    const [d, a] = this.polar(st.origin);
    if (st.tIn === null) {
      if (d < FLICK.r0) return null;
      // Out of the tip backwards: the slice follows the pointer, nothing's started.
      if (Math.abs(a) > Math.PI / 2) { st.origin = [x - (FLICK.r0 * 0.5) * Math.sin(a), y + (FLICK.r0 * 0.5) * Math.cos(a)]; return null; }
      st.tIn = now;
      // Started off to the side, outside the slice: a shank straight away.
      if (Math.abs(a) > this.half) { this.stage = { k: 'idle' }; return this.flickRelease(now, st); }
      return null;
    }
    // Out through the side, or past the end: that's the release.
    if (Math.abs(a) > this.half || d >= FLICK.R) { this.stage = { k: 'idle' }; return this.flickRelease(now, st); }
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
        return { view: { fill: st.power, needle, window: [SNAP.center - h, SNAP.center + h], hint: 'Press as the needle hits SNAP' } };
      }
      case 'steady': {
        if (now - st.t0 > RETICLE.timeout) { this.stage = { k: 'idle' }; return { view: { fill: st.power, hint: '' }, done: this.steadyRelease(now, st) }; }
        return { view: { fill: st.power, reticle: reticleAt(now - st.t0, this.s), hint: 'Press when the circle is smallest' } };
      }
      case 'flick': {
        const [d, a] = this.polar(st.origin);
        const started = st.tIn !== null;
        const speed = started ? (Math.max(0, d - FLICK.r0) / Math.max(16, now - st.tIn!)) * 1000 : 0;
        return { view: { fill: Math.min(1, speed / this.full), wedge: { at: st.origin, half: this.half, r0: FLICK.r0, R: FLICK.R, reach: Math.min(1, d / FLICK.R), angle: a, started }, hint: started ? 'Swipe!' : 'Swipe out through the slice' } };
      }
      case 'steps': {
        // A missed beat counts as a stumble; a missed plant plants anyway.
        const due = st.hits.length + 1;
        if (now > st.t0 + (due + 0.5) * this.beat) {
          st.hits.push(0);
          if (due === 3) this.stage = { k: 'plant', t0: now, hits: st.hits };
        }
        return { view: { fill: 0, track: this.track(now, st.t0, st.hits), hint: due < 3 ? 'Press on the beat' : 'Press and hold on the last beat' } };
      }
      case 'plant': return { view: { fill: meterAt(now - st.t0, this.s.meterSpeed), track: this.track(now, st.t0, st.hits, true), hint: 'Let go to throw' } };
    }
  }

  /** Called off from outside (the turn moved on, the window lost focus). */
  cancel(): void { this.stage = { k: 'idle' }; }

  private track(now: number, t0: number, hits: number[], done = false): NonNullable<ThrowView['track']> {
    const span = XSTEP.span * this.beat;
    return {
      cursor: done ? 3 / XSTEP.span : Math.min(1, (now - t0) / span),
      beats: [1, 2, 3].map((k) => ({ at: k / XSTEP.span, hit: hits[k - 1] ?? null, hold: k === 3 })),
    };
  }
  /** The pointer from `o`: distance (px) and angle off straight up (rad, + to the right). */
  private polar(o: [number, number]): [number, number] {
    const dx = this.pointer[0] - o[0], dy = o[1] - this.pointer[1];
    return [Math.hypot(dx, dy), Math.atan2(dx, dy)];
  }
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
  private steadyRelease(now: number, st: Extract<Stage, { k: 'steady' }>): Release {
    // The reticle's size is the wobble: tight is half the usual, wide is half again more.
    const r = reticleAt(now - st.t0, this.s);
    return { power: st.power, execution: { yaw: 0, bank: 0, wobble: 0.5 + r }, note: r < 0.4 ? 'Steady' : r < 0.7 ? 'A little shaky' : 'Shaky' };
  }

  private get full(): number { return FLICK.full * this.s.meterSpeed * (this.s.putt ? 0.7 : 1); }
  private flickRelease(now: number, st: Extract<Stage, { k: 'flick' }>): Release {
    // Power: how fast it went through the slice. Faster than full is muscled.
    const [d, a] = this.polar(st.origin);
    const speed = (Math.max(0, d - FLICK.r0) / Math.max(16, now - (st.tIn ?? now))) * 1000;
    const k = speed / this.full;
    // Direction: where it left the slice, off its middle (right pushes right). Out the side: a shank.
    const out = Math.abs(a) > this.half;
    const f = Math.max(-1, Math.min(1, a / this.half));
    const toRight = out ? Math.sign(a) * 10 : f * 6;
    const yaw = -toRight * (this.s.mirror ? -1 : 1) * (this.s.putt ? 0.4 : 1);
    const over = this.s.noOverpower ? 0 : Math.max(0, k - 1);
    const wobble = (out ? 2.2 : 0.6) + Math.min(2, over * 2);
    const note = out ? 'Out of the slice: shanked' : k > 1 ? 'Muscled it' : `${Math.round(Math.min(1, k) * 100)}% swipe`;
    return { power: Math.min(1, k), execution: { yaw, bank: 0, wobble }, note };
  }
}
