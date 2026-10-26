// The daily challenge: one short round a day, the same for everyone. The date (UTC) picks a real
// course, a run of holes on it, and the wind on each (src/modes/disc.ts seeds it), so every player
// plays the same holes in the same conditions. The first finished round goes on the day's board.

export interface Daily {
  /** YYYY-MM-DD (UTC). */
  date: string;
  /** Menu course id. */
  course: string;
  first: number;
  count: number;
  /** Seeds the wind. */
  seed: number;
}

/** Holes a daily round plays. */
export const DAILY_HOLES = 3;

export const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);

/** A small string hash (FNV-1a). */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The day's challenge, from the courses on offer (`holes`: how many each has). */
export function dailyFor(date: string, courses: { id: string; holes: number }[]): Daily {
  const pool = courses.filter((c) => c.holes >= DAILY_HOLES).sort((a, b) => a.id.localeCompare(b.id));
  const h = hash(`daily:${date}`);
  const c = pool[h % pool.length];
  return { date, course: c.id, first: hash(`${date}:${c.id}`) % (c.holes - DAILY_HOLES + 1), count: DAILY_HOLES, seed: hash(`wind:${date}`) || 1 };
}

/** A place on the board: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export const ordinal = (n: number) => { const t = n % 100, u = n % 10; return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`; };

/** This browser's daily rounds: the first finished one each day (the one on the board). */
type Record = { strokes: number; toPar: number; posted: boolean };
const KEY = 'untitled-disc-game:daily';
const load = (): { [date: string]: Record } => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };

export function dailyRecord(date: string): Record | null {
  return load()[date] ?? null;
}
export function saveDailyRecord(date: string, r: Record): void {
  // Only the last week is kept.
  const all = load(), keep = Object.fromEntries(Object.entries(all).filter(([d]) => Date.parse(d) > Date.now() - 7 * 86400000));
  try { localStorage.setItem(KEY, JSON.stringify({ ...keep, [date]: r })); } catch { /* storage unavailable */ }
}
