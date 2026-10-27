// Augment cards everywhere they're shown: the in-game side panel, the browser (menu and pause
// menu), the scorecard and the draft. One look: tier color, category, name, effect.
import { convertText } from '../units';
import { byId, CATEGORIES, POWERUPS, TIERS, type Powerup, type Tier } from '../rogue/powerups';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const catLabel = (p: Powerup) => CATEGORIES.find((c) => c.id === p.category)?.label ?? '';
const kindNote = (p: Powerup) => (p.kind === 'hex' ? 'Hex: affects everyone else' : p.kind === 'personal' ? 'Your course only' : '');

/** Whether it stacks, and what it touches: the tags shown with it everywhere (browser, draft, side panel), plus any `extra`. */
export function augTags(p: Powerup, ...extra: string[]): string {
  return [p.unique ? 'one only' : 'stacks', kindNote(p), ...extra].filter(Boolean).map((t) => `<em>${esc(t)}</em>`).join('');
}

/** Small card: name, effect and tags, full text on hover. `count` > 1 shows a ×n badge (stacked). */
export function miniCard(p: Powerup, count = 1, note = ''): string {
  const full = [p.name, convertText(p.text), catLabel(p), kindNote(p), note].filter(Boolean).join('\n');
  return `<div class="aug-mini ${p.tier}" title="${esc(full)}" tabindex="0">
    <b>${esc(p.name)}${count > 1 ? ` <i>×${count}</i>` : ''}</b><span>${esc(convertText(p.text))}</span>${note ? `<small>${esc(note)}</small>` : ''}<div class="aug-tags">${augTags(p)}</div></div>`;
}

/** A chip (scorecard): just the name, tier-colored; full text on hover. */
export function chipFor(p: Powerup, count = 1): string {
  return `<span class="aug-chip ${p.tier}" title="${esc(`${p.name} (${p.tier}, ${catLabel(p)}): ${convertText(p.text)}`)}">${esc(p.name)}${count > 1 ? ` ×${count}` : ''}</span>`;
}

/** Owned ids → [powerup, how many] in pick order, stacks merged. */
export function stacked(ids: string[]): [Powerup, number][] {
  const out = new Map<string, [Powerup, number]>();
  for (const id of ids) {
    const p = byId(id);
    if (!p) continue;
    const e = out.get(id);
    if (e) e[1]++; else out.set(id, [p, 1]);
  }
  return [...out.values()];
}

/**
 * In-game side panel: the current player's augments grouped by category, and the hexes others
 * have put on their course.
 */
export function renderSidePanel(el: HTMLElement, who: { name: string; color: string }, owned: string[], hexes: { id: string; by: string }[]): void {
  if (owned.length === 0 && hexes.length === 0) { el.hidden = true; return; }
  const groups = CATEGORIES.map((c) => ({ c, items: stacked(owned).filter(([p]) => p.category === c.id) })).filter((g) => g.items.length);
  el.innerHTML = `<div class="aug-head"><i style="background:${who.color}"></i>${esc(who.name)}<small>${owned.length} augment${owned.length === 1 ? '' : 's'}</small></div>
    ${groups.map((g) => `<div class="aug-group"><div class="aug-cat">${esc(g.c.label)}</div>${g.items.map(([p, n]) => miniCard(p, n)).join('')}</div>`).join('')}
    ${hexes.length ? `<div class="aug-group hexed"><div class="aug-cat">Hexed by others</div>${stacked(hexes.map((h) => h.id)).map(([p, n]) => miniCard(p, n, `from ${hexes.filter((h) => h.id === p.id).map((h) => h.by).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`)).join('')}</div>` : ''}`;
  el.hidden = false;
}

/** Full-size card for the browser. */
function browseCard(p: Powerup, ownedBy: string[]): string {
  return `<div class="aug-card ${p.tier}">
    <span class="ptier">${p.tier}</span><b>${esc(p.name)}</b><span class="txt">${esc(convertText(p.text))}</span>
    <span class="tags">${augTags(p)}${ownedBy.length ? `<em class="own">Have: ${esc(ownedBy.join(', '))}</em>` : ''}</span></div>`;
}

/**
 * The augment browser: every augment by category, filterable by tier. With `players`, shows who
 * has what (the pause menu, mid-round).
 */
export function openAugmentBrowser(players: { name: string; owned: string[] }[] = []): void {
  const modal = document.getElementById('aug-browser')!;
  let tier: Tier | 'all' = 'all';
  const render = () => {
    const list = POWERUPS.filter((p) => tier === 'all' || p.tier === tier);
    const counts = TIERS.map((t) => `${POWERUPS.filter((p) => p.tier === t).length} ${t}`).join(' · ');
    modal.querySelector('.aug-tiers')!.innerHTML = (['all', ...TIERS] as const).map((t) => `<button data-t="${t}" class="${t === tier ? 'on' : ''}">${t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}</button>`).join('');
    modal.querySelector('.aug-count')!.textContent = `${POWERUPS.length} augments: ${counts}`;
    modal.querySelector('.aug-body')!.innerHTML = CATEGORIES.map((c) => {
      const items = list.filter((p) => p.category === c.id).sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
      if (!items.length) return '';
      return `<section><h3>${esc(c.label)}<small>${esc(c.blurb)}</small></h3><div class="aug-grid">${items.map((p) => browseCard(p, players.filter((q) => q.owned.includes(p.id)).map((q) => q.name))).join('')}</div></section>`;
    }).join('');
    modal.querySelectorAll<HTMLButtonElement>('.aug-tiers button').forEach((b) => b.addEventListener('click', () => { tier = b.dataset.t as Tier | 'all'; render(); }));
  };
  render();
  modal.hidden = false;
}

export function closeAugmentBrowser(): void {
  document.getElementById('aug-browser')!.hidden = true;
}
