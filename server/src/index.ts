// Online rooms for Untitled Disc Game: a Cloudflare Worker with one Durable Object per room.
//
// A room is a lobby (who's in, which player each person controls, the course setup), then an
// append-only log of game events (src/modes/discRound.ts) stored in SQLite. The room doesn't run
// the game: it orders events, stores them and relays them. Each browser applies them.
//
//   wss://<worker>/room/<CODE>?client=<id>&name=<name>[&color=<#rrggbb>][&game=<id>&since=<seq>]
//
// A reconnect names the game it was in and how much of its log it has (`game`, `since`); if that
// game is still on, the welcome carries only the rest of the log. The text frame `ping` gets `pong`
// straight from Cloudflare, without waking the room (a cheap heartbeat).
//
// Messages are JSON. Client → room:
//   { type: 'lobby', lobby }        host only, before the start: course, holes, crazy, bag, seats
//   { type: 'start' }               host only: freeze the lobby; game events may follow
//   { type: 'end' }                 host only: the game is over; clear its log and reopen the lobby
//   { type: 'event', seq, e }       a game event, valid only if seq is the next log position
//   { type: 'live', s }             passing state (the thrower's aim, power): relayed, not stored
//   { type: 'name', name }          change our name (the host's lobby picks it up before the start)
//   { type: 'color', color }        change our color (#rrggbb), likewise
//   { type: 'ready', ready }        ready (or not) for the host to start; cleared by start and end
// Room → client:
//   { type: 'welcome', protocol, you, host, lobby, started, game, count, since, log, members }
//                                   on connect: the log from `since` (0: all of it) of `count` events
//   { type: 'lobby', lobby } · { type: 'started', lobby, game } · { type: 'ended', lobby } · { type: 'members', members }
//   { type: 'host', host }           the host left for good: someone else hosts now
//   { type: 'event', seq, from, e }  to everyone else · { type: 'ack', seq } to the sender
//   { type: 'live', from, s }        someone's passing state
//   { type: 'reject', seq, expected, reason }   seq was stale (someone else got there first)
//   { type: 'error', reason }
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

/** One player in the lobby: a name, a color, and the browser (client id) that controls them. */
export interface Seat {
  name: string;
  client: string;
  color?: string;
}

export interface Lobby {
  course: string;
  first: number;
  count: number;
  crazy: boolean;
  bag?: boolean;
  /** Best shot: each seat's team (0–5), at least two teams. */
  teams?: number[];
  /** Tees and pins: long/short, A/B/mixed (with the mixed pins' seed). */
  layout?: { tees: 'long' | 'short' | 'pro'; pins: 'A' | 'B' | 'mixed'; seed?: number };
  seats: Seat[];
}

interface Attachment {
  client: string;
  name: string;
  color?: string;
  ready?: boolean;
}

/**
 * What the room speaks, sent in the welcome (missing: 1). 2: `since` reconnects, `ping`, host
 * migration, `ready`.
 */
const PROTOCOL = 2;

const MAX_MESSAGE = 256 * 1024;
/** Live aim updates are small; anything bigger isn't one. */
const MAX_LIVE = 2048;
const MAX_EVENTS = 20000;
const MAX_SEATS = 6;
/** Rooms delete themselves after a week without activity. */
const IDLE_MS = 7 * 24 * 3600 * 1000;
/** Activity is written down at most this often (the idle clock doesn't need better). */
const TOUCH_MS = 60_000;
/** A host who drops is waited for this long (a refresh is quicker) before someone else hosts. */
const HOST_GRACE_MS = 10_000;
const CODE = /^[A-Z0-9]{4,8}$/;
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]+)$/);
    if (!m) return new Response('Untitled Disc Game rooms. Connect a WebSocket to /room/<CODE>.', { status: 404 });
    const code = m[1].toUpperCase();
    if (!CODE.test(code)) return new Response('bad room code', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  /** The meta table, read once per wake (the constructor runs again after hibernation). */
  private readonly meta = new Map<string, string>();
  /** Events in the log. */
  private n = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, client TEXT NOT NULL, body TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    for (const r of this.sql.exec<{ k: string; v: string }>('SELECT k, v FROM meta')) this.meta.set(r.k, r.v);
    this.n = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM events').one().n;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const client = url.searchParams.get('client') ?? '';
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 16) || 'Player';
    if (!ID.test(client)) return new Response('bad client id', { status: 400 });
    const color = url.searchParams.get('color') ?? '';
    const pair = new WebSocketPair();
    const [browser, server] = [pair[0], pair[1]];
    // Hibernation API: the room isn't billed for duration while everyone is just connected.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ client, name, ...(COLOR.test(color) ? { color } : {}) } satisfies Attachment);
    if (!this.get('host')) this.set('host', client); // whoever opens the room hosts it
    if (this.get('host') === client && this.get('hostGone')) { this.del('hostGone'); void this.schedule(); }
    this.touch();
    // A reconnect to the same game gets only what it's missing.
    const game = this.get('game') ?? '';
    const since = url.searchParams.get('game') === game && game ? Math.min(this.n, Math.max(0, parseInt(url.searchParams.get('since') ?? '0', 10) || 0)) : 0;
    server.send(JSON.stringify({
      type: 'welcome', protocol: PROTOCOL, you: client, host: this.get('host'), lobby: this.lobby(), started: this.get('started') === '1',
      game, count: this.n, since, log: this.log(since), members: this.members(),
    }));
    this.broadcast({ type: 'members', members: this.members() }, server);
    return new Response(null, { status: 101, webSocket: browser });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return this.fail(ws, 'message too large');
    let msg: { type?: string; seq?: number; e?: unknown; lobby?: Lobby; name?: unknown; color?: unknown };
    try { msg = JSON.parse(raw); } catch { return this.fail(ws, 'not JSON'); }
    const me = ws.deserializeAttachment() as Attachment;
    const isHost = me.client === this.get('host');
    const started = this.get('started') === '1';
    if (msg.type !== 'live') this.touch(); // live aim is many small messages a second: not activity worth a write
    switch (msg.type) {
      case 'lobby': {
        if (!isHost) return this.fail(ws, 'only the host sets up the game');
        if (started) return this.fail(ws, 'the game has started');
        const lobby = cleanLobby(msg.lobby);
        if (!lobby) return this.fail(ws, 'bad lobby');
        this.set('lobby', JSON.stringify(lobby));
        this.broadcast({ type: 'lobby', lobby });
        return;
      }
      case 'start': {
        if (!isHost) return this.fail(ws, 'only the host starts the game');
        if (started) return;
        const lobby = this.lobby();
        if (!lobby || lobby.seats.length === 0) return this.fail(ws, 'no players');
        const game = crypto.randomUUID().slice(0, 8);
        this.set('started', '1');
        this.set('game', game);
        this.clearReady();
        this.broadcast({ type: 'started', lobby, game });
        return;
      }
      case 'end': {
        // Everyone goes back to the same lobby (same seats and setup) for the next game.
        if (!isHost) return this.fail(ws, 'only the host ends the game');
        if (!started) return;
        this.sql.exec('DELETE FROM events');
        this.n = 0;
        this.set('started', '0');
        this.del('game');
        this.clearReady();
        this.broadcast({ type: 'ended', lobby: this.lobby() });
        return;
      }
      case 'event': {
        if (!started) return this.fail(ws, 'the game has not started');
        const next = this.n;
        if (msg.seq !== next) {
          ws.send(JSON.stringify({ type: 'reject', seq: msg.seq, expected: next, reason: 'stale' }));
          return;
        }
        if (next >= MAX_EVENTS) return this.fail(ws, 'room is full');
        const body = JSON.stringify(msg.e ?? null);
        this.sql.exec('INSERT INTO events (seq, client, body) VALUES (?, ?, ?)', next, me.client, body);
        this.n++;
        ws.send(JSON.stringify({ type: 'ack', seq: next }));
        this.broadcast({ type: 'event', seq: next, from: me.client, e: msg.e }, ws);
        return;
      }
      case 'name': {
        const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 16) : '';
        if (!name) return this.fail(ws, 'bad name');
        this.update(me.client, { name });
        return;
      }
      case 'color': {
        const color = typeof msg.color === 'string' && COLOR.test(msg.color) ? msg.color : '';
        if (!color) return this.fail(ws, 'bad color');
        this.update(me.client, { color });
        return;
      }
      case 'ready': {
        if (started) return;
        this.update(me.client, { ready: !!(msg as { ready?: unknown }).ready });
        return;
      }
      case 'live': {
        // Relayed as-is to everyone else, never stored (it doesn't touch the log or the billing for storage).
        if (raw.length > MAX_LIVE) return;
        this.broadcast({ type: 'live', from: me.client, s: (msg as { s?: unknown }).s ?? null }, ws);
        return;
      }
      default:
        return this.fail(ws, `unknown message ${String(msg.type)}`);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try { ws.close(code, 'bye'); } catch { /* already closed */ }
    this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  /** Someone's socket closed. If it was the host's last one, give them a moment to come back. */
  private left(ws: WebSocket): void {
    const members = this.members(ws);
    this.broadcast({ type: 'members', members });
    const host = this.get('host');
    if (host && !members.some((m) => m.client === host) && !this.get('hostGone')) {
      this.set('hostGone', String(Date.now()));
      void this.schedule();
    }
  }

  /** One alarm does two jobs: hand the room to a new host, and delete the room once idle. */
  async alarm(): Promise<void> {
    const gone = Number(this.get('hostGone') ?? 0);
    if (gone && Date.now() - gone >= HOST_GRACE_MS) this.migrateHost();
    const last = Number(this.get('touched') ?? 0);
    if (Date.now() - last >= IDLE_MS && this.ctx.getWebSockets().length === 0) await this.ctx.storage.deleteAll();
    else await this.schedule();
  }

  /**
   * The host hasn't come back: the first seated player who's here hosts (or anyone here). Nobody
   * here: whoever connects next does.
   */
  private migrateHost(): void {
    this.del('hostGone');
    const here = this.members();
    const seats = this.lobby()?.seats ?? [];
    const next = seats.find((q) => here.some((m) => m.client === q.client))?.client ?? here[0]?.client;
    if (next) this.set('host', next); else this.del('host');
    if (next) this.broadcast({ type: 'host', host: next });
  }

  private async schedule(): Promise<void> {
    const gone = Number(this.get('hostGone') ?? 0);
    const idle = Number(this.get('touched') ?? Date.now()) + IDLE_MS;
    await this.ctx.storage.setAlarm(gone ? Math.min(idle, gone + HOST_GRACE_MS) : idle);
  }

  // ---------- helpers ----------

  private get(k: string): string | undefined {
    return this.meta.get(k);
  }

  private set(k: string, v: string): void {
    if (this.meta.get(k) === v) return;
    this.meta.set(k, v);
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v);
  }

  private del(k: string): void {
    if (!this.meta.delete(k)) return;
    this.sql.exec('DELETE FROM meta WHERE k = ?', k);
  }

  /** Activity: push back the idle deletion (written at most once a minute). */
  private touch(): void {
    const now = Date.now();
    if (now - Number(this.get('touched') ?? 0) < TOUCH_MS) return;
    this.set('touched', String(now));
    void this.schedule();
  }

  /** Change this browser's details on every socket it has open (a reconnect can briefly leave two), and tell everyone. */
  private update(client: string, change: Partial<Attachment>): void {
    for (const s of this.ctx.getWebSockets()) {
      const a = s.deserializeAttachment() as Attachment;
      if (a.client === client) s.serializeAttachment({ ...a, ...change } satisfies Attachment);
    }
    this.broadcast({ type: 'members', members: this.members() });
  }

  /** Clear everyone's ready flag (start and end). */
  private clearReady(): void {
    for (const s of this.ctx.getWebSockets()) {
      const a = s.deserializeAttachment() as Attachment;
      if (a.ready) s.serializeAttachment({ ...a, ready: false } satisfies Attachment);
    }
  }

  private lobby(): Lobby | null {
    const v = this.get('lobby');
    return v ? (JSON.parse(v) as Lobby) : null;
  }

  private log(since = 0): { seq: number; from: string; e: unknown }[] {
    return this.sql.exec<{ seq: number; client: string; body: string }>('SELECT seq, client, body FROM events WHERE seq >= ? ORDER BY seq', since)
      .toArray().map((r) => ({ seq: r.seq, from: r.client, e: JSON.parse(r.body) }));
  }

  /** Connected people (one entry per browser), optionally leaving out a socket that is closing. */
  private members(except?: WebSocket): Attachment[] {
    const seen = new Map<string, Attachment>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState > 1) continue;
      const a = ws.deserializeAttachment() as Attachment;
      seen.set(a.client, a);
    }
    return [...seen.values()];
  }

  private broadcast(msg: unknown, except?: WebSocket): void {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch { /* closing */ }
    }
  }

  private fail(ws: WebSocket, reason: string): void {
    ws.send(JSON.stringify({ type: 'error', reason }));
  }
}

function cleanLobby(l: unknown): Lobby | null {
  if (!l || typeof l !== 'object') return null;
  const o = l as Partial<Lobby>;
  if (typeof o.course !== 'string' || o.course.length > 32) return null;
  if (!Number.isInteger(o.first) || !Number.isInteger(o.count) || o.first! < 0 || o.count! < 1 || o.count! > 18) return null;
  if (!Array.isArray(o.seats) || o.seats.length > MAX_SEATS) return null;
  const seats: Seat[] = [];
  for (const s of o.seats) {
    if (!s || typeof s.name !== 'string' || typeof s.client !== 'string' || !ID.test(s.client)) return null;
    seats.push({ name: s.name.trim().slice(0, 16) || 'Player', client: s.client, ...(typeof s.color === 'string' && COLOR.test(s.color) ? { color: s.color } : {}) });
  }
  // One team per seat, 0–5, and at least two different ones; anything else is dropped.
  const teams = Array.isArray(o.teams) && o.teams.length === seats.length && o.teams.every((t) => Number.isInteger(t) && t >= 0 && t < MAX_SEATS) && new Set(o.teams).size >= 2 ? [...o.teams] : undefined;
  const lay = o.layout;
  const layout = lay && (lay.tees === 'long' || lay.tees === 'short' || lay.tees === 'pro') && (lay.pins === 'A' || lay.pins === 'B' || lay.pins === 'mixed')
    ? { tees: lay.tees, pins: lay.pins, ...(Number.isInteger(lay.seed) ? { seed: lay.seed } : {}) } : undefined;
  return { course: o.course, first: o.first!, count: o.count!, crazy: !!o.crazy, bag: !!o.bag, ...(teams ? { teams } : {}), ...(layout ? { layout } : {}), seats };
}
