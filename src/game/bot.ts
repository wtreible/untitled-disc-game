// Bots: computer players. A bot plans a throw the way a careful player would, by trying it: a few
// discs and release angles, the power that carries to its target (the basket, or a lay-up down the
// hole when that's out of reach), and a fan of aims around it, each flown a few times through the real
// trees with its own level's errors, so it picks lines it can actually hit (an Easy bot keeps away
// from gaps a Pro would thread). It takes the best on average, then throws it with those errors.
import { dist, type Vec2 } from '../course/geo';
import { PUTTER_DISC, type Disc } from '../disc/discs';
import { simulateThrow, type DiscWorld, type Execution, type ThrowInput, type ThrowResult } from '../disc/flight';
import type { Mods } from '../disc/mods';
import type { Rng } from './physics';

export type BotLevel = 'easy' | 'medium' | 'pro';
export const BOT_LEVELS: [BotLevel, string][] = [['easy', 'Easy'], ['medium', 'Medium'], ['pro', 'Pro']];

/** Online, a bot's seat has a client id that says what it is: bot-<level>-<n>. */
export const botClient = (level: BotLevel, i: number) => `bot-${level}-${i + 1}`;
export function botOfClient(client: string | undefined): BotLevel | null {
  const m = /^bot-(easy|medium|pro)-\d+$/.exec(client ?? '');
  return m ? (m[1] as BotLevel) : null;
}

export interface BotSkill {
  /** Aim error (degrees, one standard deviation) and power error (fraction). */
  aim: number;
  power: number;
  /** × the flight model's own wobble. */
  wobble: number;
  /** Chance of settling for the second or third best plan. */
  sloppy: number;
}
export const SKILL: Record<BotLevel, BotSkill> = {
  easy: { aim: 3.2, power: 0.08, wobble: 1.6, sloppy: 0.45 },
  medium: { aim: 1.9, power: 0.045, wobble: 1.25, sloppy: 0.2 },
  pro: { aim: 1.0, power: 0.025, wobble: 1.0, sloppy: 0.05 },
};

/** Inside this (m) a bot putts; the game's putting range. */
export const BOT_PUTT = 20;
/** Chain height a putt aims to cross the basket at (m above its ground). */
const CHAIN = 1.1;

export interface BotSituation {
  start: Vec2;
  pin: Vec2;
  /** The hole's line, tee to basket: lay-ups go down it. */
  routing: Vec2[];
  discs: Disc[];
  world: DiscWorld;
  mods: Mods;
  fromTee: boolean;
}

export interface BotPlan {
  disc: Disc;
  hyzer: number;
  yaw: number;
  power: number;
  putt: boolean;
  /** Where it means the throw to finish. */
  target: Vec2;
  /** A low punch (launch angle, rad) from under the trees; none is the disc's own. */
  launch?: number;
}

/** The throw input for a plan: what the game releases (a putt uses the putting stroke). */
export function planInput(p: BotPlan, s: BotSituation): ThrowInput {
  return { start: s.start, aim: p.yaw, power: p.power, disc: p.disc, hyzer: p.hyzer, mods: s.mods, fromTee: s.fromTee, ...(p.putt ? { style: 'putt' } : {}), ...(p.launch !== undefined ? { launch: p.launch } : {}) };
}

const ghostOf = (i: ThrowInput, w: DiscWorld) => simulateThrow(i, w, () => 0.25, { ghost: true });
/** A seeded random stream: the same trials for every candidate, so they're compared fairly. */
function seeded(seed: number): Rng {
  let x = seed;
  return () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
}
/** Trial flights per candidate, with the bot's own errors. */
const TRIALS = 2;

/** How far down the line `p` is level with (m from the tee). */
function along(line: Vec2[], p: Vec2): number {
  let best = { d: Infinity, s: 0 }, acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = dist(a, b) || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L)));
    const d = Math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t));
    if (d < best.d) best = { d, s: acc + t * L };
    acc += L;
  }
  return best.s;
}

/** The point `ahead` m further down the line than where `p` is level with it. */
function downTheLine(line: Vec2[], p: Vec2, ahead: number): Vec2 {
  let s = along(line, p) + ahead;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], L = dist(a, b);
    if (s <= L) return [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L];
    s -= L;
  }
  return line[line.length - 1];
}

/** The smallest power whose `ok` holds (bisection; `ok` is false for low power, true for high). */
function powerFor(ok: (p: number) => boolean): number {
  if (!ok(1)) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
  return hi;
}

/** How good a result is for the plan (lower is better): left to the basket, penalties, a bad lie. */
function score(r: ThrowResult, pin: Vec2): number {
  if (r.holed) return -50;
  return dist(r.rest, pin) + r.penalty * 30 + (r.restSurface === 'trees' ? 15 : 0);
}

/** Plan a throw. Async: it yields now and then, so a long think doesn't freeze the page. */
export async function planThrow(s: BotSituation, level: BotLevel, rng: Rng): Promise<BotPlan> {
  const { start, pin, world } = s;
  const d = dist(start, pin);
  const toPin = Math.atan2(pin[1] - start[1], pin[0] - start[0]);
  const pause = () => new Promise<void>((r) => setTimeout(r, 0));
  if (d <= BOT_PUTT) {
    // Putt: straight at it, with the power that crosses the basket at chain height.
    const plan = { disc: PUTTER_DISC, hyzer: 0, yaw: toPin, power: 0, putt: true, target: pin };
    const pinZ = world.terrain.heightAt(pin[0], pin[1]);
    plan.power = powerFor((p) => {
      const g = ghostOf(planInput({ ...plan, power: p }, s), world).samples;
      const at = g.find((q) => Math.hypot(q[0] - start[0], q[1] - start[1]) >= d);
      return !!at && at[2] >= pinZ + CHAIN;
    });
    return plan;
  }
  const discs = s.discs.filter((x) => x !== PUTTER_DISC || d < 70);
  // How far each disc can go (ghost, full power).
  const reachOf = new Map(discs.map((x) => [x, dist(start, ghostOf({ start, aim: toPin, power: 1, disc: x, hyzer: 0, mods: s.mods, fromTee: s.fromTee }, world).rest)]));
  const reach = Math.max(...reachOf.values());
  // Where to aim: the basket (or a lay-up down the line when it's out of reach), a shorter lay-up,
  // and the hole's next bend (a dogleg's corner), so a narrow, bending fairway can be played safe.
  const targets: Vec2[] = reach >= d - 3 ? [pin, downTheLine(s.routing, start, d * 0.6)] : [downTheLine(s.routing, start, reach * 0.9), downTheLine(s.routing, start, reach * 0.6)];
  const here = along(s.routing, start);
  let acc = 0;
  for (let i = 1; i < s.routing.length - 1; i++) {
    acc += dist(s.routing[i - 1], s.routing[i]);
    const c = s.routing[i];
    if (acc > here + 15 && dist(start, c) < reach && targets.every((t) => dist(t, c) > 8)) { targets.push(c); break; }
  }
  const plans: { plan: BotPlan; score: number }[] = [];
  /** The plan flown TRIALS times with this bot's errors: its average score. */
  const expect = (plan: BotPlan) => {
    let sum = 0;
    for (let t = 0; t < TRIALS; t++) {
      const r = seeded(101 + t * 7919);
      const { power, execution } = botRelease(plan, level, r);
      sum += score(simulateThrow({ ...planInput(plan, s), power, execution }, world, r), pin);
    }
    return sum / TRIALS;
  };
  // From under the trees, a low punch is worth a try too.
  const inTrees = world.grid.classAt(start[0], start[1]) === 'trees';
  let n = 0;
  for (const target of targets) {
   const D = dist(start, target), toTarget = Math.atan2(target[1] - start[1], target[0] - start[0]);
   // The most controllable discs that still get there (slower discs fly straighter).
   const able = discs.filter((x) => reachOf.get(x)! >= D).sort((a, b) => reachOf.get(a)! - reachOf.get(b)!).slice(0, 3);
   for (const disc of able.length ? able : [discs.reduce((a, b) => (reachOf.get(a)! > reachOf.get(b)! ? a : b))]) {
    for (const [hyzer, launch] of [[-0.5], [0], [0.5], ...(inTrees ? [[0, Math.max(0, disc.launch - 0.07)]] : [])] as [number, number?][]) {
      const base: BotPlan = { disc, hyzer, yaw: toTarget, power: 0, putt: false, target, ...(launch !== undefined ? { launch } : {}) };
      base.power = powerFor((p) => dist(start, ghostOf(planInput({ ...base, power: p }, s), world).rest) >= D);
      // Aim off so the curve brings it back to the target.
      const g = ghostOf(planInput(base, s), world).rest;
      const yaw = toTarget + (toTarget - Math.atan2(g[1] - start[1], g[0] - start[0]));
      for (const off of [-8, -4, 0, 4, 8]) {
        const plan = { ...base, yaw: yaw + (off * Math.PI) / 180 };
        plans.push({ plan, score: expect(plan) });
      }
      if (++n % 2 === 0) await pause();
    }
   }
  }
  plans.sort((a, b) => a.score - b.score);
  // A sloppier bot sometimes settles for one of the next best.
  const k = rng() < SKILL[level].sloppy ? Math.min(plans.length - 1, 1 + Math.floor(rng() * 2)) : 0;
  return plans[k].plan;
}

function gaussian(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
}

/** How the bot actually throws its plan: its level's errors on aim and power. */
export function botRelease(plan: BotPlan, level: BotLevel, rng: Rng): { power: number; execution: Execution } {
  // Putts: the same aim error (over a short way it's a small miss), a little less power error.
  const k = SKILL[level], putt = plan.putt ? 0.7 : 1;
  return {
    power: Math.max(0.02, Math.min(1, plan.power * (1 + gaussian(rng) * k.power * putt))),
    execution: { yaw: gaussian(rng) * k.aim, bank: 0, wobble: k.wobble },
  };
}
