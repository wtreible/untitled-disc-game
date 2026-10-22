// Online rooms for Untitled Disc Game: a Cloudflare Worker with one Durable Object per room.
//
// A room is a lobby (who's in, which player each person controls, the course setup), then an
// append-only log of game events (src/modes/discRound.ts) stored in SQLite. The room doesn't run
// the game: it orders events, stores them and relays them. Each browser applies them.
//
//   wss://<worker>/room/<CODE>?client=<id>&name=<name>
//
// Messages are JSON. Client → room:
//   { type: 'lobby', lobby }        host only, before the start: course, holes, crazy, bag, seats
//   { type: 'start' }               host only: freeze the lobby; game events may follow
//   { type: 'end' }                 host only: the game is over; clear its log and reopen the lobby
//   { type: 'event', seq, e }       a game event, valid only if seq is the next log position
//   { type: 'live', s }             passing state (the thrower's aim, power): relayed, not stored
//   { type: 'name', name }          change our name (the host's lobby picks it up before the start)
// Room → client:
//   { type: 'welcome', you, host, lobby, started, log, members }   on connect (full catch-up)
//   { type: 'lobby', lobby } · { type: 'started', lobby } · { type: 'ended', lobby } · { type: 'members', members }
//   { type: 'event', seq, from, e }  to everyone else · { type: 'ack', seq } to the sender
//   { type: 'live', from, s }        someone's passing state
//   { type: 'reject', seq, expected, reason }   seq was stale (someone else got there first)
//   { type: 'error', reason }
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

/** One player in the lobby: a name and the browser (client id) that controls them. */
export interface Seat {
  name: string;
  client: string;
}

export interface Lobby {
  course: string;
  first: number;
  count: number;
  crazy: boolean;
  bag?: boolean;
  seats: Seat[];
}

interface Attachment {
  client: string;
  name: string;
}

const MAX_MESSAGE = 256 * 1024;
/** Live aim updates are small; anything bigger isn't one. */
const MAX_LIVE = 2048;
const MAX_EVENTS = 20000;
const MAX_SEATS = 6;
/** Rooms delete themselves after a week without activity. */
const IDLE_MS = 7 * 24 * 3600 * 1000;
const CODE = /^[A-Z0-9]{4,8}$/;
const ID = /^[A-Za-z0-9_-]{6,40}$/;

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, client TEXT NOT NULL, body TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const client = url.searchParams.get('client') ?? '';
    const name = (url.searchParams.get('name') ?? '').trim().slice(0, 16) || 'Player';
    if (!ID.test(client)) return new Response('bad client id', { status: 400 });
    const pair = new WebSocketPair();
    const [browser, server] = [pair[0], pair[1]];
    // Hibernation API: the room isn't billed for duration while everyone is just connected.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ client, name } satisfies Attachment);
    if (!this.get('host')) this.set('host', client); // whoever opens the room hosts it
    this.touch();
    server.send(JSON.stringify({
      type: 'welcome', you: client, host: this.get('host'), lobby: this.lobby(), started: this.get('started') === '1',
      log: this.log(), members: this.members(),
    }));
    this.broadcast({ type: 'members', members: this.members() }, server);
    return new Response(null, { status: 101, webSocket: browser });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return this.fail(ws, 'message too large');
    let msg: { type?: string; seq?: number; e?: unknown; lobby?: Lobby; name?: unknown };
    try { msg = JSON.parse(raw); } catch { return this.fail(ws, 'not JSON'); }
    const me = ws.deserializeAttachment() as Attachment;
    const isHost = me.client === this.get('host');
    const started = this.get('started') === '1';
    this.touch();
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
        this.set('started', '1');
        this.broadcast({ type: 'started', lobby });
        return;
      }
      case 'end': {
        // Everyone goes back to the same lobby (same seats and setup) for the next game.
        if (!isHost) return this.fail(ws, 'only the host ends the game');
        if (!started) return;
        this.sql.exec('DELETE FROM events');
        this.set('started', '0');
        this.broadcast({ type: 'ended', lobby: this.lobby() });
        return;
      }
      case 'event': {
        if (!started) return this.fail(ws, 'the game has not started');
        const next = this.count();
        if (msg.seq !== next) {
          ws.send(JSON.stringify({ type: 'reject', seq: msg.seq, expected: next, reason: 'stale' }));
          return;
        }
        if (next >= MAX_EVENTS) return this.fail(ws, 'room is full');
        const body = JSON.stringify(msg.e ?? null);
        this.sql.exec('INSERT INTO events (seq, client, body) VALUES (?, ?, ?)', next, me.client, body);
        ws.send(JSON.stringify({ type: 'ack', seq: next }));
        this.broadcast({ type: 'event', seq: next, from: me.client, e: msg.e }, ws);
        return;
      }
      case 'name': {
        const name = typeof msg.name === 'string' ? msg.name.trim().slice(0, 16) : '';
        if (!name) return this.fail(ws, 'bad name');
        // Every socket this browser has open (a reconnect can briefly leave two).
        for (const s of this.ctx.getWebSockets()) {
          const a = s.deserializeAttachment() as Attachment;
          if (a.client === me.client) s.serializeAttachment({ ...a, name } satisfies Attachment);
        }
        this.broadcast({ type: 'members', members: this.members() });
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
    this.broadcast({ type: 'members', members: this.members(ws) });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcast({ type: 'members', members: this.members(ws) });
  }

  async alarm(): Promise<void> {
    const last = Number(this.get('touched') ?? 0);
    if (Date.now() - last >= IDLE_MS && this.ctx.getWebSockets().length === 0) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(last + IDLE_MS);
  }

  // ---------- helpers ----------

  private get(k: string): string | undefined {
    const row = this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0];
    return row?.v;
  }

  private set(k: string, v: string): void {
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v);
  }

  /** Activity: push back the idle deletion. */
  private touch(): void {
    const now = Date.now();
    this.set('touched', String(now));
    void this.ctx.storage.setAlarm(now + IDLE_MS);
  }

  private lobby(): Lobby | null {
    const v = this.get('lobby');
    return v ? (JSON.parse(v) as Lobby) : null;
  }

  private count(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM events').one().n;
  }

  private log(): { seq: number; from: string; e: unknown }[] {
    return this.sql.exec<{ seq: number; client: string; body: string }>('SELECT seq, client, body FROM events ORDER BY seq')
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
    seats.push({ name: s.name.trim().slice(0, 16) || 'Player', client: s.client });
  }
  return { course: o.course, first: o.first!, count: o.count!, crazy: !!o.crazy, bag: !!o.bag, seats };
}
