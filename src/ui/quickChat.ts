// Quick chat: a wheel of fixed lines, and in its middle a second wheel of emoji. Hold Z (Settings →
// Controls) and it opens at the pointer; point at a line and let go (or press 1–8). Click the
// middle to switch between lines and emoji. The chat button opens it where you click. Messages
// show as speech bubbles over the player (src/ui/chatBubbles.ts). Fixed lines and emoji only, so
// there is nothing to moderate; online they travel as passing 'live' state (relayed by the room,
// not stored).
import { isKey } from '../keys';

export const CHAT_LINES = ['Nice shot!', 'Get in there!', 'Unlucky!', 'Oops…', 'Wow!', 'Hurry up!', 'Good game', 'Sorry!'];
export const EMOJI = ['👏', '🔥', '😂', '😮', '😬', '🙏', '💯', '🥏'];

/** A line (`chat`) or an emoji (`emoji`), by index. */
export type ChatMsg = { chat: number } | { emoji: number };

/** Read one off the wire (anything else: null). */
export function chatMsg(x: unknown): ChatMsg | null {
  const m = x as { chat?: unknown; emoji?: unknown } | null;
  if (m && typeof m.chat === 'number' && CHAT_LINES[m.chat]) return { chat: m.chat };
  if (m && typeof m.emoji === 'number' && EMOJI[m.emoji]) return { emoji: m.emoji };
  return null;
}

/** One message a second at most. */
const COOLDOWN_MS = 1000;
/** The wheel's reach from its middle (px): its items sit on this ellipse. */
const REACH: [number, number] = [150, 120];
/** Inside this (px) of the middle, nothing is pointed at: letting go there sends nothing. */
const HUB_R = 40;

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The wheel. `send(m)` is called with what was picked (at most once a second); `enabled()` says
 * whether chatting is possible now (in a round, with a player to speak as).
 */
export function mountQuickChat(send: (m: ChatMsg) => void, enabled: () => boolean): void {
  const wheel = document.getElementById('chat-wheel')!;
  const btn = document.getElementById('chat-btn')!;
  let page: 'chat' | 'emoji' = 'chat';
  let open: 'hold' | 'click' | null = null;
  let picked: number | null = null;
  let last = 0;
  /** Where the pointer is, and the wheel's middle. */
  let pointer: [number, number] = [window.innerWidth / 2, window.innerHeight / 2];
  let mid: [number, number] = pointer;
  let items: HTMLButtonElement[] = [];

  const entries = () => (page === 'chat' ? CHAT_LINES : EMOJI);
  const render = () => {
    const list = entries();
    wheel.classList.toggle('emoji-page', page === 'emoji');
    wheel.innerHTML = `<button class="chat-hub" data-hub title="${page === 'chat' ? 'Emoji' : 'Chat lines'}">${page === 'chat' ? '😀' : '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="currentColor"/></svg>'}</button>${list.map((t, i) => {
      const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
      return `<button data-i="${i}" style="left:calc(var(--cx) + ${Math.round(Math.cos(a) * REACH[0])}px);top:calc(var(--cy) + ${Math.round(Math.sin(a) * REACH[1])}px)"><small>${i + 1}</small>${esc(t)}</button>`;
    }).join('')}`;
    items = [...wheel.querySelectorAll<HTMLButtonElement>('button[data-i]')];
    items.forEach((b) => b.addEventListener('click', () => pick(parseInt(b.dataset.i!, 10))));
    wheel.querySelector('[data-hub]')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      page = page === 'chat' ? 'emoji' : 'chat';
      render();
      highlight(null);
    });
  };

  const highlight = (i: number | null) => {
    picked = i;
    items.forEach((b, k) => b.classList.toggle('on', k === i));
  };
  /** Open with its middle at (x, y), pulled in from the edges so it all fits on screen. */
  const show = (mode: 'hold' | 'click', at: [number, number]) => {
    if (!enabled()) return;
    open = mode;
    page = 'chat';
    const mx = REACH[0] + 90, my = REACH[1] + 40;
    mid = [Math.min(Math.max(at[0], mx), Math.max(mx, window.innerWidth - mx)), Math.min(Math.max(at[1], my), Math.max(my, window.innerHeight - my))];
    wheel.style.setProperty('--cx', `${mid[0]}px`);
    wheel.style.setProperty('--cy', `${mid[1]}px`);
    render();
    highlight(null);
    wheel.hidden = false;
  };
  const close = () => { open = null; wheel.hidden = true; highlight(null); };
  const pick = (i: number | null) => {
    const p = page;
    close();
    if (i === null || !enabled() || performance.now() - last < COOLDOWN_MS) return;
    last = performance.now();
    send(p === 'chat' ? { chat: i } : { emoji: i });
  };

  // Holding the key: whatever the pointer points at, from the wheel's middle.
  window.addEventListener('pointermove', (e) => {
    pointer = [e.clientX, e.clientY];
    if (open !== 'hold') return;
    const dx = e.clientX - mid[0], dy = e.clientY - mid[1];
    if (Math.hypot(dx, dy) < HUB_R) return highlight(null);
    const a = Math.atan2(dy, dx) + Math.PI / 2; // 0 = straight up, clockwise
    const n = entries().length;
    highlight(((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n);
  });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (isKey(e, 'chat') && !e.repeat && !open) show('hold', pointer);
    else if (open && /^[1-8]$/.test(e.key)) { e.stopImmediatePropagation(); pick(parseInt(e.key, 10) - 1); } // not a disc pick too
    else if (open && e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
  }, true);
  window.addEventListener('keyup', (e) => { if (isKey(e, 'chat') && open === 'hold') pick(picked); });
  window.addEventListener('blur', () => { if (open === 'hold') close(); });
  wheel.addEventListener('pointerdown', (e) => { if (e.target === wheel) close(); });
  btn.addEventListener('click', (e) => (open ? close() : show('click', [e.clientX, e.clientY])));
}
