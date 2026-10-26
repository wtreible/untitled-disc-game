// The daily challenge (src/game/daily.ts): the same holes for everyone, a new set each day.
import { describe, expect, it } from 'vitest';
import { DAILY_HOLES, dailyFor, todayUTC } from '../src/game/daily';

const courses = [{ id: 'kincaid', holes: 18 }, { id: 'oakgrove', holes: 18 }, { id: 'skatas', holes: 20 }, { id: 'tiny', holes: 2 }];

describe('daily challenge', () => {
  it('is the same for everyone on a day (whatever order the courses come in)', () => {
    expect(dailyFor('2026-10-25', courses)).toEqual(dailyFor('2026-10-25', [...courses].reverse()));
  });
  it('a run of holes that fits the course, never on one too short for it', () => {
    for (let d = 1; d <= 28; d++) {
      const x = dailyFor(`2026-11-${String(d).padStart(2, '0')}`, courses);
      const c = courses.find((q) => q.id === x.course)!;
      expect(c.holes).toBeGreaterThanOrEqual(DAILY_HOLES);
      expect(x.count).toBe(DAILY_HOLES);
      expect(x.first + x.count).toBeLessThanOrEqual(c.holes);
      expect(x.seed).toBeGreaterThan(0);
    }
  });
  it('changes from day to day', () => {
    const days = Array.from({ length: 10 }, (_, d) => dailyFor(`2026-12-${String(d + 1).padStart(2, '0')}`, courses));
    expect(new Set(days.map((x) => `${x.course}:${x.first}`)).size).toBeGreaterThan(3);
    expect(new Set(days.map((x) => x.seed)).size).toBe(10);
  });
  it('dates are UTC days', () => {
    expect(todayUTC(new Date('2026-10-25T23:30:00-05:00'))).toBe('2026-10-26');
  });
});
