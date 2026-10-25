// Main menu: course, players, round (holes / Crazy mode) and settings, then hand off to the disc
// golf mode. "Play again" / "Quit to main menu" reload, which brings the menu back with the last
// choices filled in. (Golf still lives in src/modes/golf.ts but isn't on the menu: disc only for now.)
import { COLOR_CHOICES, PLAYER_COLORS, playerColors } from './game/game';
import { mountSettings } from './ui/settingsForm';
import { isKey, keyFor, type KeyAction } from './keys';
import { reloadPage } from './ui/leaveGuard';
import { defaultTeams, nextTeam, teamGroups, teamsLabel } from './game/teams';
import { mountNetStatus } from './ui/netStatus';
import { IMAGERY, data } from './assets';
import { fmtLen } from './units';
import { DEFAULT_LAYOUT, isDefault, type Layout } from './course/layout';
import { BOT_LEVELS, botClient, botOfClient, type BotLevel } from './game/bot';
import { FORMATS, type Format, type TeamPlay } from './game/formats';
import { DISC_DESIGNS, designCanvas, isDesign } from './render/discDesigns';
import { MAX_PLAYERS, PROTOCOL, ROOMS_URL, RoomClient, newRoomCode, uniqueNames, type Lobby, type Member } from './net/room';
import type { RoundEvent } from './modes/discRound';
import { cleanRules, RULE_LIMITS, tierWeights, type CrazyRules } from './rogue/rules';
import { closeAugmentBrowser, openAugmentBrowser } from './ui/augments';
import { closeStats, openStats } from './ui/statsView';
import { initSound, music, sfx } from './audio/sound';
import { prefs, setPref } from './settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const load = <T>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; }
};
const save = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
};

type CourseId = 'simple' | 'silly' | 'forest' | 'oakgrove' | 'bechovice' | 'skatas' | 'kincaid' | 'julkujarvi' | 'bluelake' | 'prater' | 'greer' | 'fantasy' | 'rainbow' | 'pirate' | 'graveyard' | 'winter' | 'range' | 'tutorial' | 'crazy-tutorial' | 'putting';
/** Real: actual courses from map data. Arcade: hand-built themed courses. */
type Group = 'real' | 'arcade' | 'training';
const GROUPS: { id: Group; label: string; sub: string }[] = [
  { id: 'real', label: 'Real', sub: 'Mapped from the real world' },
  { id: 'arcade', label: 'Arcade', sub: 'Themed and a little ridiculous' },
  { id: 'training', label: 'Training', sub: 'Get a feel for the discs' },
];
const COURSES: { id: CourseId; group: Group; name: string; meta: string; holes: number; blurb: string; art: string }[] = [
  {
    id: 'simple', group: 'real', name: 'Tali Recreation', meta: 'Helsinki, Finland · the easy version', holes: 18,
    blurb: 'The real Tali disc golf park layout and its real trees, drawn clean, with the woods cut back a few meters from every fairway, green and tee. Tali Forest is the real thing.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#3c4a37"/><path d="M8 58 C 20 40, 30 30, 50 8" stroke="#8cc063" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="20" cy="26" r="7" fill="#2f6a2f"/><circle cx="44" cy="40" r="6" fill="#2f6a2f"/><circle cx="50" cy="9" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'silly', group: 'arcade', name: 'Mini Golf Madness', meta: 'Windmills, castles, giant animals', holes: 9,
    blurb: 'A full-size course themed like mini golf: thread the giant windmill’s tunnel past spinning blades, fly a castle gate, dodge cows, penguins and giant golf balls.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#4f8f45"/><rect x="0" y="40" width="64" height="24" fill="#2fb24c"/><path d="M26 44 L29 22 L35 22 L38 44 Z" fill="#c9a27a"/><g transform="translate(32 24)" stroke="#8a4b2e" stroke-width="4" stroke-linecap="round"><path d="M-12 -12 L12 12 M12 -12 L-12 12"/></g><circle cx="32" cy="24" r="2.5" fill="#999"/><circle cx="50" cy="50" r="5" fill="#e2504f"/></svg>`,
  },
  {
    id: 'forest', group: 'real', name: 'Tali Forest', meta: `Helsinki, Finland${IMAGERY ? ' · satellite imagery' : ''} · 10k real-canopy trees`, holes: 18,
    blurb: `The same Tali holes${IMAGERY ? ' over live satellite imagery' : ''}, with ~10,000 trees placed from Helsinki’s 2024 canopy data. Tight and woody.`,
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#24391f"/>${Array.from({ length: 18 }, (_, i) => `<circle cx="${(i * 37) % 64}" cy="${(i * 23) % 64}" r="${5 + (i % 3)}" fill="${i % 2 ? '#2f5a2a' : '#3b6e33'}"/>`).join('')}<path d="M10 60 L54 6" stroke="#8a9a6a" stroke-width="5" stroke-dasharray="1 0" opacity=".7"/></svg>`,
  },
  {
    id: 'oakgrove', group: 'real', name: 'Oak Grove Gold', meta: `Stockton, California${IMAGERY ? ' · satellite imagery' : ''} · mapped oaks`, holes: 18,
    blurb: 'The Gold Course at Oak Grove Regional Park, from OpenStreetMap: eighteen short, open holes among the park’s oaks, every mapped tree where it stands, and a pond to cross on 17.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#6f7f45"/><path d="M6 56 C 22 46, 30 30, 54 14" stroke="#b9c47a" stroke-width="7" fill="none" stroke-linecap="round"/>${[[16, 24, 8], [44, 42, 9], [30, 52, 6], [50, 26, 5], [12, 44, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#3f5a2a"/>`).join('')}<ellipse cx="40" cy="56" rx="9" ry="4" fill="#4f8fcf"/><circle cx="54" cy="14" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'bechovice', group: 'real', name: 'DiscGolfPark Běchovice', meta: `Prague, Czechia${IMAGERY ? ' · satellite imagery' : ''} · mapped woods`, holes: 18,
    blurb: 'DiscGolfPark Běchovice’s long (gold) tees, from OpenStreetMap: Prague’s hardest course, host of the 2023 Czech championship, with long par 4s and 5s through and around its woods.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#7c8a4a"/>${[[8, 10, 9], [20, 6, 8], [52, 50, 10], [58, 34, 7], [6, 40, 8], [40, 8, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#35512a"/>`).join('')}<path d="M10 58 C 24 50, 26 30, 44 24 S 56 10, 52 6" stroke="#c3cb86" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="26" y="44" width="3" height="12" fill="#eef2e6"/><rect x="34" y="40" width="3" height="14" fill="#eef2e6"/><circle cx="52" cy="6" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'skatas', group: 'real', name: 'Skatås Yellow', meta: `Gothenburg, Sweden${IMAGERY ? ' · satellite imagery' : ''} · 2,300 mapped trees`, holes: 20,
    blurb: 'The yellow course at Skatås, one of Sweden’s classic courses (since 1990), from OpenStreetMap: twenty short, technical holes through pine, spruce and birch woods, alternates 14b and 15b included.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#2c4428"/>${Array.from({ length: 14 }, (_, i) => `<path d="M${(i * 29) % 64} ${(i * 41) % 64} l5 12 h-10 z" fill="${i % 3 ? '#1f3a24' : '#3f6a3a'}"/>`).join('')}<path d="M8 58 C 20 48, 18 30, 34 26 S 52 18, 54 8" stroke="#a8b98a" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="40" y="44" width="2.5" height="12" fill="#eef2e6"/><circle cx="54" cy="8" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'kincaid', group: 'real', name: 'Kincaid Park', meta: `Anchorage, Alaska${IMAGERY ? ' · satellite imagery' : ''} · birch and spruce`, holes: 18,
    blurb: 'Kincaid Park’s course, from OpenStreetMap: one of Alaska’s best-rated, a mix of long and tight holes cut through birch and spruce.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#3d5a38"/>${[[8, 12], [18, 30], [6, 48], [52, 14], [56, 40], [44, 54]].map(([x, y]) => `<path d="M${x} ${y - 8} l5 14 h-10 z" fill="#1f3a26"/>`).join('')}${[[30, 10], [48, 30], [14, 58]].map(([x, y]) => `<rect x="${x}" y="${y - 6}" width="2" height="10" fill="#f2f2ea"/><circle cx="${x + 1}" cy="${y - 7}" r="4" fill="#8db45a"/>`).join('')}<path d="M10 54 C 24 46, 30 34, 50 22" stroke="#c7cf98" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="50" cy="22" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'julkujarvi', group: 'real', name: 'Julkujärvi DiscGolfPark', meta: `Ylöjärvi, Finland${IMAGERY ? ' · satellite imagery' : ''} · pro course`, holes: 18,
    blurb: 'The PRO course at Julkujärvi, near Tampere, from OpenStreetMap: a pro-level eighteen with par 4s and 5s through Finnish pine and birch, used at the 2025 European Amateur Open.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#4a6a3c"/>${Array.from({ length: 12 }, (_, i) => `<path d="M${(i * 23) % 64} ${(i * 37) % 64} l4 11 h-8 z" fill="#284a2c"/>`).join('')}<path d="M6 30 C 20 20, 40 44, 58 30" stroke="#d3d79e" stroke-width="7" fill="none" stroke-linecap="round"/><ellipse cx="18" cy="54" rx="11" ry="5" fill="#4f8fcf"/><circle cx="58" cy="30" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'bluelake', group: 'real', name: 'Blue Lake', meta: `Portland, Oregon${IMAGERY ? ' · satellite imagery' : ''} · 18 holes`, holes: 18,
    blurb: 'Blue Lake Park, host of the 2014 PDGA Worlds and the first Portland Open, from OpenStreetMap: long, open holes among oaks and firs.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#6f8a4a"/><ellipse cx="46" cy="14" rx="16" ry="8" fill="#4f8fcf"/>${[[12, 16, 7], [24, 44, 6], [52, 46, 7]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#3e5a2a"/>`).join('')}${[[8, 40], [40, 34], [58, 58]].map(([x, y]) => `<path d="M${x} ${y - 9} l5 14 h-10 z" fill="#244028"/>`).join('')}<path d="M6 58 C 22 54, 30 40, 40 30" stroke="#d0d79a" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="40" cy="30" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'prater', group: 'real', name: 'Wiener Prater', meta: `Vienna, Austria${IMAGERY ? ' · satellite imagery' : ''} · park woods`, holes: 18,
    blurb: 'The disc golf course in Vienna’s Prater, from OpenStreetMap: eighteen holes from 65 to 210 m through the old park’s chestnuts, oaks and poplars, with the course’s own pars.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#5e7c3e"/>${[[10, 12, 8], [30, 8, 6], [52, 18, 8], [8, 40, 7], [56, 46, 8], [26, 56, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#35522a"/>`).join('')}<circle cx="44" cy="38" r="9" fill="none" stroke="#e7e2d0" stroke-width="2"/><path d="M44 29 V47 M35 38 H53" stroke="#e7e2d0" stroke-width="1.4"/><path d="M8 58 C 18 46, 22 30, 30 20" stroke="#cdd39a" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="30" cy="20" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'greer', group: 'real', name: 'Century Park', meta: `Greer, South Carolina${IMAGERY ? ' · satellite imagery' : ''} · 18 holes`, holes: 18,
    blurb: 'Century Park’s course in Greer, between Greenville and Spartanburg, from OpenStreetMap: eighteen short, tight holes from 40 to 170 m through oak and pine woods.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#5b7a3c"/>${[[10, 10, 7], [28, 16, 6], [50, 8, 7], [12, 34, 6], [54, 32, 7], [22, 54, 7], [46, 54, 6]].map(([x, y, r], k) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${k % 2 ? '#2f5a2c' : '#3e6a2e'}"/>`).join('')}<path d="M14 58 C 24 40, 34 30, 44 16" stroke="#c9b28a" stroke-width="3" fill="none" stroke-dasharray="4 3"/><circle cx="44" cy="16" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'fantasy', group: 'arcade', name: 'Fantasy Fairways', meta: 'Knights, a castle keep, one dragon', holes: 9,
    blurb: 'A medieval course: dodge a giant knight on The Joust, fly the gate into a castle courtyard, cross the moat, and finish under a dragon on Dragon’s Lair.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#46603a"/><rect x="0" y="44" width="64" height="20" fill="#7da35a"/><path d="M14 46 V24 h6 v-4 h4 v4 h4 v-4 h4 v4 h4 v-4 h4 v4 h6 v22 h-12 v-10 a4 4 0 0 0 -8 0 v10 z" fill="#d8a77c"/><path d="M14 24 L17 14 L20 24 M44 24 L47 14 L50 24" fill="#5b6fd6"/><path d="M40 10 c6 -2 12 2 14 6 c-4 -1 -6 0 -8 2 c-2 -3 -4 -5 -6 -8z" fill="#2b2b33"/></svg>`,
  },
  {
    id: 'rainbow', group: 'arcade', name: 'Rainbow Runs', meta: 'A rainbow road in deep space · no guardrails', holes: 9,
    blurb: 'Nine laps of a rainbow road floating in space. Stay on the track (off it is lost in space, +1), dodge mystery boxes and asteroids, thread the rings, and jump the gap.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#0b0b26"/>${Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 41) % 64}" cy="${(i * 17) % 64}" r="${i % 3 ? 0.8 : 1.3}" fill="#fff"/>`).join('')}${['#ff4d6d', '#ff9f43', '#ffe066', '#5ee07a', '#4dabf7', '#9b6bff'].map((c, i) => `<path d="M${-4 + i * 3} 64 C 14 30, 40 50, ${52 + i * 3} 0" stroke="${c}" stroke-width="3.2" fill="none"/>`).join('')}<rect x="40" y="24" width="10" height="10" rx="2" fill="#ffb347" transform="rotate(15 45 29)"/><text x="45" y="32.5" font-size="9" font-weight="700" fill="#fff" text-anchor="middle" transform="rotate(15 45 29)">?</text></svg>`,
  },
  {
    id: 'pirate', group: 'arcade', name: 'Pirate’s Cove', meta: 'Islands, shipwrecks, a ghost ship', holes: 9,
    blurb: 'Nine holes across sandy islands: carry the cove, get round a stranded wreck and a lookout tower, time the ghost ship sailing across 7, find the island basket, and finish behind a moored galleon. Off the land is the sea: overboard, +1.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#2b7db3"/><ellipse cx="18" cy="48" rx="16" ry="11" fill="#e3cf98"/><ellipse cx="48" cy="18" rx="13" ry="9" fill="#e3cf98"/><path d="M14 50 L44 20" stroke="#83c45a" stroke-width="5" stroke-linecap="round"/><path d="M38 44 h18 l-3 5 h-12 z" fill="#5b3a26"/><path d="M47 44 V30" stroke="#3a2a1e" stroke-width="1.5"/><path d="M47 31 l8 5 l-8 4 z" fill="#f4f0e6"/><path d="M45 29 h-6 v4 h6z" fill="#1d1d1d"/><circle cx="48" cy="18" r="3.5" fill="#f2c230"/></svg>`,
  },
  {
    id: 'graveyard', group: 'arcade', name: 'Graveyard Shift', meta: 'A haunted cemetery at night', holes: 9,
    blurb: 'Through the cemetery gates at night: a pumpkin patch, round a great crypt, past a wandering ghost, through dead woods, over the bog, down Lantern Lane, between shuffling zombies, and into the vampire’s lair.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#2a2342"/><circle cx="48" cy="14" r="7" fill="#f2ecc8"/><rect x="0" y="44" width="64" height="20" fill="#1f2a22"/>${[[10, 44], [24, 46], [40, 45]].map(([x, y]) => `<path d="M${x} ${y} v-9 a4 4 0 0 1 8 0 v9 z" fill="#8a8f9a"/>`).join('')}<circle cx="54" cy="52" r="5" fill="#e8822a"/><path d="M52 51 l1.2 -1.4 l1.2 1.4 M55 51 l1.2 -1.4 l1.2 1.4" stroke="#2a1a0a" stroke-width="1"/><path d="M8 30 q4 -10 8 0 q-2 6 -4 4 q-2 2 -4 -4z" fill="#e9e6f5" opacity=".85"/></svg>`,
  },
  {
    id: 'winter', group: 'arcade', name: 'Frosty Pines', meta: 'A snowy wood, snowmen and a toy train', holes: 9,
    blurb: 'Nine holes in falling snow: down an alley of snowmen, slalom the candy canes, carry a frozen pond, time the toy train shuttling across 4, find the gap in the snow fort, dodge the reindeer, down Lamplight Lane, into a basket ringed by giant presents, and round a giant Christmas tree to finish. Through the ice: +1.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#cdd8e4"/><rect y="44" width="64" height="20" fill="#eef3f8"/>${[[14, 44, 1], [50, 46, 0.8]].map(([x, y, k]) => `<path d="M${x} ${y - 30 * k} l${10 * k} ${16 * k} h-${4 * k} l${7 * k} ${12 * k} h-${26 * k} l${7 * k} -${12 * k} h-${4 * k} z" fill="#2e6b4a"/><path d="M${x} ${y - 30 * k} l${5 * k} ${8 * k} h-${10 * k} z" fill="#fff"/>`).join('')}<circle cx="32" cy="46" r="7" fill="#fff"/><circle cx="32" cy="35" r="5" fill="#fff"/><path d="M28 31 h8 v-6 h-8z M26 31 h12" stroke="#1d1d1d" stroke-width="2" fill="#1d1d1d"/><path d="M32 36 l5 1 l-5 1z" fill="#ff8c2e"/>${[[8, 10], [22, 18], [44, 8], [56, 22], [38, 24], [12, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.3" fill="#fff"/>`).join('')}</svg>`,
  },
  {
    id: 'tutorial', group: 'training', name: 'Tutorial', meta: 'Ten steps on the range, from aiming to a made putt', holes: 10,
    blurb: 'Learn the controls on the driving range, one at a time, by doing them: aim, set the distance, throw, the wobble zone, discs, hyzer and anhyzer, forehand, tomahawks and rollers, the map, and a putt. Just you, calm air, one basket.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#2d6a3e"/><rect x="10" y="12" width="44" height="40" rx="6" fill="#16302a"/>${[0, 1, 2].map((k) => `<rect x="17" y="${20 + k * 10}" width="6" height="6" rx="1.5" fill="${k < 2 ? '#b8f25c' : 'none'}" stroke="#b8f25c" stroke-width="1.5"/><rect x="27" y="${22 + k * 10}" width="${20 - k * 4}" height="2.5" rx="1" fill="#e9f1e4" opacity=".8"/>`).join('')}</svg>`,
  },
  {
    id: 'crazy-tutorial', group: 'training', name: 'Crazy Mode Tutorial', meta: 'Drafts, then augments to try one at a time', holes: 11,
    blurb: 'Learn Crazy mode on the range: draft an augment from real cards, then try what augments do one at a time: ghost lines, Perfect Form, Phase Disc through a wall of trees, Clone Disc, Black Hole chains. Hexes, your-course augments and mulligans are explained. Just you.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#3a2a5c"/>${[['#9aa7b4', -14, 8], ['#9b6bff', 0, 4], ['#f2c230', 14, 8]].map(([c, dx, dy]) => `<rect x="${24 + Number(dx)}" y="${14 + Number(dy)}" width="16" height="24" rx="3" fill="#16302a" stroke="${c}" stroke-width="2" transform="rotate(${Number(dx) * 0.9} ${32 + Number(dx)} ${40})"/>`).join('')}<path d="M32 44 l3 6 l6 1 l-4.5 4 l1 6 l-5.5 -3 l-5.5 3 l1 -6 l-4.5 -4 l6 -1z" fill="#f2c230"/></svg>`,
  },
  {
    id: 'putting', group: 'training', name: 'Putting', meta: 'A ladder of five stations, 30 to 70 ft · alone or with friends', holes: 5,
    blurb: 'A putting ladder on the range: three putts at each of five stations, from 30 ft and 10 ft farther each time to 70 ft, worth 1 to 5 points a make. A perfect round is 45. Take turns putt by putt with friends, here or in a room.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#5f8f46"/>${[0, 1, 2, 3, 4].map((k) => `<circle cx="32" cy="${54 - k * 9}" r="${2 + k * 0.4}" fill="none" stroke="#e9f1e4" stroke-width="1.2" opacity="${0.4 + k * 0.12}"/>`).join('')}<path d="M24 12 h16 M26 12 l3 10 M32 12 v10 M38 12 l-3 10" stroke="#cfd8df" stroke-width="1.6" fill="none"/><path d="M24 22 h16 l-2 4 h-12 z" fill="#f2c230"/><circle cx="32" cy="56" r="3" fill="#ff7a45"/></svg>`,
  },
  {
    id: 'range', group: 'training', name: 'Driving Range', meta: 'Distance lines every 50 ft · your wind and weather', holes: 1,
    blurb: 'Get a feel for the discs: a long open range with a line every 50 ft and big signs every 100 ft. Set the wind and weather, place or remove baskets and trees, and see how far and how far off line each throw goes. Take turns from the tee with friends: whoever is up sets the range. Nothing scored.',
    art: `<svg viewBox="0 0 64 64"><rect width="64" height="64" fill="#6f9a4f"/><rect x="18" y="0" width="28" height="64" fill="#8cc063"/>${[12, 26, 40, 54].map((y, i) => `<rect x="${i % 2 ? 18 : 12}" y="${y}" width="${i % 2 ? 28 : 40}" height="${i % 2 ? 1.2 : 2.2}" fill="#fff"/>`).join('')}<circle cx="38" cy="20" r="3.5" fill="#f2c230"/><path d="M32 62 C 30 44, 40 34, 36 16" stroke="#ff7a45" stroke-width="2" fill="none" stroke-dasharray="3 2"/></svg>`,
  },
];

const last = load<{ course?: CourseId; holes?: string; players?: number; crazy?: boolean; bag?: boolean; teamsOn?: boolean; teamPicks?: number[]; layout?: Layout; bots?: (BotLevel | null)[]; format?: Format; teamPlay?: TeamPlay }>('untitled-disc-game:menu', {});
/** How the round is won, and how teams play. */
let format: Format = last.format ?? 'stroke';
let teamPlay: TeamPlay = last.teamPlay ?? 'best';
/** Hot seat: which rows are bots, and how good (null: a person). */
const localBots: (BotLevel | null)[] = [...(last.bots ?? [])];
/** Online (host): the bots seated after the people. */
const roomBots: BotLevel[] = [];
/** Tees and pins (real courses; the Round card's Tees and Pins rows). */
let layout: Layout = last.layout ?? { ...DEFAULT_LAYOUT };
let course: CourseId = COURSES.some((c) => c.id === last.course) ? last.course! : 'simple';
let players = Math.min(MAX_PLAYERS, Math.max(1, last.players ?? 2));
const savedNames = load<string[]>('untitled-disc-game:names', []);

// ---------- course cards ----------
function renderCourses(): void {
  $('course-cards').innerHTML = GROUPS.map((g) => `
    <div class="course-group"><span class="group-label">${g.label}</span><span class="group-sub">${g.sub}</span></div>
    ${COURSES.filter((c) => c.group === g.id).map((c) => `
    <button class="course-card ${c.id === course ? 'on' : ''}" data-id="${c.id}" title="${c.meta}">
      <span class="art">${c.art}</span>
      <span class="text"><div class="name">${c.name}</div><div class="meta">${c.meta}</div></span>
      <span class="holes">${c.id === 'range' ? '∞' : c.holes}<small>${c.id === 'range' ? 'THROWS' : c.id === 'tutorial' || c.id === 'crazy-tutorial' ? 'STEPS' : c.id === 'putting' ? 'STATIONS' : 'HOLES'}</small></span>
    </button>`).join('')}`).join('');
  $('course-cards').querySelectorAll<HTMLButtonElement>('.course-card').forEach((b) => b.addEventListener('click', () => {
    course = b.dataset.id as CourseId;
    renderCourses();
    renderHoles();
    renderTeams(room ? lobby?.seats.length ?? members.length : players);
    pushLobby();
  }));
  $('setup-hole').textContent = COURSES.find((c) => c.id === course)!.blurb;
  // The range has no holes to pick and nothing to draft or bag.
  document.querySelector<HTMLElement>('.panel-card.round')!.hidden = course === 'range' || course === 'tutorial' || course === 'crazy-tutorial' || course === 'putting';
  renderCourseInfo();
}

// ---------- course info card: name, description, par and stats for the holes being played ----------
let summary: Record<string, { pars: number[]; lengths: number[]; refs?: string[]; alt?: { shortTees: number; proTees: number; altPins: number } }> | null = null;
fetch(data('courses/summary.json')).then((r) => r.json()).then((s) => { summary = s; renderHoles(); renderLayout(); }).catch(() => { /* stats are optional */ });
/** A hole's number as the course has it (Skatås' 14b, Blue Lake's 9 after 7), by position. */
const holeName = (i: number): string => summary?.[course]?.refs?.[i] ?? String(i + 1);

function renderCourseInfo(): void {
  renderLayout();
  renderFormat();
  const c = COURSES.find((x) => x.id === course)!;
  $('ci-name').textContent = c.name;
  $('ci-meta').textContent = c.meta;
  const s = summary?.[course];
  if (!s) { $('ci-stats').innerHTML = ''; return; }
  const [first, count] = holesFromMenu();
  const idx = Array.from({ length: count }, (_, k) => first + k).filter((i) => i < s.pars.length);
  const par = idx.reduce((a, i) => a + s.pars[i], 0);
  const len = idx.reduce((a, i) => a + s.lengths[i], 0);
  const stat = (v: string, label: string, note = '') => `<div class="ci-stat"><b>${v}</b><small>${label}</small>${note ? `<em>${note}</em>` : ''}</div>`;
  const which = count === s.pars.length ? `${count} holes` : count === 1 ? `Hole ${holeName(first)}` : `Holes ${holeName(first)}–${holeName(first + count - 1)}`;
  const stats = [stat(String(par), 'Par', which), stat(fmtLen(len), count === 1 ? 'Length' : 'Total length')];
  if (count > 1) {
    const longest = idx.reduce((a, i) => (s.lengths[i] > s.lengths[a] ? i : a), idx[0]);
    stats.push(stat(fmtLen(s.lengths[longest]), 'Longest hole', `Hole ${holeName(longest)} · par ${s.pars[longest]}`));
  }
  $('ci-stats').innerHTML = stats.join('');
}
window.addEventListener('unitschange', renderCourseInfo);

// ---------- format: how the round is won ----------
/** Sides in the round as set up: teams, or players (online, the seats). */
function sidesNow(): number {
  const n = room ? lobby?.seats.length ?? members.length : players;
  const plan = room ? lobby?.teams : teamsOn ? localPlan(n) : undefined;
  return teamsOn && plan ? new Set(plan.slice(0, n)).size : n;
}
function renderFormat(): void {
  $('format-row').hidden = trainingCourse();
  $('format-seg').innerHTML = FORMATS.map(([v, name, text]) => `<button data-v="${v}" title="${text}" class="${format === v ? 'on' : ''}">${name}</button>`).join('');
  $('format-note').textContent = format === 'match' && sidesNow() !== 2 ? 'needs two sides: stroke play' : '';
  $('format-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    format = b.dataset.v as Format;
    save('untitled-disc-game:menu', { ...load('untitled-disc-game:menu', {}), format });
    renderFormat();
    pushLobby();
  }));
}

// ---------- layout: tees and pins (real courses) ----------
/** The Tees and Pins rows: real courses only; Pins only where a second basket is mapped. */
function renderLayout(): void {
  const real = COURSES.find((c) => c.id === course)?.group === 'real';
  const alt = summary?.[course]?.alt;
  const n = COURSES.find((c) => c.id === course)?.holes ?? 0;
  $('tees-row').hidden = !real;
  $('pins-row').hidden = !real || !alt?.altPins;
  $('tees-note').textContent = layout.tees === 'short' ? (alt?.shortTees ? (alt.shortTees >= n ? 'as mapped' : `${alt.shortTees} mapped, rest moved up`) : 'moved up a quarter')
    : layout.tees === 'pro' && alt?.proTees ? (alt.proTees >= n ? 'as mapped' : `${alt.proTees} of ${n} holes`) : '';
  $('pins-note').textContent = alt?.altPins && layout.pins !== 'A' && alt.altPins < n ? `${alt.altPins} of ${n} holes` : '';
  ($('tees-seg').querySelector('[data-v="pro"]') as HTMLElement).hidden = !alt?.proTees;
  for (const [seg, v] of [['tees-seg', layout.tees], ['pins-seg', layout.pins]] as const) {
    $(seg).querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  }
}
/** The layout a round on this course plays (default off the real courses, or where it changes nothing). */
function roundLayout(): Layout | undefined {
  if (COURSES.find((c) => c.id === course)?.group !== 'real') return undefined;
  const alt = summary?.[course]?.alt;
  const l: Layout = { ...layout, ...(alt?.altPins ? {} : { pins: 'A' as const }), ...(layout.tees === 'pro' && !alt?.proTees ? { tees: 'long' as const } : {}) };
  return isDefault(l) ? undefined : { ...l, ...(l.pins === 'mixed' ? { seed: l.seed ?? Math.floor(Math.random() * 1e9) } : {}) };
}
for (const seg of ['tees-seg', 'pins-seg'] as const) {
  $(seg).querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    layout = seg === 'tees-seg' ? { ...layout, tees: b.dataset.v as Layout['tees'] } : { ...layout, pins: b.dataset.v as Layout['pins'], seed: Math.floor(Math.random() * 1e9) };
    save('untitled-disc-game:menu', { ...load('untitled-disc-game:menu', {}), layout });
    renderLayout();
    pushLobby();
  }));
}

// ---------- holes ----------
/** [first, count] blocks of `size` holes covering the course (the last may be shorter). */
const holeBlocks = (n: number, size: number): [number, number][] =>
  n <= size ? [] : Array.from({ length: Math.ceil(n / size) }, (_, i): [number, number] => [i * size, Math.min(size, n - i * size)]);
function renderHoles(): void {
  const n = COURSES.find((c) => c.id === course)!.holes;
  const opts = [
    { v: `0:${n}`, label: `Full round (${n})` },
    // A front and back nine; the back gets whatever's left (Skatås' 11).
    ...(n >= 17 ? [{ v: '0:9', label: 'Front 9' }, { v: `9:${n - 9}`, label: `Back ${n - 9}` }] : []),
    // Short rounds: blocks of 3 on a 9-hole course, 6 on an 18.
    ...holeBlocks(n, n >= 17 ? 6 : 3).map(([a, k]) => ({ v: `${a}:${k}`, label: `Holes ${holeName(a)}–${holeName(a + k - 1)}` })),
    ...Array.from({ length: n }, (_, i) => ({ v: `${i}:1`, label: `Hole ${holeName(i)} only` })),
  ];
  const sel = $<HTMLSelectElement>('holes');
  const prev = sel.value || last.holes;
  sel.innerHTML = opts.map((o) => `<option value="${o.v}">${o.label}</option>`).join('');
  if (prev && opts.some((o) => o.v === prev)) sel.value = prev;
  renderCourseInfo();
}

// ---------- player colors ----------
/** Each player row's picked color (saved). Shown resolved, so two players never share one. */
const colorPicks = load<(string | null)[]>('untitled-disc-game:colors', []);
const rowColors = () => playerColors(Array.from({ length: MAX_PLAYERS }, (_, i) => colorPicks[i]));
/** Each row's disc design (src/render/discDesigns.ts); solid when unset. */
const designPicks = load<(string | null)[]>('untitled-disc-game:designs', []);
const rowDesign = (i: number) => (isDesign(designPicks[i] ?? undefined) ? designPicks[i]! : 'solid');
const colorPop = document.createElement('div');
colorPop.className = 'color-pop';
colorPop.hidden = true;
document.body.appendChild(colorPop);
/** Colors other people in the room have: their seats' (as the host's lobby gave them), else their picks. */
function roomColorsTaken(): string[] {
  const seat = (c: string) => lobby?.seats.find((q) => q.client === c)?.color;
  return members.filter((m) => m.client !== me).map((m) => seat(m.client) ?? m.color).filter((c): c is string => !!c);
}
/** The palette under row i's swatch. Colors other players have are taken (hot seat: the other rows; online: the room's). */
function openColors(i: number, anchor: HTMLElement): void {
  const cols = rowColors();
  const taken = room ? roomColorsTaken() : cols.filter((_, k) => k !== i && k < players);
  colorPop.innerHTML = COLOR_CHOICES.map((c) => `<button data-c="${c}" style="background:${c}" class="${c === cols[i] ? 'on' : ''}" ${taken.includes(c) ? 'disabled title="Taken"' : ''}></button>`).join('');
  colorPop.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    colorPicks[i] = b.dataset.c!;
    save('untitled-disc-game:colors', colorPicks);
    colorPop.hidden = true;
    sfx('select');
    renderPlayers();
    if (room && i === 0) room.recolor(rowColors()[0]);
  }));
  const r = anchor.getBoundingClientRect();
  colorPop.style.left = `${r.left}px`;
  colorPop.style.top = `${r.bottom + 6}px`;
  colorPop.hidden = false;
}
document.addEventListener('pointerdown', (e) => {
  if (!colorPop.hidden && !colorPop.contains(e.target as Node) && !(e.target as HTMLElement).classList.contains('swatch')) colorPop.hidden = true;
});

// ---------- online room state (the room itself is further down) ----------
// Declared here because the menu (players, teams) reads it from its first render.
let room: RoomClient | null = null;
let me = '';
let host = '';
let members: Member[] = [];
let lobby: Lobby | null = null;
let launched = false;

// ---------- players ----------
function renderPlayers(): void {
  $('player-seg').innerHTML = Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1)
    .map((k) => `<button data-n="${k}" class="${k === players ? 'on' : ''}" title="${k} ${k === 1 ? 'player' : 'players'}">${k === 1 ? '1 player' : k}</button>`).join('');
  $('player-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    players = parseInt(b.dataset.n!, 10);
    renderPlayers();
  }));
  const box = $('player-names');
  const current = [...box.querySelectorAll('input')].map((i) => i.value);
  box.innerHTML = '';
  const cols = rowColors();
  for (let i = 0; i < players; i++) {
    const row = document.createElement('div');
    row.className = 'pname';
    const lv = localBots[i] ?? null;
    const dname = DISC_DESIGNS.find(([v]) => v === rowDesign(i))![1];
    row.innerHTML = `<button class="swatch" style="background:${cols[i]}" title="Pick a color"></button><button class="design-btn" title="Disc design: ${dname} (click for the next)"><img alt="${dname}" src="${designCanvas(rowDesign(i), cols[i], 56).toDataURL()}"></button><input value="" maxlength="16" /><button class="bot-btn chip-btn ${lv ? 'on' : ''}" title="A person, or a computer player (Easy, Medium, Pro)">${lv ? `Bot · ${BOT_LEVELS.find(([v]) => v === lv)![1]}` : 'Person'}</button>`;
    row.querySelector('input')!.value = current[i] ?? savedNames[i] ?? `Player ${i + 1}`;
    // Person → Easy → Medium → Pro → person. A bot row gets a bot's name until it's renamed.
    row.querySelector<HTMLButtonElement>('.bot-btn')!.addEventListener('click', () => {
      const order: (BotLevel | null)[] = [null, ...BOT_LEVELS.map(([v]) => v)];
      const next = order[(order.indexOf(localBots[i] ?? null) + 1) % order.length];
      const input = row.querySelector('input')!;
      const auto = /^(Player \d+|Bot \(.*\))$/.test(input.value);
      localBots[i] = next;
      if (auto) input.value = next ? `Bot (${BOT_LEVELS.find(([v]) => v === next)![1]})` : `Player ${i + 1}`;
      save('untitled-disc-game:menu', { ...load('untitled-disc-game:menu', {}), bots: localBots });
      renderPlayers();
    });
    // The disc's design: the next one each click (online, the room hears of it).
    row.querySelector<HTMLButtonElement>('.design-btn')!.addEventListener('click', () => {
      const k = DISC_DESIGNS.findIndex(([v]) => v === rowDesign(i));
      designPicks[i] = DISC_DESIGNS[(k + 1) % DISC_DESIGNS.length][0];
      save('untitled-disc-game:designs', designPicks);
      sfx('select');
      renderPlayers();
      if (room && i === 0) room.redesign(rowDesign(0));
    });
    const sw = row.querySelector<HTMLButtonElement>('.swatch')!;
    sw.addEventListener('click', () => (colorPop.hidden ? openColors(i, sw) : (colorPop.hidden = true)));
    box.appendChild(row);
  }
  $<HTMLSelectElement>('player-count').value = String(players);
  renderTeams(players);
}

// ---------- teams: best shot ----------
// Teams on: every player has a team (src/game/teams.ts), any split: 1 v 2, 1 v 1 v 2, 2 v 3…
// Click a player's team chip to move them to the next team. Hot seat: the chips are on the rows
// above; online, on the room's member list (the host's to change). With Crazy mode too (hexes spare
// teammates). Not on the training courses.
let teamsOn = !!last.teamsOn;
/** Hot seat: each row's team (missing rows take the default split). */
const localTeams: number[] = [...(last.teamPicks ?? [])];
/** Online (host): each player's team, by client id, so they keep it as seats shift. */
const roomTeams = new Map<string, number>();
const trainingCourse = () => course === 'range' || course === 'tutorial' || course === 'crazy-tutorial' || course === 'putting';
/** Hot seat: the rows' teams, n of them. */
const localPlan = (n: number) => Array.from({ length: n }, (_, p) => localTeams[p] ?? defaultTeams(n)[p]);
/** Online (host): the seats' teams; anyone new joins the smallest team. */
function roomPlan(clients: string[]): number[] {
  const n = clients.length;
  return clients.map((c, i) => {
    let t = roomTeams.get(c);
    if (t === undefined || t >= Math.max(2, n - 1)) {
      const sizes = new Map<number, number>();
      for (const k of clients.slice(0, i)) sizes.set(roomTeams.get(k) ?? 0, (sizes.get(roomTeams.get(k) ?? 0) ?? 0) + 1);
      t = [0, 1].sort((a, b) => (sizes.get(a) ?? 0) - (sizes.get(b) ?? 0))[0];
      roomTeams.set(c, t);
    }
    return t;
  });
}
/** The teams a game would use (undefined: everyone alone, or not two teams yet). */
const teamsToPlay = (plan: number[]) => (teamsOn && !trainingCourse() && teamGroups(plan, plan.length) ? plan : undefined);
const TEAM_COLORS = ['#ffd23f', '#3fc1ff', '#ff6b9a', '#7ee081', '#b48cff'];
const teamChip = (t: number, click: boolean) => `<button class="team-chip" ${click ? '' : 'disabled'} style="--tc:${TEAM_COLORS[t % TEAM_COLORS.length]}" title="${click ? 'Click to move to the next team' : `Team ${t + 1}`}">T${t + 1}</button>`;

/** The Teams row (Solo or Teams, and the split), and hot seat's team chips. n: players. */
function renderTeams(n: number): void {
  $('teams-row').hidden = n < 2 || trainingCourse();
  // Online: the host's own plan (the room's copy comes back a moment later), else the room's.
  const plan = room ? (amHost() ? roomPlan((lobby?.seats ?? []).map((q) => q.client)) : lobby?.teams ?? []) : localPlan(n);
  const groups = teamGroups(plan, n);
  $('teams-seg').innerHTML = `<button data-v="0" class="${teamsOn ? '' : 'on'}">Solo</button><button data-v="1" class="${teamsOn && teamPlay === 'best' ? 'on' : ''}" title="Best shot: everyone throws, the team plays the best">Best shot</button><button data-v="2" class="${teamsOn && teamPlay === 'alternate' ? 'on' : ''}" title="Alternate shot: teammates take turns with one disc">Alternate</button>`;
  $('teams-note').textContent = !teamsOn ? '' : groups ? teamsLabel(groups) : 'One team: everyone plays alone';
  $('teams-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    teamsOn = b.dataset.v !== '0';
    if (teamsOn) teamPlay = b.dataset.v === '2' ? 'alternate' : 'best';
    save('untitled-disc-game:menu', { ...load('untitled-disc-game:menu', {}), teamsOn, teamPlay });
    renderFormat();
    renderPlayers();
    pushLobby();
    renderRoom();
  }));
  if (room) return;
  // Hot seat: a chip on each row.
  [...$('player-names').children].forEach((r, i) => {
    r.querySelector('.team-chip')?.remove();
    if (!teamsOn) return;
    r.insertAdjacentHTML('beforeend', teamChip(plan[i], true));
    r.querySelector<HTMLButtonElement>('.team-chip')!.addEventListener('click', () => {
      for (let k = 0; k < n; k++) localTeams[k] = plan[k];
      localTeams[i] = nextTeam(plan[i], n);
      save('untitled-disc-game:menu', { ...load('untitled-disc-game:menu', {}), teamPicks: localTeams, layout, bots: localBots, format, teamPlay });
      renderTeams(n);
    });
  });
}

// ---------- crazy mode ----------
const crazy = $<HTMLInputElement>('crazy');
crazy.checked = !!last.crazy;
const bagMode = $<HTMLInputElement>('bag-mode');
bagMode.checked = !!last.bag;
const syncCrazy = () => { $('crazy-rules').hidden = !crazy.checked; };

// ---------- Crazy mode rules ----------
let rules: CrazyRules = cleanRules(load<Partial<CrazyRules> | null>('untitled-disc-game:crazy-rules', null));
const ODDS_PRESETS: [string, CrazyRules['odds']][] = [
  ['Classic', { common: 70, epic: 25, legendary: 5 }],
  ['Spicy', { common: 40, epic: 40, legendary: 20 }],
  ['Wild', { common: 10, epic: 40, legendary: 50 }],
  ['All legendary', { common: 0, epic: 0, legendary: 1 }],
];
function setRules(r: Partial<CrazyRules>): void {
  rules = cleanRules({ ...rules, ...r, odds: { ...rules.odds, ...r.odds } });
  save('untitled-disc-game:crazy-rules', rules);
  renderRules();
}
function renderRules(): void {
  const seg = (id: string, opts: [number, string][], cur: number, set: (v: number) => void) => {
    $(id).innerHTML = opts.map(([v, label]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${label}</button>`).join('');
    $(id).querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => set(parseInt(b.dataset.v!, 10))));
  };
  const range = ([lo, hi]: readonly [number, number]) => Array.from({ length: hi - lo + 1 }, (_, i): [number, string] => [lo + i, String(lo + i)]);
  seg('rule-cards', range(RULE_LIMITS.cards), rules.cards, (v) => setRules({ cards: v }));
  seg('rule-picks', range(RULE_LIMITS.picks), rules.picks, (v) => setRules({ picks: v }));
  seg('rule-every', [[1, 'Every hole'], [2, 'Every 2nd'], [3, 'Every 3rd']], rules.every, (v) => setRules({ every: v }));
  $<HTMLInputElement>('rule-starter').checked = rules.starter;
  for (const t of ['common', 'epic', 'legendary'] as const) {
    const el = $<HTMLInputElement>(`odd-${t}`);
    if (document.activeElement !== el) el.value = String(rules.odds[t]);
  }
  const w = tierWeights(rules, false);
  $('odds-bar').innerHTML = (['common', 'epic', 'legendary'] as const).filter((t) => w[t] > 0)
    .map((t) => `<span class="${t}" style="flex:${w[t]}" title="${t}: ${Math.round(w[t] * 100)}%">${w[t] >= 0.08 ? `${Math.round(w[t] * 100)}%` : ''}</span>`).join('');
  $('odds-presets').innerHTML = ODDS_PRESETS.map(([n, o], i) => `<button data-i="${i}" class="${JSON.stringify(o) === JSON.stringify(rules.odds) ? 'on' : ''}">${n}</button>`).join('');
  $('odds-presets').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => setRules({ odds: ODDS_PRESETS[parseInt(b.dataset.i!, 10)][1] })));
}
$('rule-starter').addEventListener('change', () => setRules({ starter: $<HTMLInputElement>('rule-starter').checked, starterBoost: $<HTMLInputElement>('rule-starter').checked }));
for (const t of ['common', 'epic', 'legendary'] as const) {
  $(`odd-${t}`).addEventListener('change', () => setRules({ odds: { ...rules.odds, [t]: Math.max(0, parseFloat($<HTMLInputElement>(`odd-${t}`).value) || 0) } }));
}
$('browse-augments').addEventListener('click', () => openAugmentBrowser());
$('aug-close').addEventListener('click', closeAugmentBrowser);
$('aug-browser').addEventListener('click', (e) => { if (e.target === $('aug-browser')) closeAugmentBrowser(); });
$('open-stats').addEventListener('click', () => openStats(document.querySelector<HTMLInputElement>('#player-names input')?.value.trim()));
$('stats-close').addEventListener('click', closeStats);
$('player-stats').addEventListener('click', (e) => { if (e.target === $('player-stats')) closeStats(); });
renderRules();
crazy.addEventListener('change', () => {
  syncCrazy(); pushLobby(); renderCourseInfo();
});
$('holes').addEventListener('change', () => { pushLobby(); renderCourseInfo(); });
bagMode.addEventListener('change', () => pushLobby());

renderCourses();
renderHoles();
renderPlayers();
syncCrazy();
mountSettings($('settings-menu-form'));
mountSettings($('settings-game'));
initSound();
music('menu'); // starts on the first click or key

// ---------- in-game buttons: menu, controls list, sound ----------
function showGameButtons(): void {
  for (const id of ['settings-btn', 'fp-toggle', 'keys-btn', 'mute-btn', 'chat-btn']) $(id).hidden = false;
}
const SPEAKER = '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>';
function renderMute(): void {
  const off = prefs().muted;
  $('mute-btn').innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">${SPEAKER}${off
    ? '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    : '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'}</svg>`;
  $('mute-btn').title = off ? `Sound off: ${keyFor('mute')} turns it on` : `Sound on: ${keyFor('mute')} mutes`;
}
const toggleMute = () => setPref('muted', !prefs().muted);
renderMute();
window.addEventListener('prefschange', renderMute);
$('mute-btn').addEventListener('click', toggleMute);
/** Key labels in the keys card and tooltips, from the current bindings (Settings → Controls). */
function renderKeyLabels(): void {
  document.querySelectorAll<HTMLElement>('kbd[data-key]').forEach((k) => { k.textContent = keyFor(k.dataset.key as KeyAction); });
  $('chat-btn').title = `Quick chat (hold ${keyFor('chat')})`;
  $('keys-btn').title = `Controls (${keyFor('help')})`;
  renderMute();
}
renderKeyLabels();
window.addEventListener('prefschange', renderKeyLabels);
const applyMotion = () => document.documentElement.classList.toggle('reduce-motion', prefs().reduceMotion);
applyMotion();
window.addEventListener('prefschange', applyMotion);
const openKeys = (open: boolean) => {
  $('keys').hidden = !open;
  $('keys').querySelectorAll<HTMLElement>('.crazy-only').forEach((r) => { r.hidden = !crazy.checked; });
};
$('keys-btn').addEventListener('click', () => openKeys(true));
$('keys-close').addEventListener('click', () => openKeys(false));
$('keys').addEventListener('click', (e) => { if (e.target === $('keys')) openKeys(false); });

// ---------- pause menu (Esc / ⏸) ----------
const openPause = (open: boolean) => { $('settings').hidden = !open; };
$('settings-btn').addEventListener('click', () => openPause(true));
$('settings-close').addEventListener('click', () => openPause(false));
$('settings-menu').addEventListener('click', () => { leaveRoomLink(); reloadPage(); });
$('pause-card').addEventListener('click', () => { openPause(false); window.dispatchEvent(new Event('show-scorecard')); });
window.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).tagName === 'INPUT';
  if (!typing && isKey(e, 'mute') && $('setup').hidden) { toggleMute(); return; }
  if (!typing && isKey(e, 'help') && $('setup').hidden) { openKeys($('keys').hidden === true); return; }
  if (e.key === 'Escape' && $('keys').hidden === false) { openKeys(false); return; }
  if (e.key === 'Escape' && $('aug-browser').hidden === false) { closeAugmentBrowser(); return; }
  if (e.key === 'Escape' && $('player-stats').hidden === false) { closeStats(); return; }
  if (e.key === 'Escape' && $('name-ask').hidden === false) { $('name-cancel').click(); return; }
  if (e.key === 'Escape' && $('setup').hidden === true) openPause($('settings').hidden === true);
});

// ---------- online rooms ----------
// Host a room or join one by code (or link, #room=CODE). The host's course, holes and Crazy mode
// setting are the room's; everyone connected gets a player (up to MAX_PLAYERS; more can watch).
// Hosting or joining asks for your name first; it can be changed in the lobby until the start.
/** The room's events so far. Handed to the game, which keeps appending until it takes over. */
const roomLog: { seq: number; from: string; e: RoundEvent }[] = [];
const amHost = () => !!room && me === host;
const myName = () => $('player-names').querySelector('input')?.value.trim() || savedNames[0] || 'Player';
const roomLink = (code: string) => `${location.origin}${location.pathname}#room=${code}`;
function leaveRoomLink(): void {
  if (location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname + location.search);
}

function holesFromMenu(): [number, number] {
  const n = COURSES.find((c) => c.id === course)!.holes;
  const [first, count] = $<HTMLSelectElement>('holes').value.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(first) || !Number.isFinite(count)) return [0, n]; // holes list not filled yet
  return [first, Math.min(count, n - first)];
}

/** Host: the menu's setup and everyone connected (host first) become the room's lobby. */
function pushLobby(): void {
  if (!room || !amHost() || launched) return;
  const [first, count] = holesFromMenu();
  // Host first, then whoever already had a seat (in seat order), then newcomers: someone joining
  // later never bumps an earlier player to watching.
  const seatOf = (m: Member) => {
    if (m.client === host) return -1;
    const k = lobby?.seats.findIndex((q) => q.client === m.client) ?? -1;
    return k >= 0 ? k : MAX_PLAYERS;
  };
  // A seat whose player dropped is kept for SEAT_GRACE_MS, so a refresh or a wobbly connection
  // doesn't lose it.
  const kept = (lobby?.seats ?? []).filter((q) => !botOfClient(q.client) && !members.some((m) => m.client === q.client) && Date.now() - (awaySince.get(q.client) ?? 0) < SEAT_GRACE_MS);
  const order = [...members, ...kept].sort((a, b) => seatOf(a) - seatOf(b)); // stable: newcomers keep arrival order
  // Bots sit after the people (as many as there's room for).
  const bots = roomBots.map((lv, i) => ({ client: botClient(lv, i), name: `Bot ${i + 1} (${BOT_LEVELS.find(([v]) => v === lv)![1]})`, color: undefined as string | undefined, design: DISC_DESIGNS[(i + 1) % DISC_DESIGNS.length][0] }));
  const seated = [...order, ...bots].slice(0, MAX_PLAYERS);
  const names = uniqueNames(seated.map((m) => m.name), seated.map((m) => m.client));
  const colors = playerColors(seated.map((m) => m.color));
  const training = trainingCourse();
  // The tutorials are played alone: the room sees the driving range.
  const teams = teamsToPlay(roomPlan(seated.map((m) => m.client)));
  room.setLobby({ course: course === 'tutorial' || course === 'crazy-tutorial' ? 'range' : course, first, count, crazy: crazy.checked && !training, bag: bagMode.checked && !training, ...(teams ? { teams } : {}), ...(roundLayout() ? { layout: roundLayout() } : {}), ...(format !== 'stroke' && !training ? { format } : {}), ...(teams && teamPlay === 'alternate' ? { teamPlay } : {}), seats: seated.map((m, i) => ({ name: names[i], client: m.client, color: colors[i], ...(isDesign(m.design) ? { design: m.design } : {}) })) });
}

/** How long a lobby seat waits for a player who dropped. */
const SEAT_GRACE_MS = 60_000;
/** Seated players who dropped out of the lobby, and since when. */
const awaySince = new Map<string, number>();
let graceTimer = 0;
/** Members changed: note who dropped from a seat (and drop their seat once the grace runs out). */
function trackAway(): void {
  const now = Date.now();
  for (const q of lobby?.seats ?? []) {
    if (members.some((m) => m.client === q.client)) awaySince.delete(q.client);
    else if (!awaySince.has(q.client)) awaySince.set(q.client, now);
  }
  clearTimeout(graceTimer);
  if (awaySince.size && amHost()) graceTimer = window.setTimeout(() => { pushLobby(); renderRoom(); }, SEAT_GRACE_MS + 500);
}

/** Guests: show the host's setup. */
function showLobby(l: Lobby): void {
  if (COURSES.some((c) => c.id === l.course)) course = l.course as CourseId;
  crazy.checked = l.crazy;
  bagMode.checked = !!l.bag;
  layout = l.layout ?? { ...DEFAULT_LAYOUT };
  format = l.format ?? 'stroke';
  teamPlay = l.teamPlay ?? 'best';
  teamsOn = !!l.teams;
  renderTeams(l.seats.length);
  renderCourses();
  renderHoles();
  const sel = $<HTMLSelectElement>('holes');
  if ([...sel.options].some((o) => o.value === `${l.first}:${l.count}`)) sel.value = `${l.first}:${l.count}`;
  syncCrazy();
}

function renderRoom(): void {
  const inRoom = !!room;
  $('online-start').hidden = inRoom;
  $('online-room').hidden = !inRoom;
  $('player-seg').hidden = inRoom;
  $('setup').classList.toggle('online-guest', inRoom && !amHost());
  const rows = [...$('player-names').children] as HTMLElement[];
  rows.forEach((r, i) => { r.hidden = inRoom && i > 0; });
  const nameInput = $('player-names').querySelector('input');
  if (nameInput) nameInput.title = inRoom ? 'Your name in the room (Enter to change it)' : '';
  const start = $<HTMLButtonElement>('start');
  if (!room) { start.disabled = false; start.innerHTML = 'Tee off <span class="arrow">→</span>'; $('ready-btn').hidden = true; $('room-ping').hidden = true; return; }
  $('room-code').textContent = room.code;
  const seats = lobby?.seats ?? members.map((m) => ({ name: m.name, client: m.client }));
  const watching = members.filter((m) => !seats.some((q) => q.client === m.client));
  const ready = (c: string) => !!members.find((m) => m.client === c)?.ready;
  // Teams: the host's own plan (clickable chips), or the room's for everyone else.
  const plan = amHost() ? roomPlan(seats.map((q) => q.client)) : lobby?.teams ?? [];
  const teamCell = (c: string, i: number) => (teamsOn && plan[i] !== undefined ? teamChip(plan[i], amHost()).replace('class="team-chip"', `class="team-chip" data-client="${c}"`) : '');
  $('room-members').innerHTML = [
    ...seats.map((q, i) => `<div class="m"><i style="background:${('color' in q && q.color) || PLAYER_COLORS[i]}"></i><span>${escapeHtml(q.name)}</span><small>${[
      q.client === me ? 'you' : '', q.client === host ? 'host' : '',
      botOfClient(q.client) ? `bot · ${BOT_LEVELS.find(([v]) => v === botOfClient(q.client))![1]}` : members.some((m) => m.client === q.client) ? '' : 'away, seat kept 1 min',
    ].filter(Boolean).join(' · ')}</small>${botOfClient(q.client) && amHost() ? `<button class="chip-btn bot-x" data-client="${q.client}" title="Take the bot's seat away">✕</button>` : ''}${q.client !== host && ready(q.client) ? '<b class="ready">✓ Ready</b>' : ''}${teamCell(q.client, i)}</div>`),
    ...watching.map((m) => `<div class="m"><i style="background:#555"></i><span>${escapeHtml(m.name)}</span><small>watching</small></div>`),
  ].join('');
  // Ready (rooms from protocol 2): everyone but the host says when they're set; the host sees how
  // many are, and can start any time.
  const canReady = room.protocol >= 2;
  $('ready-btn').hidden = !canReady || amHost();
  $('ready-btn').classList.toggle('on', ready(me));
  $('ready-btn').textContent = ready(me) ? '✓ Ready' : 'Ready?';
  const others = seats.filter((q) => q.client !== host && members.some((m) => m.client === q.client));
  const count = canReady && others.length ? ` (${others.filter((q) => ready(q.client)).length}/${others.length} ready)` : '';
  // Our swatch shows the color the room gave us (a clash goes to whoever was seated first).
  const myColor = lobby?.seats.find((q) => q.client === me)?.color;
  const sw = $('player-names').querySelector<HTMLElement>('.swatch');
  if (sw && myColor) sw.style.background = myColor;
  $('add-bot-box').hidden = !amHost() || seats.length >= MAX_PLAYERS;
  if (amHost()) $('room-members').querySelectorAll<HTMLButtonElement>('.bot-x').forEach((b) => b.addEventListener('click', () => {
    const k = parseInt(b.dataset.client!.split('-')[2], 10) - 1;
    roomBots.splice(k, 1);
    pushLobby();
    renderRoom();
  }));
  if (amHost()) $('room-members').querySelectorAll<HTMLButtonElement>('.team-chip[data-client]').forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.client!;
    roomTeams.set(c, nextTeam(roomTeams.get(c) ?? 0, seats.length));
    pushLobby();
    renderRoom();
  }));
  renderTeams(seats.length);
  $('room-note').textContent = amHost()
    ? 'Send friends the link (or the code). Pick the course and round here; everyone in the room plays.'
    : 'The host picks the course and starts the game.';
  start.disabled = !amHost();
  start.innerHTML = amHost() ? `Start online game${count} <span class="arrow">→</span>` : 'Waiting for the host…';
}
const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Ask for a name (prefilled with the last one). Null: cancelled. */
function askName(title: string, ok: string): Promise<string | null> {
  const modal = $('name-ask'), input = $<HTMLInputElement>('name-input');
  $('name-title').textContent = title;
  $('name-ok').textContent = ok;
  input.value = myName();
  modal.hidden = false;
  input.focus();
  input.select();
  return new Promise((done) => {
    const finish = (v: string | null) => {
      modal.hidden = true;
      $('name-form').removeEventListener('submit', submit);
      $('name-cancel').removeEventListener('click', cancel);
      done(v);
    };
    const submit = (e: Event) => { e.preventDefault(); const v = input.value.trim(); if (v) finish(v.slice(0, 16)); else input.focus(); };
    const cancel = () => finish(null);
    $('name-form').addEventListener('submit', submit);
    $('name-cancel').addEventListener('click', cancel);
  });
}

/** Our name, from the name prompt or the lobby: shown in the first player row and remembered. */
function setMyName(name: string): void {
  const input = $('player-names').querySelector('input');
  if (input) input.value = name;
  savedNames[0] = name;
  save('untitled-disc-game:names', savedNames);
}

/** Ask for a name, then join (or host: a new code). Cancelling joins nothing. */
async function enterRoom(code: string, hosting: boolean): Promise<void> {
  const name = await askName(hosting ? 'Host a room' : `Join room ${code}`, hosting ? 'Host' : 'Join');
  if (!name) { if (!room) leaveRoomLink(); return; }
  setMyName(name);
  joinRoom(code);
}

/** The room this browser last joined: opening its link again rejoins without asking a name. */
const LAST_ROOM = 'untitled-disc-game:room';

function joinRoom(code: string): void {
  room?.close();
  save(LAST_ROOM, code);
  const r = new RoomClient(code, myName(), rowColors()[0], undefined, rowDesign(0));
  room = r;
  history.replaceState(null, '', `#room=${code}`);
  r.on({
    welcome: (w) => {
      if (launched) return;
      me = w.you; host = w.host; members = w.members; lobby = w.lobby;
      // A reconnect to the same game gets only the events after `since`.
      if (!w.since) roomLog.length = 0;
      for (const x of w.log) if (x.seq === roomLog.length) roomLog.push(x);
      if (lobby && !amHost()) showLobby(lobby);
      renderRoom();
      if ((w.protocol ?? 1) < PROTOCOL) $('room-note').textContent = 'This room server is out of date: reconnecting, ready and host hand-over are off.';
      if (w.started && w.lobby) launch(w.lobby);
      else pushLobby();
    },
    members: (m) => { members = m; if (!launched) { trackAway(); pushLobby(); renderRoom(); } },
    lobby: (l) => { lobby = l; if (!launched) { if (!amHost()) showLobby(l); renderRoom(); } },
    started: (l) => { lobby = l; launch(l); },
    // The host left: someone else (maybe us) runs the lobby now.
    host: (h) => { host = h; if (!launched) { pushLobby(); renderRoom(); } },
    // Until the game takes over (it replaces this handler), keep the room's events for it.
    event: (seq, from, e) => { if (seq === roomLog.length) roomLog.push({ seq, from, e }); },
    status: (s) => {
      if (launched) return;
      roomNet.status(s);
      $('room-note').textContent = s === 'open' ? $('room-note').textContent : s === 'connecting' ? 'Connecting…' : 'Connection lost: reconnecting…';
    },
    ping: (ms) => { if (!launched) roomNet.ping(ms); },
    error: (reason) => { if (!launched) $('room-note').textContent = reason; },
  });
  r.connect();
  renderRoom();
}

$('online').hidden = !ROOMS_URL;
$('host-room').addEventListener('click', () => void enterRoom(newRoomCode(), true));
$('join-room').addEventListener('click', () => {
  const code = $<HTMLInputElement>('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length >= 4) void enterRoom(code, false);
});
// In the lobby, the first player row is our name: changing it renames us in the room.
$('player-names').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (!room || launched || input !== $('player-names').querySelector('input')) return;
  const name = input.value.trim().slice(0, 16);
  if (!name) { input.value = members.find((m) => m.client === me)?.name ?? myName(); return; }
  setMyName(name);
  room.rename(name);
});
$('player-names').addEventListener('keydown', (e) => { if (e.key === 'Enter' && room) (e.target as HTMLInputElement).blur(); });
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-room').click(); });
$('add-bot').addEventListener('click', () => {
  if (!room || !amHost()) return;
  roomBots.push($<HTMLSelectElement>('add-bot-level').value as BotLevel);
  pushLobby();
  renderRoom();
});
$('copy-link').addEventListener('click', async () => {
  if (!room) return;
  try { await navigator.clipboard.writeText(roomLink(room.code)); $('copy-link').textContent = 'Copied!'; } catch { $('copy-link').textContent = room.code; }
  setTimeout(() => { $('copy-link').textContent = 'Copy link'; }, 1500);
});
$('ready-btn').addEventListener('click', () => {
  if (!room || launched) return;
  room.setReady(!members.find((m) => m.client === me)?.ready);
});
/** The lobby's connection dot and round trip, by the room code. */
const roomNet = mountNetStatus($('room-ping'));
$('leave-room').addEventListener('click', () => {
  save(LAST_ROOM, null);
  room?.close();
  room = null; lobby = null; members = [];
  leaveRoomLink();
  $('setup').classList.remove('online-guest');
  renderPlayers();
  renderRoom();
});
// A room link: join straight away (a started game resumes where it is). Also when a link is
// pasted into a tab that's already open (only the #hash changes, so the page doesn't reload).
const roomInHash = () => location.hash.match(/^#room=([A-Za-z0-9]{4,8})$/)?.[1].toUpperCase() ?? null;
const linked = roomInHash();
/**
 * A room we've been in (a refresh, the same link in a new tab, back from a finished game): straight
 * back in with our name. Any other room asks for a name first.
 */
const rejoining = (code: string) => code === load<string | null>(LAST_ROOM, null);
if (ROOMS_URL && linked) {
  if (rejoining(linked)) joinRoom(linked);
  else void enterRoom(linked, false);
}
window.addEventListener('hashchange', () => {
  const code = roomInHash();
  if (!ROOMS_URL || !code || launched || room?.code === code || !$('name-ask').hidden) return;
  if (rejoining(code)) joinRoom(code);
  else void enterRoom(code, false);
});

/** Start (or rejoin) the room's game. */
async function launch(l: Lobby): Promise<void> {
  if (launched || !room) return;
  launched = true;
  // The tutorials are never a room's course (its lobby shows the range), but don't trust the wire.
  const id = (COURSES.some((c) => c.id === l.course) && l.course !== 'tutorial' && l.course !== 'crazy-tutorial' ? l.course : 'simple') as Exclude<CourseId, 'tutorial' | 'crazy-tutorial'>;
  $('setup').hidden = true;
  showGameButtons();
  $('pause-sub').textContent = `${COURSES.find((c) => c.id === id)!.name}${l.crazy ? ' · Crazy mode' : ''} · Room ${room.code}`;
  const r = room;
  const { startDisc } = await import('./modes/disc');
  await startDisc({
    names: l.seats.map((q) => q.name), colors: l.seats.map((q) => q.color ?? ''), course: id === 'putting' ? 'range' : id, putting: id === 'putting', first: l.first, count: l.count, rogue: l.crazy, bag: !!l.bag, teams: l.teams, layout: l.layout, format: l.format, teamPlay: l.teamPlay, designs: l.seats.map((q) => q.design),
    net: { room: r, isHost: me === host, mine: (p) => l.seats[p]?.client === me, log: roomLog, seats: l.seats.map((q) => q.client), present: members.map((m) => m.client) },
    rules, // only the host's are used: they send them as the round's first event
  });
}

// ---------- start ----------
$('start').addEventListener('click', async () => {
  sfx('confirm');
  if (course === 'tutorial' || course === 'crazy-tutorial') {
    // Alone, on this browser (in a room too): the first player's name.
    const name = [...$('player-names').querySelectorAll('input')][0]?.value.trim() || 'Player 1';
    save('untitled-disc-game:menu', { course, holes: $<HTMLSelectElement>('holes').value, players, crazy: crazy.checked, bag: bagMode.checked, teamsOn, teamPicks: localTeams, layout, bots: localBots, format, teamPlay });
    $('setup').hidden = true;
    showGameButtons();
    $('pause-sub').textContent = course === 'tutorial' ? 'Tutorial' : 'Crazy Mode Tutorial';
    const { startDisc } = await import('./modes/disc');
    await startDisc({ names: [name], colors: rowColors().slice(0, 1), course: 'range', first: 0, count: 1, tutorial: true, crazyTutorial: course === 'crazy-tutorial' });
    return;
  }
  if (room) {
    if (!amHost()) return;
    save('untitled-disc-game:menu', { course, holes: $<HTMLSelectElement>('holes').value, players, crazy: crazy.checked, bag: bagMode.checked, teamsOn, teamPicks: localTeams, layout, bots: localBots, format, teamPlay });
    pushLobby();
    room.start();
    return;
  }
  const typed = [...$('player-names').querySelectorAll('input')].map((i, k) => i.value.trim() || `Player ${k + 1}`);
  const names = uniqueNames(typed);
  const holesV = $<HTMLSelectElement>('holes').value;
  save('untitled-disc-game:names', typed);
  save('untitled-disc-game:menu', { course, holes: holesV, players, crazy: crazy.checked, bag: bagMode.checked, teamsOn, teamPicks: localTeams, layout, bots: localBots, format, teamPlay });
  $('setup').hidden = true;
  showGameButtons();
  const n = COURSES.find((c) => c.id === course)!.holes;
  const [first, count] = holesV.split(':').map((x) => parseInt(x, 10));
  $('pause-sub').textContent = `${COURSES.find((c) => c.id === course)!.name}${crazy.checked && course !== 'range' && course !== 'putting' ? ' · Crazy mode' : ''}`;
  const { startDisc } = await import('./modes/disc');
  if (course === 'putting') {
    await startDisc({ names, colors: rowColors().slice(0, names.length), course: 'range', putting: true, first: 0, count: 1 });
    return;
  }
  const training = course === 'range'; // no Crazy mode or bags on the range
  const teams = teamsToPlay(localPlan(names.length));
  await startDisc({ names, colors: rowColors().slice(0, names.length), course, first, count: Math.min(count, n - first), rogue: crazy.checked && !training, rules, bag: bagMode.checked && !training, teams, layout: roundLayout(), bots: localBots.slice(0, names.length).map((b) => b ?? null), designs: names.map((_, i) => rowDesign(i)), ...(training ? {} : { format }), ...(teams ? { teamPlay } : {}) });
});
