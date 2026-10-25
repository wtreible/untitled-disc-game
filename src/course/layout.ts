// Layouts: which tees and pins a round plays. Long tees and A pins are the course as mapped; short
// and pro tees and B pins use the alternates mapped at a hole (other layouts, a second basket). A hole
// without a shorter tee mapped gets one partway down its line; one without a longer tee keeps its own.
import { dist, polylineLength, type Vec2 } from './geo';
import type { DiscHole } from './disc-types';

export interface Layout {
  tees: 'long' | 'short' | 'pro';
  /** A: the mapped basket; B: the hole's alternate basket (if it has one); mixed: either, per hole. */
  pins: 'A' | 'B' | 'mixed';
  /** Picks the mixed pins (the same for everyone in an online round). */
  seed?: number;
}

export const DEFAULT_LAYOUT: Layout = { tees: 'long', pins: 'A' };
export const isDefault = (l: Layout | undefined) => !l || (l.tees === 'long' && l.pins === 'A');

/** Disc golf par estimate when OSM has no par tag. Rough PDGA-style length bands. */
export function parFromLength(m: number): number {
  return m < 150 ? 3 : m < 240 ? 4 : 5;
}

/** A generated short tee is this far down the line: a quarter of the hole, 15–45 m. */
const SHORT = { frac: 0.25, min: 15, max: 45 };
/** A mapped tee counts as shorter if it's at least this much nearer the basket (m). */
const SHORTER_BY = 10;

/** The line from `s` m along it to its end. */
function cutFrom(line: Vec2[], s: number): Vec2[] {
  for (let i = 1; i < line.length; i++) {
    const L = dist(line[i - 1], line[i]);
    if (s <= L) {
      const f = L > 0 ? s / L : 0;
      return [[line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f], ...line.slice(i)];
    }
    s -= L;
  }
  return [line[line.length - 1]];
}

/** A small hash of a seed and a hole number, for the mixed pins. */
function pick(seed: number, ref: string): boolean {
  let h = seed | 0;
  for (const c of ref) h = Math.imul(h ^ c.charCodeAt(0), 2654435761);
  return ((h ^ (h >>> 15)) & 1) === 1;
}

/** The holes as this layout plays them. `blocked`: water or OB, where a generated tee can't go. */
export function applyLayout(holes: DiscHole[], l: Layout | undefined, blocked: (p: Vec2) => boolean = () => false): DiscHole[] {
  if (isDefault(l)) return holes;
  return holes.map((h) => {
    let routing = h.routing.length > 1 ? h.routing : [h.tee, h.pin];
    let tee = h.tee, pin = h.pin;
    if (l!.tees === 'short') {
      const len = dist(h.tee, h.pin);
      // The longest of the mapped tees that's still properly shorter; else one partway down the line.
      const mapped = (h.alt_tees ?? []).filter((t) => dist(t, h.pin) < len - SHORTER_BY).sort((a, b) => dist(b, h.pin) - dist(a, h.pin))[0];
      if (mapped) {
        tee = mapped;
        routing = [mapped, ...routing.slice(1)];
      } else {
        let s = Math.min(SHORT.max, Math.max(SHORT.min, polylineLength(routing) * SHORT.frac));
        // Not in the water or OB: back toward the real tee until it's on dry, playable ground.
        while (s > 0 && blocked(cutFrom(routing, s)[0])) s -= 3;
        if (s > 0) { routing = cutFrom(routing, s); tee = routing[0]; }
      }
    }
    if (l!.tees === 'pro') {
      // The farthest mapped tee that's properly longer, played through the usual tee.
      const len = dist(h.tee, h.pin);
      const back = (h.alt_tees ?? []).filter((t) => dist(t, h.pin) > len + SHORTER_BY).sort((a, b) => dist(b, h.pin) - dist(a, h.pin))[0];
      if (back) { tee = back; routing = [back, ...routing]; }
    }
    const b = h.alt_pins?.[0];
    if (b && (l!.pins === 'B' || (l!.pins === 'mixed' && pick(l!.seed ?? 1, h.ref)))) {
      pin = b;
      routing = [...routing.slice(0, -1), b];
    }
    if (tee === h.tee && pin === h.pin) return h;
    const length = polylineLength(routing);
    return { ...h, tee, pin, routing, length_m: length, par: h.par_source === 'length' ? parFromLength(length) : h.par };
  });
}

/** How many holes have a mapped short tee, and an alternate basket (the menu says what a layout changes). */
export function layoutOptions(holes: DiscHole[]): { shortTees: number; proTees: number; altPins: number } {
  return {
    shortTees: holes.filter((h) => (h.alt_tees ?? []).some((t) => dist(t, h.pin) < dist(h.tee, h.pin) - SHORTER_BY)).length,
    proTees: holes.filter((h) => (h.alt_tees ?? []).some((t) => dist(t, h.pin) > dist(h.tee, h.pin) + SHORTER_BY)).length,
    altPins: holes.filter((h) => (h.alt_pins?.length ?? 0) > 0).length,
  };
}
