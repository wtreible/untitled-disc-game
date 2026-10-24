// Emoji reactions float up the screen: every emoji sent from the chat wheel (ours or a friend's)
// rises from the bottom right in a short burst of copies, swaying and fading, like a stream's
// reactions. Its speech bubble still shows who sent it. Off with Settings → Reduce motion.
import { prefs } from '../settings';

/** Copies per emoji, and how long each takes to rise (ms). */
const COPIES = 6;
const RISE_MS: [number, number] = [2200, 3200];

export function floatEmoji(emoji: string): void {
  if (prefs().reduceMotion) return;
  const layer = document.getElementById('emoji-float');
  if (!layer) return;
  const W = window.innerWidth, H = window.innerHeight;
  for (let k = 0; k < COPIES; k++) {
    const el = document.createElement('span');
    el.textContent = emoji;
    el.style.fontSize = `${26 + Math.random() * 16}px`;
    el.style.left = `${W * (0.8 + Math.random() * 0.14)}px`;
    el.style.top = `${H - 60}px`;
    layer.appendChild(el);
    const rise = -H * (0.4 + Math.random() * 0.2), sway = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 22);
    const anim = el.animate([
      { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
      { transform: `translate(${sway}px, ${rise * 0.3}px) scale(1)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${-sway * 0.6}px, ${rise * 0.65}px) scale(1)`, opacity: 0.9, offset: 0.6 },
      { transform: `translate(${sway * 0.4}px, ${rise}px) scale(0.9)`, opacity: 0 },
    ], { duration: RISE_MS[0] + Math.random() * (RISE_MS[1] - RISE_MS[0]), delay: k * 110 + Math.random() * 120, easing: 'ease-out', fill: 'both' });
    anim.onfinish = () => el.remove();
  }
}
