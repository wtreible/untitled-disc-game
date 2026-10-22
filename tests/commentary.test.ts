// Color commentary after throws (src/ui/commentary.ts), and the round's weather pick.
import { describe, expect, it } from 'vitest';
import { commentary, type ThrowStory } from '../src/ui/commentary';
import { WEATHER, pickWeather } from '../src/render/weather';

const base: ThrowStory = { carried: 60, before: 100, after: 40, holed: false, strokes: 1, par: 3, events: [], props: 0, putt: false };
const first = () => 0;

describe('commentary', () => {
  it('calls the big moments', () => {
    expect(commentary({ ...base, holed: true, after: 0, events: ['chains', 'holed'] }, first)).toMatch(/ACE/);
    expect(commentary({ ...base, before: 30, after: 2, carried: 28 }, first)).toBe('Parked!');
    expect(commentary({ ...base, carried: 130, after: 20, before: 150 }, first)).toBe('Big arm!');
    expect(commentary({ ...base, strokes: 3, holed: true, before: 22, putt: true }, first)).toBe('From downtown!');
  });

  it('penalties and bad breaks come first', () => {
    expect(commentary({ ...base, carried: 130, events: ['water'] }, first)).toBe('Wet one.');
    expect(commentary({ ...base, events: ['oob'] }, first)).toMatch(/out of bounds/);
    expect(commentary({ ...base, strokes: 3, before: 6, after: 1.5, putt: true, events: ['spit'] }, first)).toMatch(/Spit out/);
    expect(commentary({ ...base, events: ['trunk'] }, first)).toMatch(/mark/);
  });

  it('stays quiet on an ordinary throw and a short made putt', () => {
    expect(commentary(base, first)).toBeNull();
    expect(commentary({ ...base, strokes: 3, holed: true, before: 5, putt: true }, first)).toBeNull();
  });
});

describe('weather', () => {
  it('is the same for the same seed, and every kind comes up', () => {
    expect(pickWeather(1.234).id).toBe(pickWeather(1.234).id);
    const seen = new Set(Array.from({ length: 400 }, (_, i) => pickWeather(i * 0.731 + 0.05).id));
    expect([...seen].sort()).toEqual(Object.keys(WEATHER).sort());
  });
});
