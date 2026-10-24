// Throw events on the wire, smaller. A throw carries its whole flight (60 samples a second, already
// rounded to millimetres, src/modes/discRound.ts), most of an event's size. On the wire each track
// is whole millimetres, as second differences: the first point, then the first step, then how each
// step differs from the one before. A flight is smooth, so those are mostly one or two digits.
// Unpacking gives back exactly the numbers that were packed, so every browser plays the same flight.
import type { RoundEvent } from '../modes/discRound';

type Pt = number[];

/** Points (in metres, mm-rounded) → second differences in whole mm, flattened. */
export function packTrack(pts: Pt[], dims: number): number[] {
  const out: number[] = [];
  const prev = new Array<number>(dims).fill(0), step = new Array<number>(dims).fill(0);
  pts.forEach((p, i) => {
    for (let d = 0; d < dims; d++) {
      const v = Math.round(p[d] * 1000);
      if (i === 0) out.push(v);
      else {
        const s = v - prev[d];
        out.push(i === 1 ? s : s - step[d]);
        step[d] = s;
      }
      prev[d] = v;
    }
  });
  return out;
}

export function unpackTrack(q: number[], dims: number): Pt[] {
  const pts: Pt[] = [];
  const prev = new Array<number>(dims).fill(0), step = new Array<number>(dims).fill(0);
  for (let i = 0; i * dims < q.length; i++) {
    const p: Pt = [];
    for (let d = 0; d < dims; d++) {
      const x = q[i * dims + d];
      const v = i === 0 ? x : prev[d] + (step[d] = i === 1 ? x : step[d] + x);
      prev[d] = v;
      p.push(v / 1000);
    }
    pts.push(p);
  }
  return pts;
}

type ThrowE = Extract<RoundEvent, { t: 'throw' }>;
/** A packed throw: `q` has the flight's samples, banks and the Clone Disc twin's samples. */
interface PackedThrow extends Omit<ThrowE, 'result' | 'twin'> {
  result: Omit<ThrowE['result'], 'samples' | 'banks'>;
  q: { s: number[]; b: number[]; tw?: number[] };
}

/** An event as it goes to the room (only throws change). */
export function packEvent(e: RoundEvent): unknown {
  if (e.t !== 'throw') return e;
  const { samples, banks, ...result } = e.result;
  const { twin, ...rest } = e;
  const out: PackedThrow = {
    ...rest, result,
    q: { s: packTrack(samples, 3), b: packTrack(banks.map((b) => [b]), 1), ...(twin ? { tw: packTrack(twin, 3) } : {}) },
  };
  return out;
}

/** An event from the room. One without `q` (an older game build) passes through as it is. */
export function unpackEvent(x: unknown): RoundEvent {
  const p = x as PackedThrow | RoundEvent;
  if (!p || p.t !== 'throw' || !('q' in p)) return p as RoundEvent;
  const { q, ...rest } = p;
  return {
    ...rest,
    result: { ...rest.result, samples: unpackTrack(q.s, 3) as ThrowE['result']['samples'], banks: unpackTrack(q.b, 1).map((b) => b[0]) },
    ...(q.tw ? { twin: unpackTrack(q.tw, 3) as ThrowE['result']['samples'] } : {}),
  };
}
