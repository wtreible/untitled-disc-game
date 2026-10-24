// Browser side of an online room (server/src/index.ts): one WebSocket, reconnecting on drops.
// The room orders game events; this client sends ours with the log position they claim and hands
// everyone else's to the game, in order.
import type { RoundEvent } from '../modes/discRound';

export interface Seat {
  name: string;
  client: string;
  /** Picked color (older rooms don't have it: defaults by seat). */
  color?: string;
}

export interface Lobby {
  course: string;
  first: number;
  count: number;
  crazy: boolean;
  /** Bag building (older rooms don't have it). */
  bag?: boolean;
  seats: Seat[];
}

export interface Member {
  client: string;
  name: string;
  color?: string;
  /** Ready for the host to start (rooms from protocol 2). */
  ready?: boolean;
}

export interface Welcome {
  /** What the room speaks (1 if it doesn't say). */
  protocol?: number;
  you: string;
  host: string;
  lobby: Lobby | null;
  started: boolean;
  /** The game in progress (protocol 2). */
  game?: string;
  /** Events in the room's log, and the first one sent: a reconnect gets only what it's missing. */
  count?: number;
  since?: number;
  log: { seq: number; from: string; e: RoundEvent }[];
  members: Member[];
}

/** The room protocol this build speaks (server/src/index.ts PROTOCOL). */
export const PROTOCOL = 2;
/** Heartbeat: a `ping` this often; no answer within PING_TIMEOUT_MS means the connection is dead. */
const PING_MS = 15_000;
const PING_TIMEOUT_MS = 8_000;

/** Rooms server: VITE_ROOMS_URL at build time (wss://…workers.dev), or the local `npm run server:dev`. */
export const ROOMS_URL: string | null = roomsUrl(import.meta.env.VITE_ROOMS_URL || (import.meta.env.DEV ? 'ws://127.0.0.1:8787' : ''));

/**
 * Tidy the configured address: a trailing slash made every request //room/CODE (which the server
 * refuses, so the game reconnected forever), and an https:// address means wss://.
 */
export function roomsUrl(raw: string): string | null {
  const u = raw.trim().replace(/\/+$/, '').replace(/^http(s?):\/\//, 'ws$1://');
  return u || null;
}

/** This browser's id in rooms (kept, so a refresh rejoins as the same person). */
export function clientId(): string {
  const k = 'untitled-disc-game:client';
  try {
    let id = localStorage.getItem(k);
    if (!id) { id = `c${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`; localStorage.setItem(k, id); }
    return id;
  } catch {
    return `c${Math.random().toString(36).slice(2, 14)}`;
  }
}

/** Most players in a game, local or online (the room's seats; everyone past that watches). */
export const MAX_PLAYERS = 6;

/**
 * Names made distinct: a repeat (ignoring case) gets a 2-digit number, "Sam" and "Sam 47". The
 * number comes from `keys[i]` (a client id online, the seat locally), so it doesn't change as the
 * lobby updates.
 */
export function uniqueNames(names: string[], keys: string[] = names.map((_, i) => String(i))): string[] {
  const taken = new Set<string>();
  return names.map((raw, i) => {
    const name = raw.trim().slice(0, 16) || 'Player';
    if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name; }
    let h = 0;
    for (const c of keys[i] ?? '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
    for (let k = 0; ; k++) {
      const out = `${name.slice(0, 13)} ${10 + ((h + k) % 90)}`;
      if (!taken.has(out.toLowerCase())) { taken.add(out.toLowerCase()); return out; }
    }
  });
}

/** A short code friends can type: no 0/O or 1/I. */
export function newRoomCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

export interface RoomHandlers {
  /** First connect and every reconnect: the full state. */
  welcome?(w: Welcome): void;
  lobby?(l: Lobby): void;
  started?(l: Lobby): void;
  /** The host ended the game: the room is back in its lobby (log cleared). */
  ended?(l: Lobby | null): void;
  /** The host left for good: someone else hosts now. */
  host?(client: string): void;
  members?(m: Member[]): void;
  /** Someone else's event, at log position seq. */
  event?(seq: number, from: string, e: RoundEvent): void;
  /** Someone's passing state (the thrower's live aim). Not part of the log. */
  live?(from: string, s: unknown): void;
  /** One of ours was refused: someone else's landed first. The game should resync. */
  reject?(expected: number): void;
  status?(s: 'connecting' | 'open' | 'closed'): void;
  /** Round trip of the last heartbeat, ms. */
  ping?(ms: number): void;
  error?(reason: string): void;
}

export class RoomClient {
  readonly id = clientId();
  private ws: WebSocket | null = null;
  private handlers: RoomHandlers = {};
  private closedByUs = false;
  private retry = 0;
  /** What the room speaks (from its welcome). */
  protocol = 1;
  /** The game we're in, and how much of its log we have: a reconnect asks only for the rest. */
  game = '';
  private have = 0;
  private pingTimer = 0;
  private pingSent = 0;

  constructor(readonly code: string, private name: string, private color: string | null = null, private readonly url = ROOMS_URL!) {}

  on(h: RoomHandlers): void {
    this.handlers = { ...this.handlers, ...h };
  }

  connect(): void {
    this.closedByUs = false;
    this.handlers.status?.('connecting');
    const resume = this.game ? `&game=${this.game}&since=${this.have}` : '';
    const ws = new WebSocket(`${this.url}/room/${this.code}?client=${this.id}&name=${encodeURIComponent(this.name)}${this.color ? `&color=${encodeURIComponent(this.color)}` : ''}${resume}`);
    this.ws = ws;
    ws.addEventListener('open', () => { this.retry = 0; this.handlers.status?.('open'); });
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return;
      const raw = String(ev.data);
      if (raw === 'pong') { this.pong(); return; }
      let m: { type: string; [k: string]: unknown };
      try { m = JSON.parse(raw); } catch { return; }
      const h = this.handlers;
      switch (m.type) {
        case 'welcome': {
          const w = m as unknown as Welcome;
          this.protocol = w.protocol ?? 1;
          this.game = w.started ? w.game ?? '' : '';
          this.have = w.count ?? w.log.length;
          if (this.protocol >= 2) this.heartbeat();
          h.welcome?.(w);
          break;
        }
        case 'lobby': h.lobby?.(m.lobby as Lobby); break;
        case 'started': this.game = String(m.game ?? ''); this.have = 0; h.started?.(m.lobby as Lobby); break;
        case 'ended': this.game = ''; this.have = 0; h.ended?.(m.lobby as Lobby | null); break;
        case 'host': h.host?.(m.host as string); break;
        case 'members': h.members?.(m.members as Member[]); break;
        case 'event': this.saw(m.seq as number); h.event?.(m.seq as number, m.from as string, m.e as RoundEvent); break;
        case 'ack': this.saw(m.seq as number); break;
        case 'reject': h.reject?.(m.expected as number); break;
        case 'live': h.live?.(m.from as string, m.s); break;
        // A server from before live aim or colors (not redeployed yet) refuses them: harmless, so say nothing.
        case 'error': if (!/unknown message (live|color|ready)/.test(String(m.reason))) h.error?.(m.reason as string); break;
      }
    });
    ws.addEventListener('close', () => this.dropped(ws));
  }

  /** The connection is gone (closed, or silent past a heartbeat): reconnect, unless we left. */
  private dropped(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    clearTimeout(this.pingTimer);
    this.handlers.status?.('closed');
    if (this.closedByUs) return;
    // Back off: 0.5 s, 1 s, 2 s … up to 10 s, give or take a quarter so a room's players don't
    // all come back at once. The welcome on reconnect carries anything missed.
    const wait = Math.min(10000, 500 * 2 ** this.retry++) * (0.75 + Math.random() * 0.5);
    setTimeout(() => { if (!this.closedByUs) this.connect(); }, wait);
  }

  close(): void {
    this.closedByUs = true;
    clearTimeout(this.pingTimer);
    this.ws?.close();
  }

  /** The log position after seq is ours (an event or an ack). */
  private saw(seq: number): void {
    if (Number.isInteger(seq) && seq + 1 > this.have) this.have = seq + 1;
  }

  /** Ping now and then; a ping with no answer means a dead connection, so start a new one. */
  private heartbeat(): void {
    clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      this.pingSent = performance.now();
      ws.send('ping');
      // A dead connection can take a long while to report its close: don't wait for it.
      this.pingTimer = window.setTimeout(() => { this.dropped(ws); try { ws.close(); } catch { /* already closed */ } }, PING_TIMEOUT_MS);
    }, this.pingSent ? PING_MS : 1000);
  }

  private pong(): void {
    if (this.pingSent) this.handlers.ping?.(performance.now() - this.pingSent);
    this.heartbeat();
  }

  /** A new name for us: the room tells everyone (and it's the one used when reconnecting). */
  rename(name: string): void {
    this.name = name;
    this.send({ type: 'name', name });
  }

  /** A new color for us (#rrggbb): the room tells everyone, and the host's lobby takes it. */
  recolor(color: string): void {
    this.color = color;
    this.send({ type: 'color', color });
  }

  private send(m: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Ready (or not) for the host to start. */
  setReady(ready: boolean): void { this.send({ type: 'ready', ready }); }
  setLobby(l: Lobby): void { this.send({ type: 'lobby', lobby: l }); }
  start(): void { this.send({ type: 'start' }); }
  /** Host: the game is over, everyone back to the lobby for the next one. */
  end(): void { this.send({ type: 'end' }); }
  /** Passing state for the others (dropped if not connected; the next update replaces it). */
  sendLive(s: unknown): void { this.send({ type: 'live', s }); }
  /** Our event at log position seq (the number of events before it). */
  sendEvent(seq: number, e: RoundEvent): void { this.send({ type: 'event', seq, e }); }
}
