// Quick chat: a wheel of fixed lines. Hold Z, point at a line and let go (or press 1–8), or click
// the chat button and pick one. Lines show in the chat feed with the player's name and color. Fixed
// lines only, so there is nothing to moderate; online they travel as passing 'live' state (relayed
// by the room, not stored).
import { sfx } from '../audio/sound';
import { isKey } from '../keys';

export const CHAT_LINES = ['Nice shot!', 'Get in there!', 'Unlucky!', 'Oops…', 'Wow!', 'Hurry up!', 'Good game', 'Sorry!'];

/** One message a second at most. */
const COOLDOWN_MS = 1000;
/** How long a line stays in the feed. */
const SHOW_MS = 4500;

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Show a line in the feed. */
export function showChat(name: string, color: string, line: number): void {
  const text = CHAT_LINES[line];
  if (!text) return;
  const feed = document.getElementById('chat-feed')!;
  const el = document.createElement('div');
  el.className = 'chat-line';
  el.innerHTML = `<i style="background:${color}"></i><b>${esc(name)}</b> ${esc(text)}`;
  feed.appendChild(el);
  while (feed.children.length > 4) feed.firstElementChild!.remove();
  sfx('click', { gain: 0.6 });
  window.setTimeout(() => { el.classList.add('out'); window.setTimeout(() => el.remove(), 350); }, SHOW_MS);
}

/**
 * The wheel. `send(line)` is called with the line picked (at most once a second); `enabled()` says
 * whether chatting is possible now (in a round, with a player to speak as).
 */
export function mountQuickChat(send: (line: number) => void, enabled: () => boolean): void {
  const wheel = document.getElementById('chat-wheel')!;
  const btn = document.getElementById('chat-btn')!;
  wheel.innerHTML = `<div class="chat-hub"><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="currentColor"/></svg></div>${CHAT_LINES.map((t, i) => {
    const a = -Math.PI / 2 + (i / CHAT_LINES.length) * Math.PI * 2;
    return `<button data-i="${i}" style="left:calc(50% + ${Math.round(Math.cos(a) * 150)}px);top:calc(50% + ${Math.round(Math.sin(a) * 120)}px)"><small>${i + 1}</small>${esc(t)}</button>`;
  }).join('')}`;
  const items = [...wheel.querySelectorAll<HTMLButtonElement>('button')];
  let open: 'hold' | 'click' | null = null;
  let picked: number | null = null;
  let last = 0;

  const highlight = (i: number | null) => {
    picked = i;
    items.forEach((b, k) => b.classList.toggle('on', k === i));
  };
  const show = (mode: 'hold' | 'click') => {
    if (!enabled()) return;
    open = mode;
    highlight(null);
    wheel.hidden = false;
  };
  const close = () => { open = null; wheel.hidden = true; highlight(null); };
  const pick = (i: number | null) => {
    close();
    if (i === null || !enabled() || performance.now() - last < COOLDOWN_MS) return;
    last = performance.now();
    send(i);
  };

  // Holding Z: the line in the direction of the pointer from the middle of the screen.
  window.addEventListener('pointermove', (e) => {
    if (open !== 'hold') return;
    const dx = e.clientX - window.innerWidth / 2, dy = e.clientY - window.innerHeight / 2;
    if (Math.hypot(dx, dy) < 40) return highlight(null);
    const a = Math.atan2(dy, dx) + Math.PI / 2; // 0 = straight up, clockwise
    const n = CHAT_LINES.length;
    highlight(((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n);
  });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (isKey(e, 'chat') && !e.repeat && !open) show('hold');
    else if (open && /^[1-8]$/.test(e.key)) pick(parseInt(e.key, 10) - 1);
    else if (open && e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
  }, true);
  window.addEventListener('keyup', (e) => { if (isKey(e, 'chat') && open === 'hold') pick(picked); });
  window.addEventListener('blur', () => { if (open === 'hold') close(); });
  items.forEach((b) => b.addEventListener('click', () => pick(parseInt(b.dataset.i!, 10))));
  wheel.addEventListener('pointerdown', (e) => { if (e.target === wheel) close(); });
  btn.addEventListener('click', () => (open ? close() : show('click')));
}
