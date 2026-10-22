// Sound: effects, music and ambience on one Web Audio graph. Browsers start audio only after a
// click or key press, so nothing plays until then (music asked for earlier starts at that moment).
// Effects are decoded once and cached; music and ambience stream from <audio> elements, one track
// at a time, and crossfade. Volumes come from prefs (Settings → Music / Effects). Files and their
// licenses: public/audio/CREDITS.md.
//
// The effect files come from different packs at very different levels (15 dB apart), so each one
// is measured when it loads and scaled to the same loudness; LEVEL then sets the mix on purpose.
import { asset } from '../assets';
import { prefs } from '../settings';

/** Effect name → file variants in public/audio/sfx (one is picked at random each time). */
const SFX = {
  swish: ['swish-0.wav', 'swish-1.wav', 'swish-2.wav'],
  tree: ['tree-0.ogg', 'tree-1.ogg', 'tree-2.ogg', 'tree-3.ogg'],
  branch: ['branch-0.ogg', 'branch-1.ogg', 'branch-2.ogg', 'branch-3.ogg'],
  leaves: ['leaves-0.ogg', 'leaves-1.ogg', 'leaves-2.ogg', 'leaves-3.ogg'],
  bonk: ['bonk-0.ogg', 'bonk-1.ogg', 'bonk-2.ogg', 'bonk-3.ogg'],
  chain: ['chain-0.ogg', 'chain-1.ogg', 'chain-2.ogg'],
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
} as const;
export type Sfx = keyof typeof SFX;

/** Mix level of each effect, dB from the common loudness (0 = as loud as a tree hit). */
const LEVEL: Record<Sfx, number> = {
  swish: -6, tree: 0, branch: -3, leaves: -6, bonk: -2, chain: 1, clank: -2, tray: -3,
  'land-grass': -3, 'land-hard': -3, 'land-sand': -3, splash: 0, ob: -3, applause: -4,
  click: -10, select: -12, toggle: -10, confirm: -6, card: -8, deal: -8,
  'jingle-great': -3, 'jingle-birdie': -3, 'jingle-par': -3, 'jingle-bogey': -3,
};
/** The common loudness: RMS of a clip's loudest 300 ms, dBFS. */
const TARGET_DB = -18;
/** Scale at most this much either way (a near-silent tail shouldn't be blown up). */
const MAX_BOOST = 4;
/** How far past full scale a normalized peak may go (the limiter takes it). */
const PEAK_ROOM = 2;

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
/** Decoded effects, with the gain that brings each to TARGET_DB. */
const buffers = new Map<string, Promise<{ buf: AudioBuffer; norm: number } | null>>();

/** The audio graph, made on the first click or key (browsers refuse earlier). */
function audio(): AudioContext | null {
  if (ctx || typeof AudioContext === 'undefined') return ctx;
  ctx = new AudioContext();
  const bus = (v: number) => { const g = ctx!.createGain(); g.gain.value = v; g.connect(ctx!.destination); return g; };
  sfxBus = bus(0); musicBus = bus(0); ambBus = bus(0);
  // A limiter on the effects, so a few landing at once (chains, jingle, applause) don't clip.
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -3;
  limit.knee.value = 3;
  limit.ratio.value = 12;
  limit.attack.value = 0.003;
  limit.release.value = 0.2;
  sfxBus.disconnect();
  sfxBus.connect(limit).connect(ctx.destination);
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

function load(file: string): Promise<{ buf: AudioBuffer; norm: number } | null> {
  let b = buffers.get(file);
  if (!b) {
    b = fetch(asset(`audio/sfx/${file}`)).then((r) => r.arrayBuffer()).then((a) => ctx!.decodeAudioData(a))
      .then((buf) => ({ buf, norm: normGain(buf) })).catch(() => null);
    buffers.set(file, b);
  }
  return b;
}

/**
 * Gain that brings a clip's loudest 300 ms to TARGET_DB. A spiky clip (a thud's sharp attack) may
 * push its peak up to 2× full scale: the limiter on the effects bus rounds that off.
 */
export function normGain(buf: { length: number; sampleRate: number; numberOfChannels: number; getChannelData(c: number): Float32Array }): number {
  const n = buf.length, chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const w = Math.max(1, Math.min(n, Math.round(buf.sampleRate * 0.3)));
  let peak = 0, sum = 0, best = 0;
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of chans) m += c[i];
    m /= chans.length;
    peak = Math.max(peak, Math.abs(m));
    sq[i] = m * m;
    sum += sq[i];
    if (i >= w) sum -= sq[i - w];
    if (i >= w - 1) best = Math.max(best, sum / w);
  }
  if (n < w) best = sum / w;
  const rms = Math.sqrt(best);
  if (rms <= 0 || peak <= 0) return 1;
  const g = Math.pow(10, TARGET_DB / 20) / rms;
  return Math.max(1 / MAX_BOOST, Math.min(MAX_BOOST, g, PEAK_ROOM / peak));
}

/** Play an effect. `gain` 0–1 (distance falloff, softer replays), `rate` pitch, `delay` seconds. */
export function sfx(name: Sfx, o: { gain?: number; rate?: number; delay?: number; fadeAfter?: number } = {}): void {
  const c = audio();
  if (!c || c.state !== 'running' || prefs().sfx <= 0 || prefs().muted) return;
  const files = SFX[name];
  void load(files[Math.floor(Math.random() * files.length)]).then((clip) => {
    if (!clip) return;
    const src = c.createBufferSource();
    src.buffer = clip.buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.95 + Math.random() * 0.1);
    const g = c.createGain();
    const level = (o.gain ?? 1) * clip.norm * Math.pow(10, LEVEL[name] / 20);
    g.gain.value = level;
    src.connect(g).connect(sfxBus);
    const at = c.currentTime + (o.delay ?? 0);
    src.start(at);
    // Long clips (applause): fade out and stop.
    if (o.fadeAfter !== undefined) {
      g.gain.setValueAtTime(level, at + o.fadeAfter);
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
    sfx(b.matches('.toggle input') ? 'toggle' : 'click');
  });
}
