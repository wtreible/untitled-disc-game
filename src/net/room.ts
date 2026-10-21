// Browser side of an online room (server/src/index.ts): one WebSocket, reconnecting on drops.
// The room orders game events; this client sends ours with the log position they claim and hands
// everyone else's to the game, in order.
import type { RoundEvent } from '../modes/discRound';

export interface Seat {
  name: string;
  client: string;
}

export interface Lobby {
  course: string;
  first: number;
  count: number;
  crazy: boolean;
  seats: Seat[];
}

export interface Member {
  client: string;
  name: string;
}

export interface Welcome {
  you: string;
  host: string;
  lobby: Lobby | null;
  started: boolean;
  log: { seq: number; from: string; e: RoundEvent }[];
  members: Member[];
}

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
  const k = 'sat-golf:client';
  try {
    let id = localStorage.getItem(k);
    if (!id) { id = `c${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`; localStorage.setItem(k, id); }
    return id;
  } catch {
    return `c${Math.random().toString(36).slice(2, 14)}`;
  }
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
  members?(m: Member[]): void;
  /** Someone else's event, at log position seq. */
  event?(seq: number, from: string, e: RoundEvent): void;
  /** One of ours was refused: someone else's landed first. The game should resync. */
  reject?(expected: number): void;
  status?(s: 'connecting' | 'open' | 'closed'): void;
  error?(reason: string): void;
}

export class RoomClient {
  readonly id = clientId();
  private ws: WebSocket | null = null;
  private handlers: RoomHandlers = {};
  private closedByUs = false;
  private retry = 0;

  constructor(readonly code: string, private name: string, private readonly url = ROOMS_URL!) {}

  on(h: RoomHandlers): void {
    this.handlers = { ...this.handlers, ...h };
  }

  connect(): void {
    this.closedByUs = false;
    this.handlers.status?.('connecting');
    const ws = new WebSocket(`${this.url}/room/${this.code}?client=${this.id}&name=${encodeURIComponent(this.name)}`);
    this.ws = ws;
    ws.addEventListener('open', () => { this.retry = 0; this.handlers.status?.('open'); });
    ws.addEventListener('message', (ev) => {
      let m: { type: string; [k: string]: unknown };
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      const h = this.handlers;
      switch (m.type) {
        case 'welcome': h.welcome?.(m as unknown as Welcome); break;
        case 'lobby': h.lobby?.(m.lobby as Lobby); break;
        case 'started': h.started?.(m.lobby as Lobby); break;
        case 'members': h.members?.(m.members as Member[]); break;
        case 'event': h.event?.(m.seq as number, m.from as string, m.e as RoundEvent); break;
        case 'reject': h.reject?.(m.expected as number); break;
        case 'error': h.error?.(m.reason as string); break;
      }
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.handlers.status?.('closed');
      if (this.closedByUs) return;
      // Back off: 0.5 s, 1 s, 2 s … up to 10 s. The welcome on reconnect carries anything missed.
      const wait = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => { if (!this.closedByUs) this.connect(); }, wait);
    });
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }

  rename(name: string): void {
    this.name = name;
  }

  private send(m: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  setLobby(l: Lobby): void { this.send({ type: 'lobby', lobby: l }); }
  start(): void { this.send({ type: 'start' }); }
  /** Our event at log position seq (the number of events before it). */
  sendEvent(seq: number, e: RoundEvent): void { this.send({ type: 'event', seq, e }); }
}
