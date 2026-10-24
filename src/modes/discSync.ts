// A round's events between this browser and the room (src/net/room.ts): ours go out with the log
// position they claim, everyone else's queue up and are taken in order when the game isn't busy
// showing something. Hot seat has no room: events just apply.
import type { RoomClient, Welcome } from '../net/room';
import type { DiscRound, RoundEvent } from './discRound';
import { $ } from './discKit';

export interface NetPlay {
  room: RoomClient;
  isHost: boolean;
  mine: (player: number) => boolean;
  log: { seq: number; from: string; e: RoundEvent }[];
  /** Each player's browser (client id), and who was connected at the start. */
  seats: string[];
  present: string[];
}

export interface SyncHandlers {
  /** Another player's event, its turn come: show it (and apply it, or fly it first). */
  receive(e: RoundEvent): void;
  /** Something is on screen that this event must wait for (a flight, a replay, a pause). */
  busy(next: RoundEvent): boolean;
}

export class RoundSync {
  /** Events this browser knows of, ours and the room's: the next one's log position. */
  private known: number;
  private readonly sent = new Map<number, RoundEvent>();
  /** Other players' events waiting their turn (one arriving mid-flight waits for the landing). */
  private readonly inbox: RoundEvent[] = [];
  private pumping = false;

  constructor(private readonly st: DiscRound, private readonly net: NetPlay | null, private readonly h: SyncHandlers) {
    this.known = net ? net.log.length : 0;
  }

  /**
   * Apply one of our events and send it to the room. It goes through JSON first, exactly as
   * another player's arrives, so everyone applies the same thing.
   */
  commit(e: RoundEvent): void {
    if (this.inbox.length) return this.resync(); // someone else's event got in first: start over from the room's log
    this.st.apply(JSON.parse(JSON.stringify(e)) as RoundEvent);
    if (this.net) { this.sent.set(this.known, e); this.net.room.sendEvent(this.known, e); }
    this.known++;
  }

  /**
   * Online, our throw goes to the room the moment it's released, so everyone watches it fly at
   * the same time. Like everyone else, we apply it when it lands.
   */
  sendNow(e: RoundEvent): boolean {
    if (!this.net) return false;
    if (this.inbox.length) { this.resync(); return false; }
    this.sent.set(this.known, e);
    this.net.room.sendEvent(this.known, e);
    this.known++;
    return true;
  }

  /** Take waiting events while nothing is in the air (a mulligan may land during the pause). */
  pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.inbox.length) {
        if (this.h.busy(this.inbox[0])) break;
        this.h.receive(this.inbox.shift()!);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Our copy has diverged from the room's: reload, which rejoins and replays the room's log. */
  resync(): void {
    $('status').textContent = 'Out of step with the room: rejoining…';
    setTimeout(() => location.reload(), 600);
  }

  /** Someone else's event at log position seq. */
  received(seq: number, e: RoundEvent): void {
    if (seq < this.known) return; // already have it
    if (seq > this.known) return this.resync(); // missed some
    this.known++;
    this.inbox.push(e);
    this.pump();
  }

  /** Reconnected: pick up what we missed, resend what the room didn't get. */
  caughtUp(w: Welcome): void {
    for (const x of w.log) if (x.seq === this.known) { this.known++; this.inbox.push(x.e); } else if (x.seq > this.known) return this.resync();
    for (let q = w.count ?? w.log.length; q < this.known; q++) {
      const e = this.sent.get(q);
      if (!e) return this.resync();
      this.net!.room.sendEvent(q, e);
    }
    this.pump();
  }
}

/**
 * When passing state (live aim) goes out: only when it changed, and at most once per `ms`. A change
 * held back by the limit goes on a later frame, once the time is up.
 */
export class LiveGate {
  private last = '';
  private at = -Infinity;
  constructor(private readonly ms: number) {}

  /** Should state `key` go now? */
  pass(key: string, now: number): boolean {
    if (key === this.last || now - this.at < this.ms) return false;
    this.last = key;
    this.at = now;
    return true;
  }

  /** Forget what was sent (a new turn sends its first state straight away). */
  reset(): void {
    this.last = '';
  }
}
