// Broadcast-style graphics (in the spirit of disc golf coverage like JomezPro): a big skewed result
// banner ("BIRDIE") over a name plate, and small event chips ("TREE!", "CHAINS").
export type Tone = 'ace' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'info' | 'hot';

const TONE: Record<Tone, string> = {
  ace: 'var(--eagle)', eagle: 'var(--eagle)', birdie: 'var(--birdie)', par: 'var(--par)',
  bogey: 'var(--bogey)', double: 'var(--double)', info: 'var(--accent)', hot: 'var(--hot)',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Score result tone for strokes vs par. */
export function scoreTone(strokes: number, par: number): Tone {
  if (strokes === 1) return 'ace';
  const d = strokes - par;
  return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'double';
}

let bannerTimer = 0;
/** Big result banner. `who` is the player, `what` e.g. "Hole 3 · 2 throws", `score` e.g. "−2". */
export function banner(o: { word: string; tone: Tone; who: string; color: string; what?: string; score?: string; ms?: number }): void {
  const box = document.getElementById('bcast')!;
  clearTimeout(bannerTimer);
  box.innerHTML = `<div class="banner ${o.tone === 'ace' ? 'ace' : ''}" style="--tone:${TONE[o.tone]}">
    <div class="word"><span>${esc(o.word)}</span></div>
    <div class="plate"><div class="who"><i style="background:${o.color}"></i>${esc(o.who)}</div>${o.what ? `<div class="what">${esc(o.what)}</div>` : ''}${o.score ? `<div class="score">${esc(o.score)}</div>` : ''}</div>
  </div>`;
  bannerTimer = window.setTimeout(() => {
    box.firstElementChild?.classList.add('out');
    bannerTimer = window.setTimeout(() => { box.innerHTML = ''; }, 400);
  }, o.ms ?? 2600);
}

/** Small event chip; several can stack. `sub` is an optional muted second line. */
export function chip(text: string, tone: Tone = 'info', sub?: string, ms = 2200): void {
  const box = document.getElementById('chips')!;
  const el = document.createElement('div');
  el.className = 'chip';
  el.style.setProperty('--tone', TONE[tone]);
  el.innerHTML = `<span>${esc(text)}${sub ? ` <small>${sub}</small>` : ''}</span>`;
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild!.remove();
  window.setTimeout(() => { el.classList.add('out'); window.setTimeout(() => el.remove(), 350); }, ms);
}

export function clearBroadcast(): void {
  document.getElementById('bcast')!.innerHTML = '';
  document.getElementById('chips')!.innerHTML = '';
}
