// Crazy mode's tutorial (src/modes/crazyTutorial.ts) only names augments that exist.
import { describe, expect, it } from 'vitest';
import { CRAZY_TUTORIAL } from '../src/modes/crazyTutorial';
import { POWERUPS } from '../src/rogue/powerups';

describe("Crazy mode's tutorial", () => {
  it('every augment it grants or deals is a real one, and the draft has one of each tier', () => {
    const ids = new Set(POWERUPS.map((p) => p.id));
    for (const s of CRAZY_TUTORIAL.steps) for (const id of [...(s.augments ?? []), ...(s.draft ?? [])]) expect(ids.has(id), `${s.title}: ${id}`).toBe(true);
    const draft = CRAZY_TUTORIAL.steps.find((s) => s.draft)!.draft!;
    expect(draft.map((id) => POWERUPS.find((p) => p.id === id)!.tier).sort()).toEqual(['common', 'epic', 'legendary']);
  });
});
