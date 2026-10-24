// Quick chat as speech bubbles: each player's latest line or emoji pops up over their disc on the
// course, its tail pointing at them, and follows the view. When they're off screen (or behind the
// first-person camera) the bubble waits at the nearest edge instead, so nothing is missed.
import { sfx } from '../audio/sound';
import type { Vec3 } from '../game/terrain';
import { CHAT_LINES, EMOJI, type ChatMsg } from './quickChat';

/** How long a bubble stays up. */
const SHOW_MS = 4500;
/** Edge room (px). */
const PAD = 10;

interface Bubble { player: number; el: HTMLElement; until: number }

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class ChatBubbles {
  private bubbles: Bubble[] = [];

  /**
   * `anchor(p)`: the point over player p a bubble points at (null: nowhere, use the top edge).
   * `project`: that point on screen (src/render/courseScene.ts).
   */
  constructor(
    private readonly layer: HTMLElement,
    private readonly anchor: (player: number) => Vec3 | null,
    private readonly project: (p: Vec3) => { x: number; y: number; behind: boolean },
  ) {}

  /** Player p said something: their bubble (replacing the one they had up). */
  say(player: number, name: string, color: string, m: ChatMsg): void {
    const emoji = 'emoji' in m;
    const text = emoji ? EMOJI[m.emoji] : CHAT_LINES[m.chat];
    if (!text) return;
    this.drop(player);
    const el = document.createElement('div');
    el.className = `bubble${emoji ? ' emoji' : ''}`;
    el.style.setProperty('--c', color);
    el.innerHTML = `<b>${esc(name)}</b><span>${esc(text)}</span>`;
    this.layer.appendChild(el);
    this.bubbles.push({ player, el, until: performance.now() + SHOW_MS });
    sfx('click', { gain: 0.6 });
    this.update();
  }

  /** Every frame: follow the view, stack bubbles that would overlap, retire old ones. */
  update(): void {
    const now = performance.now();
    for (const b of [...this.bubbles]) if (now > b.until) this.drop(b.player, true);
    const W = window.innerWidth, H = window.innerHeight;
    const placed: { l: number; t: number; r: number; b: number }[] = [];
    // Nearest the bottom first, so the ones above stack upward out of their way.
    const spots = this.bubbles.map((b) => {
      const a = this.anchor(b.player);
      return { b, at: a ? this.project(a) : null, w: b.el.offsetWidth, h: b.el.offsetHeight };
    }).sort((p, q) => (q.at?.y ?? 0) - (p.at?.y ?? 0));
    for (const { b, at, w, h } of spots) {
      // Wanted: the tail's tip on the anchor (the bubble above it).
      let x = at ? at.x - w / 2 : W / 2 - w / 2, y = at ? at.y - h - 12 : PAD;
      let edge = !at;
      if (at?.behind) { x = W - at.x - w / 2; y = H - h - PAD; edge = true; } // behind us: along the bottom
      const cx = Math.min(Math.max(x, PAD), W - w - PAD), cy = Math.min(Math.max(y, PAD), H - h - PAD);
      if (cx !== x || cy !== y) edge = true;
      x = cx; y = cy;
      for (let k = 0; k < placed.length; k++) {
        const o = placed[k];
        if (x < o.r && x + w > o.l && y < o.b && y + h > o.t) { y = Math.max(PAD, o.t - h - 6); k = -1; edge = true; }
        if (y === PAD) break;
      }
      placed.push({ l: x, t: y, r: x + w, b: y + h });
      b.el.classList.toggle('edge', edge);
      b.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  }

  private drop(player: number, fade = false): void {
    const i = this.bubbles.findIndex((b) => b.player === player);
    if (i < 0) return;
    const [b] = this.bubbles.splice(i, 1);
    if (!fade) { b.el.remove(); return; }
    b.el.classList.add('out');
    window.setTimeout(() => b.el.remove(), 300);
  }
}
