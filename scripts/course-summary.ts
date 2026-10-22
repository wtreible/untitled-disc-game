// Per-hole par and length for every course, for the main menu's course card (which shouldn't
// download whole course files). Writes public/courses/summary.json. tests/courses.test.ts checks
// it matches the course files, so rerun this after rebuilding a course:
//
//   npm run course-summary
import { readFileSync, writeFileSync } from 'node:fs';
import type { DiscCourseFile } from '../src/course/disc-types';

/** Menu course id → file (as in src/modes/disc.ts DISC_COURSES). */
export const COURSE_FILES: Record<string, string> = {
  simple: 'tali-simple', forest: 'tali', silly: 'silly', fantasy: 'fantasy', rainbow: 'rainbow', pirate: 'pirate', oakgrove: 'oak-grove',
};

export function summarize(c: DiscCourseFile) {
  return { pars: c.holes.map((h) => h.par), lengths: c.holes.map((h) => Math.round(h.length_m)) };
}

if (process.argv[1]?.endsWith('course-summary.ts')) {
  const out = Object.fromEntries(Object.entries(COURSE_FILES).map(([id, f]) => [id, summarize(JSON.parse(readFileSync(`public/courses/${f}.json`, 'utf8')))]));
  writeFileSync('public/courses/summary.json', JSON.stringify(out));
  console.log(Object.entries(out).map(([id, s]) => `${id}: par ${s.pars.reduce((a, b) => a + b, 0)}, ${s.lengths.reduce((a, b) => a + b, 0)} m`).join(' · '));
}
