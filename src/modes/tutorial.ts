// Tutorials (Training): the driving range with a card of steps, each done by doing it. The basics
// go from aiming to making a putt; Crazy mode's (src/modes/crazyTutorial.ts) deals a draft and
// lets you try augments one at a time. src/modes/disc.ts runs the range and tells this what the
// player is up to.
import type { Vec2 } from '../course/geo';
import { FT } from '../course/range';
import { FLIGHT, type Shot } from '../disc/flight';
import { sfx } from '../audio/sound';

/** What the player is lining up, every frame. */
export interface TutorialAim {
  /** Direction (rad) and distance (m) from the tee to the aim point. */
  angle: number;
  dist: number;
  disc: string;
  firstPerson: boolean;
}

/** A throw that's landed, with how it was thrown. `perfect`: Perfect Form was armed. */
export interface TutorialThrow { power: number; hyzer: number; forehand: boolean; shot: Shot; putt: boolean; holed: boolean; perfect: boolean }

export interface Step {
  title: string;
  /** HTML; keys in <kbd>. */
  body: string;
  /** Baskets for this step (the range's, downrange from the tee at the origin). */
  baskets?: Vec2[];
  /** Range trees for this step (none if not given, once a step has set some). */
  trees?: Vec2[];
  /** Set up a putt when the step starts: the putter, a flat backhand, aimed at the (first) basket. */
  putt?: boolean;
  /** The player's augments for this step (Crazy mode's tutorial): these and only these. */
  augments?: string[];
  /** Deal a draft of these augments; picking one (it becomes yours) completes the step. */
  draft?: string[];
  /** A button that completes the step (for steps that explain rather than try). */
  ok?: string;
  aim?: (a: TutorialAim, start: TutorialAim) => boolean;
  thrown?: (t: TutorialThrow, start: TutorialAim) => boolean;
}

/** A tutorial: its name on the card, its steps, and its last card. */
export interface TutorialCourse { label: string; steps: Step[]; end: { title: string; body: string } }

/** What a step asks of the range and the player when it starts. */
export interface StepSetup { baskets?: Vec2[]; putt: boolean; trees?: Vec2[]; augments?: string[] }

const BASKET: Vec2 = [0, 150 * FT];
const PUTT_BASKET: Vec2 = [0, 25 * FT];
const wobblePct = Math.round(FLIGHT.wobbleFrom * 100);

const STEPS: Step[] = [
  {
    title: 'Aim', body: 'Look around: drag the view, or use <kbd>←</kbd> <kbd>→</kbd>. The basket’s straight ahead.', baskets: [BASKET],
    aim: (a, s) => Math.abs(Math.atan2(Math.sin(a.angle - s.angle), Math.cos(a.angle - s.angle))) > 0.07,
  },
  {
    title: 'How far', body: '<kbd>W</kbd> / <kbd>S</kbd> set how far you’re aiming. The white tick on the power meter moves to the power that gets there.',
    aim: (a, s) => Math.abs(a.dist - s.dist) > 8,
  },
  {
    title: 'Throw', body: 'Hold <kbd>Space</kbd>: the meter fills and empties. Let go at the white tick. The dashed line shows where a perfect throw goes.',
    thrown: () => true,
  },
  {
    title: 'The wobble zone', body: `The striped red end of the meter, past ${wobblePct}%, is the wobble zone: muscling it goes a little farther, but your aim wobbles more. Throw one in the stripes.`,
    thrown: (t) => t.power >= FLIGHT.wobbleFrom,
  },
  {
    title: 'Discs', body: 'Pick another disc: click a card at the bottom, or <kbd>[</kbd> <kbd>]</kbd>. Drivers fly farthest and curve most; putters fly straight and short. Each card’s chart shows its flight.',
    aim: (a, s) => a.disc !== s.disc,
  },
  {
    title: 'Hyzer and anhyzer', body: 'Tilt the disc: <kbd>Q</kbd> for hyzer (curves left), <kbd>E</kbd> for anhyzer (curves right). Tilt it and throw.',
    thrown: (t) => t.hyzer !== 0,
  },
  {
    title: 'Forehand', body: '<kbd>T</kbd> switches to forehand (and back): the same disc curves the other way. Throw a forehand.',
    thrown: (t) => t.forehand,
  },
  {
    title: 'Shots', body: '<kbd>G</kbd> changes the shot: a tomahawk or thumber goes up and over trees, a roller rolls along the ground under them. Throw one.',
    thrown: (t) => t.shot !== 'standard',
  },
  {
    title: 'The map', body: '<kbd>C</kbd> switches between first person and the top-down map, where you click to aim. Switch views.',
    aim: (a, s) => a.firstPerson !== s.firstPerson,
  },
  {
    title: 'Putt', body: 'Inside 20 m with the putter you putt. The basket’s moved 25 ft out and you’ve got the putter: let go at the white tick and make it.', baskets: [PUTT_BASKET], putt: true,
    thrown: (t) => t.putt && t.holed,
  },
];

/** The basics: ten steps from aiming to a made putt. */
export const BASICS: TutorialCourse = {
  label: 'TUTORIAL', steps: STEPS,
  end: { title: 'That’s the lot', body: 'The Driving Range lets you set wind, weather, baskets and trees, and friends take turns. <kbd>?</kbd> lists every control any time.' },
};

export interface Tutorial {
  /** Every frame, while lining up a throw. */
  aim(a: TutorialAim): void;
  /** A throw landed. */
  thrown(t: TutorialThrow): void;
}

/**
 * Mount a tutorial's card. `setup` puts the range's baskets and trees where a step wants them (and
 * sets up a putt at the first basket, if asked) and gives the player the step's augments; `draft`
 * deals a draft and says which card was picked (null: skipped); `quit` goes back to the menu.
 */
export function mountTutorial(el: HTMLElement, hooks: { setup: (s: StepSetup) => void; draft?: (cards: string[], picked: (id: string | null) => void) => void; endDraft?: () => void; quit: () => void }, course: TutorialCourse = BASICS): Tutorial {
  const STEPS = course.steps;
  let i = 0;
  let start: TutorialAim | null = null;
  let last: TutorialAim | null = null;
  let done = false;
  let doneTimer = 0;

  const render = () => {
    if (i >= STEPS.length) {
      el.innerHTML = `<div class="tu-head"><span>${course.label}</span><span>Done</span></div>
        <h4>${course.end.title}</h4>
        <p>${course.end.body}</p>
        <div class="tu-actions"><button class="chip-btn" data-act="restart">Start over</button><button class="primary" data-act="quit">Back to the menu</button></div>`;
    } else {
      const s = STEPS[i];
      el.innerHTML = `<div class="tu-head"><span>${course.label}</span><span>${i + 1} / ${STEPS.length}</span></div>
        <div class="tu-bar"><i style="width:${(i / STEPS.length) * 100}%"></i></div>
        <h4>${s.title}${done ? ' <b class="tu-ok">✓ Nice</b>' : ''}</h4>
        <p>${s.body}</p>
        <div class="tu-actions">${s.ok && !done ? `<button class="primary" data-act="ok">${s.ok}</button>` : ''}<button class="chip-btn" data-act="skip">Skip</button><button class="chip-btn" data-act="quit">End tutorial</button></div>`;
    }
    el.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'quit') hooks.quit();
      else if (act === 'ok') complete();
      else if (act === 'skip') next();
      else if (act === 'restart') go(0);
    }));
  };

  const go = (k: number) => {
    clearTimeout(doneTimer);
    hooks.endDraft?.(); // a draft left open (skipped) goes with its step
    i = k;
    done = false;
    start = last; // the next frame's aim, if none yet
    const s = STEPS[i];
    if (s && (s.baskets || s.trees || s.augments)) hooks.setup({ baskets: s.baskets, putt: !!s.putt, trees: s.trees, augments: s.augments });
    render();
    // A pick counts for the step that dealt it, not one reached since.
    if (s?.draft) hooks.draft?.(s.draft, (id) => { if (i !== k) return; if (id) hooks.setup({ putt: false, augments: [id] }); complete(); });
  };
  const next = () => go(i + 1);
  const complete = () => {
    if (done) return;
    done = true;
    sfx('confirm');
    render();
    doneTimer = window.setTimeout(next, 1100);
  };

  el.hidden = false;
  go(0);
  return {
    aim(a) {
      last = a;
      if (!start) start = a;
      const s = STEPS[i];
      if (!done && s?.aim?.(a, start)) complete();
    },
    thrown(t) {
      const s = STEPS[i];
      if (!done && start && s?.thrown?.(t, start)) complete();
    },
  };
}
