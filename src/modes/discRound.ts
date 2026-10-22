// Disc golf round state, driven only by events (the event log). Everything players share goes
// through apply(): holes starting (with their wind), throws landing, mulligans, Crazy mode drafts and
// placements. Anything random (wind, draft cards, placed tree sizes, the flight itself) is decided
// by whoever makes the event and travels inside it, so replaying the same log on any machine
// rebuilds the same round. Events are plain JSON (trees are referenced by index), ready to send to
// other players. No DOM here; src/modes/disc.ts presents the state.
import type { DiscHole, Tree } from '../course/disc-types';
import type { Vec2 } from '../course/geo';
import type { SurfaceClass } from '../course/types';
import type { ThrowEvent, ThrowResult } from '../disc/flight';
import { DISCS } from '../disc/discs';
import { neutralMods, rogueStartMods, type Mods } from '../disc/mods';
import { Round } from '../game/round';
import type { Vec3 } from '../game/terrain';
import { emptyChanges, pinFor, placementQueue, teeFor, type HoleChanges, type PlaceKind } from '../rogue/course';
import { byId, type Tier } from '../rogue/powerups';
import { cleanRules, DEFAULT_RULES, draftAfter, draftQueue, type CrazyRules } from '../rogue/rules';

/** A tree: a course tree by index, or a tree placed this hole (Sapling, Thicket) by index. */
export type TreeRef = number | { placed: number };

/** A throw's outcome as sent over the wire: trees as references, numbers rounded to mm. */
export interface WireResult {
  samples: Vec3[];
  banks: number[];
  rest: Vec2;
  restSurface: SurfaceClass;
  holed: boolean;
  penalty: number;
  events: ThrowEvent[];
  treesHit: TreeRef[];
  propHits?: string[];
}

export type RoundEvent =
  /** Start the next hole (the first one, the first time) with its wind (m/s, blowing toward). */
  | { t: 'hole-start'; wind: Vec2 }
  /**
   * A throw landed. `perfect`: a Perfect Form charge was used on it. `twin`: Clone Disc's other
   * throw, the one not kept (every other sample, for show only).
   */
  | { t: 'throw'; player: number; perfect: boolean; result: WireResult; twin?: Vec3[] }
  /** Take back the player's last throw (Crazy mode). */
  | { t: 'mulligan'; player: number }
  /** Crazy mode draft: the cards offered to a player (powerup ids). */
  | { t: 'offer'; player: number; tier: Tier; cards: string[]; bumped: number | null; starter: boolean }
  /** Spend a reroll (a new 'offer' follows). */
  | { t: 'reroll'; player: number }
  /** Take a card from the offer, or skip it (null). */
  | { t: 'pick'; player: number; id: string | null }
  /** Give a player an augment outside a draft (dev/play-test ?grant=). */
  | { t: 'grant'; player: number; id: string }
  /** A hex or Clear-Cut placed before a hole: the next step of the placement queue. */
  | { t: 'place'; player: number; kind: PlaceKind; tree?: Tree; pond?: { c: Vec2; r: number }; target?: TreeRef }
  /** Skip the next placement step. */
  | { t: 'place-skip'; player: number }
  /** The host closes the hole's scorecard: Crazy mode drafts follow, then the next hole. */
  | { t: 'next' }
  /** Crazy mode setup (the host's), the round's first event. */
  | { t: 'rules'; rules: CrazyRules }
  /** Bag building: the discs (ids) a player carries from now on. */
  | { t: 'bag'; player: number; discs: string[] };

/** What the round is waiting for (src/modes/disc.ts acts on it, or waits for whoever's turn it is). */
export type Stage =
  /** Crazy mode: the host's rules haven't arrived yet. */
  | 'need-rules'
  /** A Crazy mode draft: drafting[0] picks an augment. */
  | 'drafting'
  /** Bag building: players in `needBag` pick their discs (any order, all at once online). */
  | 'bagging'
  /** The next hole to start (the host starts it). */
  | 'need-hole'
  /** Hexes / Clear-Cuts to place before the hole: placing[0]. */
  | 'placing'
  /** The hole is being played: game.current throws. */
  | 'playing'
  /** The hole is over: its scorecard, until the host goes on (the final card stays). */
  | 'card';

interface Undo { idx: number; ball: Vec2; lie: SurfaceClass; strokes: number; pickedUp: boolean; lastFrom?: Vec2 }

export interface RoundOptions {
  names: string[];
  first: number;
  count: number;
  rogue: boolean;
  /** Bag building: everyone carries BAG_SIZE discs, picked before hole 1. */
  bag?: boolean;
}

/** Discs in a bag (Bag Pocket adds more, up to every disc). */
export const BAG_SIZE = 4;

export class DiscRound {
  readonly round: Round;
  readonly mods: Mods[];
  readonly owned: string[][];
  readonly mulligansLeft: number[];
  readonly perfectLeft: number[];
  changes: HoleChanges;
  /** Lumberjack: course trees cut down for everyone. */
  readonly removed = new Set<Tree>();
  /** Bumped whenever trees or ponds change (per-player physics worlds are cached on it). */
  version = 0;
  wind: Vec2 = [0, 0];
  /** Placement steps left before this hole's first throw (Crazy mode). */
  placing: { player: number; kind: PlaceKind }[] = [];
  /** The open draft offer, if any. */
  offer: Extract<RoundEvent, { t: 'offer' }> | null = null;
  /** The last throw, while it can still be taken back. */
  undo: Undo | null = null;
  /** Crazy mode: players still to draft this round of drafts, in order; `starter` before hole 1. */
  drafting: number[] = [];
  starter = false;
  /** Crazy mode setup (DEFAULT_RULES until the host's 'rules' event). */
  rules: CrazyRules = DEFAULT_RULES;
  /**
   * The tier of the current draft, shared by the whole group: set by its first offer, so everyone
   * drafting after gets the same tier.
   */
  draftTier: Tier | null = null;
  /** Bag building: each player's discs (ids), null until picked. */
  readonly bags: (string[] | null)[];
  private rulesSet = false;
  /** The host has closed this hole's scorecard. */
  private cardClosed = false;
  /** Every event applied so far, in order. */
  readonly log: RoundEvent[] = [];
  private started = false;

  constructor(
    readonly holes: DiscHole[],
    /** Course trees, in file order (TreeRef indexes into this). */
    readonly trees: Tree[],
    readonly opts: RoundOptions,
    /** OB / water test for moved tees (Back Tees). */
    readonly blocked: (q: Vec2) => boolean,
  ) {
    const n = opts.names.length;
    this.round = new Round(holes, opts.names, opts.first, opts.count);
    this.mods = opts.names.map(() => (opts.rogue ? rogueStartMods() : neutralMods()));
    this.owned = opts.names.map(() => []);
    this.mulligansLeft = opts.names.map(() => 0);
    this.perfectLeft = opts.names.map(() => 0);
    this.bags = opts.names.map(() => null);
    this.changes = emptyChanges(n);
    // Per-player tees/baskets (Forward Tee, Back Tees, Short Pin), decided when the hole is set up.
    this.round.setup = (hi) => {
      const h = holes[hi];
      return { tees: opts.names.map((_, i) => teeFor(h, this.mods, i, blocked)), pins: opts.names.map((_, i) => pinFor(h, this.mods[i])) };
    };
    this.round.restartHole();
  }

  get stage(): Stage {
    if (this.opts.rogue && !this.rulesSet) return 'need-rules';
    if (this.drafting.length) return 'drafting';
    if (this.needBag.length && (!this.started || (this.game.finished && this.cardClosed))) return 'bagging';
    if (!this.started) return 'need-hole';
    if (this.game.finished) return this.cardClosed && !this.round.isLastHole ? 'need-hole' : 'card';
    if (this.placing.length) return 'placing';
    return 'playing';
  }

  /** How many discs this player carries. */
  bagSize(p: number): number {
    return Math.min(DISCS.length, BAG_SIZE + this.mods[p].bagSlots);
  }

  /** Bag building: players whose bag isn't picked (or has room for more, after a Bag Pocket). */
  get needBag(): number[] {
    if (!this.opts.bag) return [];
    return this.bags.map((b, i) => (!b || b.length < this.bagSize(i) ? i : -1)).filter((i) => i >= 0);
  }

  get holeStarted(): boolean {
    return this.started;
  }

  /** A fresh round with the same setup, then every event of `log`: what a joining player does. */
  static replay(holes: DiscHole[], trees: Tree[], opts: RoundOptions, blocked: (q: Vec2) => boolean, log: RoundEvent[]): DiscRound {
    const r = new DiscRound(holes, trees, opts, blocked);
    for (const e of log) r.apply(e);
    return r;
  }

  get game() {
    return this.round.game;
  }

  get hole(): DiscHole {
    return this.round.hole as DiscHole;
  }

  apply(e: RoundEvent): void {
    this.log.push(e);
    switch (e.t) {
      case 'hole-start': {
        if (this.started) this.round.nextHole();
        this.started = true;
        this.mods.forEach((m, i) => { this.mulligansLeft[i] = m.mulligans; this.perfectLeft[i] = m.perfectForm; this.round.capBonus[i] = m.pickupBonus; });
        this.round.restartHole(); // this hole's per-player tees/baskets (nobody has thrown yet)
        this.changes = emptyChanges(this.opts.names.length);
        this.version++;
        this.wind = [e.wind[0], e.wind[1]];
        this.undo = null;
        this.cardClosed = false;
        this.placing = this.opts.rogue ? placementQueue(this.mods) : [];
        return;
      }
      case 'next': {
        if (!this.game.finished || this.cardClosed) return;
        this.cardClosed = true;
        // Crazy mode: draft in order of this hole's score (best first) before the next hole, on
        // the holes the rules say.
        const holesDone = this.round.index - this.round.first + 1;
        if (this.opts.rogue && !this.round.isLastHole && draftAfter(this.rules, holesDone)) {
          const g = this.game;
          this.drafting = draftQueue(g.players.map((_, i) => i).sort((a, b) => g.players[a].strokes - g.players[b].strokes), this.rules.picks);
          this.starter = false;
          this.draftTier = null;
        }
        return;
      }
      case 'rules': {
        if (this.rulesSet) return;
        this.rulesSet = true;
        this.rules = cleanRules(e.rules);
        // Starter draft: everyone picks before hole 1.
        if (this.opts.rogue && this.rules.starter) {
          this.drafting = draftQueue(this.opts.names.map((_, i) => i), this.rules.picks);
          this.starter = true;
          this.draftTier = null;
        }
        return;
      }
      case 'throw': {
        const g = this.game;
        const idx = e.player;
        g.current = idx;
        const pl = g.players[idx];
        this.undo = { idx, ball: pl.ball, lie: pl.lie, strokes: pl.strokes, pickedUp: pl.pickedUp, lastFrom: pl.lastFrom };
        if (e.perfect) this.perfectLeft[idx]--;
        const r = e.result;
        g.applyShot({ rest: [r.rest[0], r.rest[1]], restSurface: r.restSurface, holed: r.holed, penalty: r.penalty });
        // Lumberjack: cut down every tree the disc touched (a placed hex tree just leaves this hole).
        if (this.mods[idx].treeChopper && r.treesHit.length) {
          const hit = r.treesHit.map((t) => this.resolve(t));
          for (const t of hit) {
            const placed = this.changes.trees.findIndex((x) => x.tree === t);
            if (placed >= 0) this.changes.trees.splice(placed, 1);
            else if (t) this.removed.add(t);
          }
          this.version++;
        }
        if (g.finished) this.round.recordCurrent();
        return;
      }
      case 'mulligan': {
        const u = this.undo;
        if (!u || u.idx !== e.player) return;
        this.undo = null;
        Object.assign(this.game.players[u.idx], { ball: u.ball, lie: u.lie, strokes: u.strokes, pickedUp: u.pickedUp, lastFrom: u.lastFrom });
        this.game.current = u.idx;
        this.mulligansLeft[u.idx]--;
        // The hole isn't over any more for this player: un-record it.
        this.round.scores[u.idx][this.round.index] = undefined;
        return;
      }
      case 'offer':
        this.offer = e;
        this.draftTier ??= e.tier; // the first offer of a draft sets everyone's tier
        return;
      case 'reroll':
        this.mods[e.player].rerolls--;
        return;
      case 'pick':
        this.offer = null;
        if (this.drafting[0] === e.player) this.drafting.shift();
        if (e.id) this.grant(e.player, e.id);
        return;
      case 'grant':
        this.grant(e.player, e.id);
        return;
      case 'place': {
        this.placing.shift();
        if (e.pond) this.changes.ponds.push({ c: e.pond.c, r: e.pond.r, owner: e.player });
        else if (e.target !== undefined) { const t = this.resolve(e.target); if (t) this.changes.cleared[e.player].add(t); }
        else if (e.tree) this.changes.trees.push({ tree: { ...e.tree }, owner: e.player });
        this.version++;
        return;
      }
      case 'place-skip':
        this.placing.shift();
        return;
      case 'bag': {
        if (!this.opts.bag || !this.opts.names[e.player]) return;
        // The first discs listed that exist, once each, as many as the bag holds; in bag order.
        const order = DISCS.map((d) => d.id);
        const ids = [...new Set(e.discs)].filter((id) => order.includes(id)).slice(0, this.bagSize(e.player)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
        if (ids.length) this.bags[e.player] = ids;
        return;
      }
    }
  }

  private grant(player: number, id: string): void {
    const p = byId(id);
    if (!p) return;
    p.apply(this.mods[player]);
    this.owned[player].push(id);
  }

  // ---------- wire format ----------

  refOf(t: Tree): TreeRef {
    const placed = this.changes.trees.findIndex((x) => x.tree === t);
    if (placed >= 0) return { placed };
    return this.index().get(t) ?? -1;
  }

  resolve(r: TreeRef): Tree | undefined {
    return typeof r === 'number' ? this.trees[r] : this.changes.trees[r.placed]?.tree;
  }

  private treeIndex?: Map<Tree, number>;
  private index(): Map<Tree, number> {
    this.treeIndex ??= new Map(this.trees.map((t, i) => [t, i]));
    return this.treeIndex;
  }

  /** A simulated throw → its wire form (positions rounded to mm, trees as references). */
  wire(r: ThrowResult): WireResult {
    const mm = (v: number) => Math.round(v * 1000) / 1000;
    return {
      samples: r.samples.map((s) => [mm(s[0]), mm(s[1]), mm(s[2])]),
      banks: r.banks.map(mm),
      rest: [mm(r.rest[0]), mm(r.rest[1])],
      restSurface: r.restSurface, holed: r.holed, penalty: r.penalty, events: r.events,
      treesHit: r.treesHit.map((t) => this.refOf(t)),
      propHits: r.propHits,
    };
  }
}
