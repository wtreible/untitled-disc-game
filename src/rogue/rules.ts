// Crazy mode setup: how many cards, how many picks, which holes have drafts, and how often each
// tier comes up. Chosen on the menu (the host's, online) and sent as the round's first event.
import type { Tier } from './powerups';

export interface CrazyRules {
  /** Cards in each offer (Double Draft adds one). */
  cards: number;
  /** Augments each player picks per draft. */
  picks: number;
  /** Draft after every this-many holes (1 = every hole). */
  every: number;
  /** Everyone picks a starter augment before hole 1. */
  starter: boolean;
  /** The starter draft rolls better tiers (epic ×1.8, legendary ×3, then normalized). */
  starterBoost: boolean;
  /** Relative tier odds (any non-negative numbers; e.g. 0 / 0 / 1 means legendary only). */
  odds: Record<Tier, number>;
}

export const DEFAULT_RULES: CrazyRules = {
  cards: 3, picks: 1, every: 1, starter: true, starterBoost: true,
  odds: { common: 70, epic: 25, legendary: 5 },
};

export const RULE_LIMITS = { cards: [2, 5], picks: [1, 3], every: [1, 6] } as const;

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], d: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v as number))) : d;

/** Any input (a saved setting, another player's event) → valid rules. */
export function cleanRules(r: Partial<CrazyRules> | null | undefined): CrazyRules {
  const d = DEFAULT_RULES;
  const odd = (t: Tier) => {
    const v = r?.odds?.[t];
    return Number.isFinite(v) && (v as number) >= 0 ? Math.min(1e6, v as number) : d.odds[t];
  };
  const odds = { common: odd('common'), epic: odd('epic'), legendary: odd('legendary') };
  return {
    cards: clampInt(r?.cards, RULE_LIMITS.cards, d.cards),
    picks: clampInt(r?.picks, RULE_LIMITS.picks, d.picks),
    every: clampInt(r?.every, RULE_LIMITS.every, d.every),
    starter: r?.starter ?? d.starter,
    starterBoost: r?.starterBoost ?? d.starterBoost,
    // All zero means nothing could come up: fall back to the defaults.
    odds: odds.common + odds.epic + odds.legendary > 0 ? odds : { ...d.odds },
  };
}

/** Odds as fractions summing to 1, for a draft (the starter one boosted if the rules say so). */
export function tierWeights(r: CrazyRules, starter: boolean): Record<Tier, number> {
  const boost = starter && r.starterBoost;
  const w = { common: r.odds.common, epic: r.odds.epic * (boost ? 1.8 : 1), legendary: r.odds.legendary * (boost ? 3 : 1) };
  const sum = w.common + w.epic + w.legendary || 1;
  return { common: w.common / sum, epic: w.epic / sum, legendary: w.legendary / sum };
}

/** Whether a draft follows the hole that just finished (holesDone: holes played so far in the round). */
export const draftAfter = (r: CrazyRules, holesDone: number) => holesDone % r.every === 0;

/** Draft order for one draft: the given order, once per pick (A, B, A, B for two picks). */
export const draftQueue = (order: number[], picks: number) => Array.from({ length: picks }, () => order).flat();
