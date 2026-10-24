// Crazy mode's tutorial (Training): the range, a draft dealt from the real cards, then one augment
// at a time to try (each step's augments replace the last's, so you feel each on its own). What
// the range can't show alone (hexes, your course, mulligans) is explained instead. The card is
// src/modes/tutorial.ts's.
import type { Vec2 } from '../course/geo';
import { FT } from '../course/range';
import type { TutorialCourse } from './tutorial';

const BASKET: Vec2 = [0, 200 * FT];
/** A row of trees across the line to the basket, with no gap to thread. */
const WALL: Vec2[] = [-12, -8, -4, 0, 4, 8, 12].map((x): Vec2 => [x, 110 * FT]);

export const CRAZY_TUTORIAL: TutorialCourse = {
  label: 'CRAZY MODE',
  steps: [
    {
      title: 'Drafts',
      body: 'In Crazy mode you pick an augment between holes (the menu sets how often and how many cards). Cards are <b>common</b>, <b>epic</b> or <b>legendary</b>: legendary ones bend the rules. Pick one.',
      baskets: [BASKET], trees: [], augments: [],
      draft: ['grip-tape', 'big-arm', 'laser-disc'],
    },
    {
      title: 'Yours for the round',
      body: 'Your augments are listed on the left, and they stack as you draft more. Throw to feel the one you picked.',
      thrown: () => true,
    },
    {
      title: 'Ghost lines',
      body: '<b>Accuracy &amp; Sight</b> augments show your flight before you throw. <b>Oracle</b> (legendary) shows all of it, and the spread of your wobble either side. Line it up on the basket and throw.',
      augments: ['oracle'],
      thrown: () => true,
    },
    {
      title: 'Perfect Form',
      body: '<b>Perfect Form</b> (legendary): press <kbd>P</kbd> to arm a throw, and it flies exactly on the ghost line, no wobble. Twice a hole. Arm one and throw.',
      augments: ['oracle', 'perfect-form'],
      thrown: (t) => t.perfect,
    },
    {
      title: 'Through the trees',
      body: '<b>Trees &amp; Hazards</b> augments change what trees do to your disc. There’s a wall of trees in front of the basket, and <b>Phase Disc</b> (legendary) goes straight through every one. Throw at the basket.',
      trees: WALL, augments: ['phase-disc'],
      thrown: () => true,
    },
    {
      title: 'Fire and light',
      body: 'Some augments show themselves in the air. <b>Fireball</b> (legendary) burns the first tree it hits and flies on; <b>Comet Tail</b> leaves a glowing trail (and the wind moves it less). Throw through the wall again.',
      trees: WALL, augments: ['fireball', 'comet-tail'],
      thrown: () => true,
    },
    {
      title: 'Split',
      body: '<b>Split Disc</b> (legendary): at the top of its flight the disc splits in two, and you play the better half. Watch for the split.',
      trees: [], augments: ['split-disc'],
      thrown: () => true,
    },
    {
      title: 'Two throws',
      body: '<b>Second Chances</b>: <b>Clone Disc</b> (legendary) throws every throw twice and keeps the better one; the other flies faded. Throw one.',
      trees: [], augments: ['clone-disc'],
      thrown: () => true,
    },
    {
      title: 'Chains',
      body: '<b>Putting &amp; Chains</b> augments keep your disc in the basket. With <b>Black Hole</b> (legendary) anything that touches the chains goes in. The basket’s 40 ft out: make it.',
      baskets: [[0, 40 * FT]], putt: true, augments: ['black-hole'],
      thrown: (t) => t.holed,
    },
    {
      title: 'Your course, and hexes',
      body: '<b>Your Course</b> augments change the course for you only: a closer tee, a bigger basket, a tree cleared. <b>Hexes</b> change everyone else’s and never yours: a bush by their basket, a pond on their fairway, more wind. Hexes only come up with friends; you place them before each hole by clicking the map.',
      baskets: [BASKET], augments: [],
      ok: 'Got it',
    },
    {
      title: 'Second chances',
      body: '<b>Mulligan</b>: take a throw back right after it lands (<kbd>M</kbd>). <b>Rerolls</b> deal a draft again; <b>Double Draft</b> adds a card to every draft. Only one of each tier’s best cards comes along per draft, so pick for the course ahead.',
      ok: 'Got it',
    },
  ],
  end: {
    title: 'Go crazy',
    body: 'Tick <b>Crazy mode</b> on the menu for any course. Its rules set how many cards, how many picks, how often, and the odds of each tier, and <b>Browse augments</b> lists every one.',
  },
};
