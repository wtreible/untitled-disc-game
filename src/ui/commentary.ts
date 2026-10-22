// Broadcast-style calls after a throw ("Big arm!", "Parked!"), from what it did. The chips say
// what happened (Tree!, OB +1); these add the color commentary. Not every throw gets one.
import type { ThrowEvent } from '../disc/flight';

export interface ThrowStory {
  /** How far the disc ended up from where it was thrown, m. */
  carried: number;
  /** From the basket before and after, m. */
  before: number;
  after: number;
  holed: boolean;
  /** Strokes on the hole with this throw, and par. */
  strokes: number;
  par: number;
  events: ThrowEvent[];
  props: number;
  /** A putt (inside the circle, putting style). */
  putt: boolean;
}

const LINES = {
  ace: ['ACE! Are you kidding me?!', 'Into the chains from the tee. Unbelievable!', 'An ace! Somebody buy this player a drink.'],
  longMake: ['From downtown!', 'Drained it from way outside the circle!', 'What a bomb of a putt!'],
  circle2Make: ['Circle two, nothing but chains.', 'Confident stroke from out there.'],
  spit: ['Spit out! That one hurts.', 'Hit the chains and walked away…', 'Heartbreaker.'],
  band: ['Off the top band. So close.', 'Ringing the band, not the chains.'],
  tray: ['Under the chains, off the cage.'],
  parked: ['Parked!', 'Tap-in range. Beautiful.', 'Parked it right under the basket!'],
  circle1: ['Into the circle. Good look at it.', 'Leaves a makeable putt.'],
  bigArm: ['Big arm!', 'That one went a mile.', 'Absolutely crushed it.'],
  trunk: ['That\'ll leave a mark.', 'Found the only tree out there.', 'Tree jail.'],
  branches: ['Through the leaves…', 'Nicked the branches.'],
  prop: ['The course fights back!', 'Bonk.'],
  water: ['Wet one.', 'That\'s a swim.', 'Splash down. Drop zone.'],
  oob: ['That\'s out of bounds.', 'Over the line. Penalty stroke.'],
  backwards: ['Going backwards…', 'Not the direction we wanted.'],
  short: ['A little short.', 'Needed more on that one.'],
};

/** A line for this throw, or null (most throws pass without one). `rng` picks among the options. */
export function commentary(s: ThrowStory, rng: () => number = Math.random): string | null {
  const pick = (k: keyof typeof LINES) => LINES[k][Math.floor(rng() * LINES[k].length)];
  if (s.holed && s.strokes === 1) return pick('ace');
  if (s.holed) return s.before > 20 ? pick('longMake') : s.before > 10 ? pick('circle2Make') : null;
  if (s.events.includes('water')) return pick('water');
  if (s.events.includes('oob')) return pick('oob');
  if (s.events.includes('spit') || s.events.includes('cut')) return pick('spit');
  if (s.events.includes('band')) return pick('band');
  if (s.events.includes('tray') && s.putt) return pick('tray');
  if (s.events.includes('trunk')) return pick('trunk');
  if (s.props > 0) return pick('prop');
  if (!s.putt && s.after < 3 && s.before > 25) return pick('parked');
  if (!s.putt && s.carried > 110) return pick('bigArm');
  if (s.after > s.before + 2) return pick('backwards');
  if (!s.putt && s.after < 10 && s.before > 40) return pick('circle1');
  if (s.events.includes('branch')) return rng() < 0.4 ? pick('branches') : null;
  if (s.putt && s.after < s.before && s.after > 1.5 && s.after < 4) return rng() < 0.4 ? pick('short') : null;
  return null;
}
