// Throw styles (Settings → Dev): how a throw's power, and how cleanly it's released, come from the
// player's input. They run on one button (the throw key, or the swing button), except the flick,
// which is a swing of the pointer. Times are performance.now() ms; nothing here touches the page.
//
//   classic    hold: the meter fills and empties; let go to throw (the base game)
//   two-stage  hold for power, let go, then press again as the needle sweeps back into the SNAP
//              window: early pulls and hyzers, late pushes and turns it over. Putts instead get a
//              breathing reticle on the basket: press again while it's small
//   flick      press on the course, pull back, swipe up and let go, as in a golf game. The swing's
//              speed as it's let go is power; its direction then is accuracy, and outside the fan
//              is a shank
//   xstep      press to start the run-up, then press as the cursor crosses each beat of the
//              timeline: tap, tap, hold on the last; let go to throw. The rhythm adds or costs
//              distance and steadiness
import type { Execution } from '../disc/flight';
import { meterAt } from './discKit';

export type ThrowStyle = 'classic' | 'two-stage' | 'flick' | 'xstep';
export const THROW_STYLES: [ThrowStyle, string, string][] = [
  ['classic', '1 stage', 'Hold to fill the meter, let go to throw'],
  ['two-stage', '2 stage', 'Hold for power, let go, then press again as the needle reaches the SNAP window (putts: when the reticle is smallest)'],
  ['flick', 'Flick', 'Press on the course, pull back, then swipe up and let go: faster is farther, straight up is straight'],
  ['xstep', 'X-step', 'Press to start, then press as the cursor crosses each beat: tap, tap, hold, and let go to throw'],
];

/** The styles that can be picked for now; the others are greyed out in Settings → Dev until they're right. */
export const ENABLED_STYLES: ThrowStyle[] = ['classic', 'two-stage', 'flick', 'xstep'];
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
  /** Flick: the fan, anchored at the bottom of the backswing (CSS px), and the swing's trail. `angle`: the swing's direction now, off straight up (rad, + right); null before it's swinging up. */
  flick?: { at: [number, number]; half: number; R: number; trail: [number, number][]; started: boolean; angle: number | null };
  /** Two-stage putts: the reticle's size, 0 (tight) … 1 (wide). */
  reticle?: number;
  hint: string;
}

/** Two-stage: where the SNAP window sits on the bar, how fast the needle sweeps (bars/s), and where it runs out (a shank). */
export const SNAP = { center: 0.15, sweep: 1.3, half: 0.05, perSpeed: 0.004, runout: -0.12 };
/** Two-stage: the stretch of the bar its timing lane shows, the SNAP window in the middle. */
export const SNAP_LANE: [number, number] = [SNAP.runout, 2 * SNAP.center - SNAP.runout];
/**
 * Flick: the fan's half-angle; how far up from the bottom of the backswing counts as swinging (CSS px);
 * the fan's drawn length; the swing speed for full power (px/s); the stretch of the swing its speed
 * is read over at release (ms); the slowest release that counts (× full); and the dead-straight band (rad).
 */
export const FLICK = { half: (26 * Math.PI) / 180, r0: 18, R: 170, full: 1500, window: 80, slowest: 0.08, straight: (2.5 * Math.PI) / 180 };
/** X-step: one beat (ms), the window either side of a beat that counts as perfect, and the timeline's length (beats). */
export const XSTEP = { beat: 420, perfect: 45, span: 3.6 };
/** Two-stage putts: the reticle's breath (ms per cycle), and how long before it lets go on its own. */
export const RETICLE = { period: 1300, timeout: 4000 };

const timingOf = (s: ThrowSetup) => s.timing ?? 1;

/** The style a throw is actually input with: putts and standstill throws have no run-up, so X-step goes the 1-stage way. */
export const styleFor = (s: ThrowSetup): ThrowStyle => (s.style === 'xstep' && (s.putt || s.standstill) ? 'classic' : s.style);

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

/** X-step's beats on the timeline: steps on 1 and 2, the plant (hold) on 3; each one's hit so far. */
const beatsOf = (hits: number[]) => [1, 2, 3].map((k) => ({ at: k / XSTEP.span, hit: hits[k - 1] ?? null, hold: k === 3 }));

/** What the HUD shows for a style before the throw starts: the lanes it'll use, empty. `power`: what's lined up (the target tick). */
export function idleView(s: ThrowSetup, power: number): ThrowView {
  const style = styleFor(s);
  if (style === 'two-stage' && !s.putt) { const h = snapHalf(s, power); return { fill: 0, window: [SNAP.center - h, SNAP.center + h], hint: '' }; }
  if (style === 'xstep') return { fill: 0, track: { cursor: 0, beats: beatsOf([]) }, hint: '' };
  return { fill: 0, hint: '' };
}

type Stage =
  | { k: 'idle' }
  | { k: 'power'; t0: number }
  | { k: 'snap'; t0: number; power: number }
  | { k: 'steady'; t0: number; power: number }
  | { k: 'flick'; t0: number; at: [number, number]; trail: [number, number, number][]; from: number | null }
  | { k: 'steps'; t0: number; hits: number[] }
  | { k: 'plant'; t0: number; hits: number[] };

/** One throw's input, start to release. A result of 'cancel' means the throw was called off. */
export class ThrowControl {
  private stage: Stage = { k: 'idle' };
  private pointer: [number, number] = [0, 0];
  constructor(private readonly s: ThrowSetup) {}

  /** The style this throw is input with. */
  get style(): ThrowStyle { return styleFor(this.s); }
  private get beat(): number { return XSTEP.beat / this.s.meterSpeed; }
  private get half(): number { return Math.min(Math.PI / 2.2, FLICK.half * timingOf(this.s) * (this.s.putt ? 1.3 : 1)); }
  get active(): boolean { return this.stage.k !== 'idle'; }

  /** The throw button went down. */
  press(now: number): Release | 'cancel' | null {
    const st = this.stage;
    if (st.k === 'idle') {
      if (this.style === 'flick') this.stage = { k: 'flick', t0: now, at: [...this.pointer], trail: [[...this.pointer, now]], from: null };
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
      // Let go before swinging up, or with the swing stopped: called off.
      this.stage = { k: 'idle' };
      return this.flickRelease(now, st) ?? 'cancel';
    }
    if (st.k === 'plant') {
      this.stage = { k: 'idle' };
      const rhythm = st.hits.reduce((a, b) => a + b, 0) / 3;
      const fill = meterAt(now - st.t0, this.s.meterSpeed);
      return { power: fill * (0.9 + 0.2 * rhythm), execution: { yaw: 0, bank: 0, wobble: 1 + (1 - rhythm) * 0.8 }, note: `Rhythm ${Math.round(rhythm * 100)}%` };
    }
    return null;
  }

  /** The pointer moved (CSS px, page coordinates). The flick lets go on the button, so this never releases. */
  move(x: number, y: number, now: number): Release | null {
    this.pointer = [x, y];
    const st = this.stage;
    if (st.k !== 'flick') return null;
    st.trail.push([x, y, now]);
    if (st.trail.length > 90) st.trail.shift();
    if (st.from !== null) return null;
    // The backswing: the fan stays at its lowest point, until the pointer comes back up past it.
    if (y >= st.at[1]) st.at = [x, y];
    else if (st.at[1] - y >= FLICK.r0) st.from = now;
    return null;
  }

  /** Called every frame: the HUD's view, and a release if the throw ran out of time. */
  frame(now: number): { view: ThrowView; done?: Release } {
    const st = this.stage;
    switch (st.k) {
      case 'idle': return { view: { fill: 0, hint: '' } };
      case 'power': {
        const fill = this.fillAt(now);
        // Two-stage throws: the SNAP window ahead, narrowing as the power goes past 90%.
        if (this.style !== 'two-stage') return { view: { fill, hint: '' } };
        const h = snapHalf(this.s, fill);
        return { view: { fill, ...(this.s.putt ? {} : { window: [SNAP.center - h, SNAP.center + h] as [number, number] }), hint: 'Let go to set the power' } };
      }
      case 'snap': {
        const needle = this.needleAt(now, st);
        const h = snapHalf(this.s, st.power);
        // The needle ran off the end: nobody pressed, a shank.
        if (needle < SNAP.runout) { this.stage = { k: 'idle' }; return { view: { fill: st.power, hint: '' }, done: this.snapRelease(SNAP.runout, st) }; }
        return { view: { fill: st.power, needle, window: [SNAP.center - h, SNAP.center + h], hint: 'Press as the needle hits SNAP' } };
      }
      case 'steady': {
        if (now - st.t0 > RETICLE.timeout) { this.stage = { k: 'idle' }; return { view: { fill: st.power, hint: '' }, done: this.steadyRelease(now, st) }; }
        return { view: { fill: st.power, reticle: reticleAt(now - st.t0, this.s), hint: 'Press when the circle is smallest' } };
      }
      case 'flick': {
        const v = st.from === null ? null : this.swing(now, st);
        const trail = st.trail.map(([x, y]): [number, number] => [x, y]);
        return { view: { fill: v ? Math.min(1, v.speed / this.full) : 0, flick: { at: st.at, half: this.half, R: FLICK.R, trail, started: st.from !== null, angle: v && v.speed > 0 ? v.angle : null }, hint: st.from === null ? 'Pull back, then swipe up' : 'Let go as you swipe' } };
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
      beats: beatsOf(hits),
    };
  }
  /** The flick's swing at `now`: its speed (px/s) and direction off straight up (rad, + right), over the last FLICK.window ms of the swing up. */
  private swing(now: number, st: Extract<Stage, { k: 'flick' }>): { speed: number; angle: number } {
    const up = st.trail.filter((p) => p[2] >= st.from!);
    const ref = [...up].reverse().find((p) => p[2] <= now - FLICK.window) ?? up[0] ?? st.trail[st.trail.length - 1];
    const dx = this.pointer[0] - ref[0], dy = ref[1] - this.pointer[1];
    return { speed: (Math.hypot(dx, dy) / Math.max(16, now - ref[2])) * 1000, angle: Math.atan2(dx, dy) };
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
  /** The flick let go: null if it wasn't swinging up (never started, stopped, or going back down). */
  private flickRelease(now: number, st: Extract<Stage, { k: 'flick' }>): Release | null {
    if (st.from === null) return null;
    const { speed, angle } = this.swing(now, st);
    const k = speed / this.full;
    if (k < FLICK.slowest || Math.abs(angle) >= Math.PI / 2) return null;
    // Direction: off straight up (right pushes right), dead straight near the middle; outside the fan, a shank.
    const out = Math.abs(angle) > this.half;
    const f = Math.sign(angle) * Math.max(0, Math.abs(angle) - FLICK.straight) / (this.half - FLICK.straight);
    const toRight = (out ? Math.sign(angle) * 10 : f * 6) * (this.s.putt ? 0.4 : 1);
    const yaw = -toRight * (this.s.mirror ? -1 : 1);
    // Power: the swing's speed. Faster than full is muscled.
    const over = this.s.noOverpower ? 0 : Math.max(0, k - 1);
    const wobble = (out ? 2.2 : 0.6) + Math.min(2, over * 2);
    const off = Math.round(Math.abs(toRight));
    const line = off === 0 ? 'straight' : `${off}° ${toRight > 0 ? 'right' : 'left'}`;
    const note = out ? `Shanked ${toRight > 0 ? 'right' : 'left'}` : `${k > 1 ? 'Muscled' : `${Math.round(k * 100)}%`} · ${line}`;
    return { power: Math.min(1, k), execution: { yaw, bank: 0, wobble }, note };
  }
}
