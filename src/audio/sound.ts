// Sound: effects, music and ambience on one Web Audio graph. Browsers start audio only after a
// click or key press, so nothing plays until then (music asked for earlier starts at that moment).
// Effects are decoded once and cached; music and ambience stream from <audio> elements, one track
// at a time, and crossfade. Volumes come from prefs (Settings → Music / Effects). Files and their
// licenses: public/audio/CREDITS.md.
import { asset } from '../assets';
import { prefs } from '../settings';

/** Effect name → file variants in public/audio/sfx (one is picked at random each time). */
const SFX = {
  swish: ['swish-0.wav', 'swish-1.wav', 'swish-2.wav'],
  tree: ['tree-0.ogg', 'tree-1.ogg', 'tree-2.ogg', 'tree-3.ogg'],
  branch: ['branch-0.ogg', 'branch-1.ogg', 'branch-2.ogg', 'branch-3.ogg'],
  leaves: ['leaves-0.ogg', 'leaves-1.ogg', 'leaves-2.ogg', 'leaves-3.ogg'],
  bonk: ['bonk-0.ogg', 'bonk-1.ogg', 'bonk-2.ogg', 'bonk-3.ogg'],
  chain: ['chain-0.ogg', 'chain-1.ogg', 'chain-2.ogg', 'chain-3.ogg', 'chain-4.ogg'],
  jangle: ['jangle-0.ogg', 'jangle-1.ogg'],
  clank: ['clank-0.ogg', 'clank-1.ogg', 'clank-2.ogg'],
  tray: ['tray-0.ogg', 'tray-1.ogg', 'tray-2.ogg'],
  'land-grass': ['land-grass-0.ogg', 'land-grass-1.ogg', 'land-grass-2.ogg', 'land-grass-3.ogg'],
  'land-hard': ['land-hard-0.ogg', 'land-hard-1.ogg', 'land-hard-2.ogg', 'land-hard-3.ogg'],
  'land-sand': ['land-sand-0.ogg', 'land-sand-1.ogg', 'land-sand-2.ogg', 'land-sand-3.ogg'],
  splash: ['splash-0.ogg', 'splash-1.ogg', 'splash-2.ogg', 'splash-3.ogg'],
  ob: ['ob.ogg'],
  applause: ['applause.ogg'],
  click: ['click.ogg'],
  select: ['select.ogg'],
  toggle: ['toggle.ogg'],
  confirm: ['confirm.ogg'],
  card: ['card.ogg'],
  deal: ['deal.ogg'],
  'jingle-great': ['jingle-great.ogg'],
  'jingle-birdie': ['jingle-birdie.ogg'],
  'jingle-par': ['jingle-par.ogg'],
  'jingle-bogey': ['jingle-bogey.ogg'],
  'jingle-round': ['jingle-round.ogg'],
} as const;
export type Sfx = keyof typeof SFX;

export type Track = 'menu' | 'park' | 'minigolf' | 'fantasy' | 'space';
const TRACKS: Record<Track, string> = {
  menu: 'music/menu.mp3', park: 'music/park.ogg', minigolf: 'music/minigolf.ogg', fantasy: 'music/fantasy.mp3', space: 'music/space.ogg',
};
/** Background loops: birds on the outdoor courses, a low wind in space. Wind rides on top, by the hole's wind. */
export type Ambience = 'outdoors' | 'space';
const AMBIENCE: Record<Ambience, string> = { outdoors: 'ambience/birds.ogg', space: 'ambience/space.mp3' };
const WIND = 'ambience/wind.ogg';
const RAIN = 'ambience/rain.ogg';

/** Music sits under the effects; ambience under both. */
const MUSIC_LEVEL = 0.45;
const AMBIENCE_LEVEL = 0.5;
const FADE = 1.2;

let ctx: AudioContext | null = null;
let sfxBus: GainNode, musicBus: GainNode, ambBus: GainNode;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** The audio graph, made on the first click or key (browsers refuse earlier). */
function audio(): AudioContext | null {
  if (ctx || typeof AudioContext === 'undefined') return ctx;
  ctx = new AudioContext();
  const bus = (v: number) => { const g = ctx!.createGain(); g.gain.value = v; g.connect(ctx!.destination); return g; };
  sfxBus = bus(0); musicBus = bus(0); ambBus = bus(0);
  applyVolumes();
  return ctx;
}

function applyVolumes(): void {
  if (!ctx) return;
  const p = prefs();
  const t = ctx.currentTime;
  const on = p.muted ? 0 : 1;
  sfxBus.gain.setTargetAtTime(p.sfx * on, t, 0.05);
  musicBus.gain.setTargetAtTime(p.music * MUSIC_LEVEL * on, t, 0.05);
  ambBus.gain.setTargetAtTime(p.sfx * AMBIENCE_LEVEL * on, t, 0.05);
}

function load(file: string): Promise<AudioBuffer | null> {
  let b = buffers.get(file);
  if (!b) {
    b = fetch(asset(`audio/sfx/${file}`)).then((r) => r.arrayBuffer()).then((a) => ctx!.decodeAudioData(a)).catch(() => null);
    buffers.set(file, b);
  }
  return b;
}

/** Play an effect. `gain` 0–1 (distance falloff, softer replays), `rate` pitch, `delay` seconds. */
export function sfx(name: Sfx, o: { gain?: number; rate?: number; delay?: number; fadeAfter?: number } = {}): void {
  const c = audio();
  if (!c || c.state !== 'running' || prefs().sfx <= 0 || prefs().muted) return;
  const files = SFX[name];
  void load(files[Math.floor(Math.random() * files.length)]).then((buf) => {
    if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.95 + Math.random() * 0.1);
    const g = c.createGain();
    g.gain.value = o.gain ?? 1;
    src.connect(g).connect(sfxBus);
    const at = c.currentTime + (o.delay ?? 0);
    src.start(at);
    // Long clips (applause): fade out and stop.
    if (o.fadeAfter !== undefined) {
      g.gain.setValueAtTime(o.gain ?? 1, at + o.fadeAfter);
      g.gain.linearRampToValueAtTime(0, at + o.fadeAfter + 1.5);
      src.stop(at + o.fadeAfter + 1.6);
    }
  });
}

/** Load these effects now so the first throw isn't silent while they download. */
export function preload(names: Sfx[]): void {
  if (!audio()) return;
  for (const n of names) for (const f of SFX[n]) void load(f);
}

// ---------- looping streams (music, ambience, wind) ----------

interface Loop { el: HTMLAudioElement; gain: GainNode; file: string }

/** A looping stream on a bus, crossfading from whatever played there before. */
class Channel {
  private cur: Loop | null = null;
  private want: { file: string | null; level: number } = { file: null, level: 1 };
  constructor(private bus: () => GainNode) {}

  set(file: string | null, level = 1): void {
    this.want = { file, level };
    this.sync();
  }

  /** Bring playback in line with what's wanted (also called once audio unlocks). */
  sync(): void {
    const c = ctx;
    if (!c || c.state !== 'running') return;
    const { file, level } = this.want;
    const t = c.currentTime;
    if (this.cur && this.cur.file === file) {
      this.cur.gain.gain.setTargetAtTime(level, t, FADE / 3);
      return;
    }
    if (this.cur) {
      const old = this.cur;
      old.gain.gain.setTargetAtTime(0, t, FADE / 3);
      setTimeout(() => { old.el.pause(); old.el.src = ''; old.gain.disconnect(); }, FADE * 3000);
      this.cur = null;
    }
    if (!file) return;
    const el = new Audio(asset(`audio/${file}`));
    el.loop = true;
    el.crossOrigin = 'anonymous';
    const gain = c.createGain();
    gain.gain.value = 0;
    c.createMediaElementSource(el).connect(gain).connect(this.bus());
    gain.gain.setTargetAtTime(level, t, FADE / 3);
    void el.play().catch(() => { /* blocked or missing: stay quiet */ });
    this.cur = { el, gain, file };
  }
}

const musicCh = new Channel(() => musicBus);
const ambCh = new Channel(() => ambBus);
const windCh = new Channel(() => ambBus);
const rainCh = new Channel(() => ambBus);

export function music(track: Track | null): void {
  musicCh.set(track && TRACKS[track]);
}

export function ambience(kind: Ambience | null): void {
  ambCh.set(kind && AMBIENCE[kind], 0.8);
}

/** Rain on (wet weather) or off. */
export function rain(on: boolean): void {
  rainCh.set(on ? RAIN : null, 0.9);
}

/** Wind noise for the hole's wind speed (m/s): silent when calm, full at 5. */
export function wind(speed: number): void {
  const v = Math.max(0, Math.min(1, (speed - 0.8) / 4.2));
  windCh.set(v > 0 ? WIND : null, 0.15 + 0.85 * v);
}

// ---------- start-up ----------

/** Unlock audio on the first gesture, follow the volume settings, pause with the tab. */
export function initSound(): void {
  const unlock = () => {
    const c = audio();
    if (!c) return;
    void c.resume().then(() => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      musicCh.sync(); ambCh.sync(); windCh.sync(); rainCh.sync();
    });
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('prefschange', applyVolumes);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  });
  // Every button clicks (a few have their own sounds and opt out with data-sound="off").
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest?.('button, .toggle input, select');
    if (!b || (b as HTMLElement).dataset.sound === 'off' || (b as HTMLButtonElement).disabled) return;
    sfx(b.matches('.toggle input') ? 'toggle' : 'click', { gain: 0.6 });
  });
}
