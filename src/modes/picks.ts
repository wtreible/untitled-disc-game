// The picking screens of a round: choosing a bag (bag building) and an augment (Crazy mode drafts).
// They show one player's choice and report it; src/modes/disc.ts decides whose turn it is and turns
// the choice into an event.
import { DISCS } from '../disc/discs';
import { byId, CATEGORIES, type Tier } from '../rogue/powerups';
import { discCard } from '../ui/discPicker';
import { convertText } from '../units';
import { $, esc } from './discKit';

export interface BagPick {
  name: string;
  color: string;
  /** How many discs they carry. */
  size: number;
  /** Bag Pocket: they already have a bag and add a disc to it. */
  pocket: boolean;
  /** Disc ids picked so far (edited in place, so a redraw keeps them). */
  pick: string[];
  done: (discs: string[]) => void;
}

/** Show the bag picker for one player. */
export function showBagPicker(b: BagPick): void {
  const { pick, size } = b;
  const render = () => {
    $('bag-title').innerHTML = `<span style="color:${b.color}">●</span> ${esc(b.name)}: pick your bag`;
    $('bag-count').textContent = `${pick.length} / ${size}`;
    $('bag-sub').textContent = b.pocket
      ? `Bag Pocket: room for ${size} discs now. Add one.`
      : `Carry ${size} of the ${DISCS.length} discs for the whole round. Inside putting range you putt with the putter, if you carry one.`;
    $('bag-cards').innerHTML = DISCS.map(discCard).join('');
    $('bag-cards').querySelectorAll<HTMLButtonElement>('.disc-card').forEach((el) => {
      const id = el.dataset.id!;
      el.classList.toggle('on', pick.includes(id));
      el.addEventListener('click', () => {
        const i = pick.indexOf(id);
        if (i >= 0) pick.splice(i, 1);
        else if (pick.length < size) pick.push(id);
        render();
      });
    });
    $<HTMLButtonElement>('bag-ok').disabled = pick.length !== size;
  };
  $('bag-ok').onclick = () => {
    if (pick.length !== size) return;
    b.done([...pick]);
  };
  render();
  $('bag').hidden = false;
}

export interface DraftPick {
  name: string;
  color: string;
  /** The first draft of a run: a starter augment. */
  starter: boolean;
  tier: Tier;
  /** Augment ids on offer, and which one (if any) was bumped up a tier. */
  cards: string[];
  bumped?: number | null;
  rerolls: number;
  /** Augments they have already. */
  owned: string[];
  pick: (i: number) => void;
  reroll: () => void;
  skip: () => void;
}

/** Deal the draft cards for one player. */
export function showDraft(d: DraftPick): void {
  const cards = d.cards.map(byId);
  $('draft-title').innerHTML = `<span style="color:${d.color}">●</span> ${esc(d.name)}: ${d.starter ? 'pick your starter augment' : 'pick an augment'}`;
  $('draft-tier').textContent = `${d.tier[0].toUpperCase()}${d.tier.slice(1)} draft`;
  $('draft-tier').className = `tier ${d.tier}`;
  $('draft-cards').innerHTML = cards.map((c, i) => `<button class="pcard ${c.tier}" data-i="${i}">
      <span class="ptier">${c.tier}${d.bumped === i ? ' ★ bumped' : ''}</span>
      <span class="pcat">${esc(CATEGORIES.find((k) => k.id === c.category)?.label ?? '')}</span>
      <b>${esc(c.name)}</b><span>${esc(convertText(c.text))}</span></button>`).join('');
  $('draft-reroll').hidden = d.rerolls <= 0;
  $('draft-reroll').textContent = `Reroll (${d.rerolls})`;
  $('draft-owned').textContent = d.owned.length ? `Have: ${d.owned.map((id) => byId(id).name).join(', ')}` : '';
  $('draft-cards').querySelectorAll<HTMLButtonElement>('button').forEach((el) => el.addEventListener('click', () => d.pick(parseInt(el.dataset.i!, 10))));
  $('draft-reroll').onclick = d.reroll;
  $('draft-skip').onclick = d.skip;
  $('draft').hidden = false;
}
