// Weather and time of day for a round: the light, sky and fog, and whether it rains. Cosmetic
// only (the flight model has its own wind). Picked from a seed every player shares, so an online
// room sees the same sky.
export type WeatherId = 'clear' | 'golden' | 'overcast' | 'rain';

export interface Weather {
  id: WeatherId;
  label: string;
  /** Sky (background and fog) color. */
  sky: string;
  fog: [number, number];
  /** Hemisphere light: sky color, ground color, intensity. */
  hemi: [string, string, number];
  /** Sun color, intensity, and its height above the horizon (rad). */
  sun: [string, number, number];
  /** Multiplies the flat-shaded ground (photo, class and drawn ground), which ignores lights. */
  ground: string;
  rain: boolean;
  /** Cloud shadows drifting over the course (a sunny sky). */
  clouds: boolean;
  birds: boolean;
}

export const WEATHER: Record<WeatherId, Weather> = {
  clear: {
    id: 'clear', label: 'Sunny', sky: '#a9c8e8', fog: [80, 520], hemi: ['#dfeaff', '#4a5a3a', 1.6], sun: ['#fff6e0', 1.6, 1.0],
    ground: '#ffffff', rain: false, clouds: true, birds: true,
  },
  golden: {
    id: 'golden', label: 'Golden hour', sky: '#f3c08e', fog: [70, 480], hemi: ['#ffe2c2', '#5a4a34', 1.25], sun: ['#ffbe73', 2.1, 0.22],
    ground: '#ffe0bf', rain: false, clouds: true, birds: true,
  },
  overcast: {
    id: 'overcast', label: 'Overcast', sky: '#b4bcc5', fog: [55, 380], hemi: ['#e4e8ec', '#4c5248', 1.75], sun: ['#ffffff', 0.45, 1.1],
    ground: '#d2d6d8', rain: false, clouds: false, birds: true,
  },
  rain: {
    id: 'rain', label: 'Rain', sky: '#8e98a3', fog: [35, 280], hemi: ['#cdd4db', '#3f463e', 1.55], sun: ['#ffffff', 0.25, 1.1],
    ground: '#adb5ba', rain: true, clouds: false, birds: false,
  },
};

/** How often each comes up. */
const ODDS: [WeatherId, number][] = [['clear', 0.45], ['golden', 0.25], ['overcast', 0.18], ['rain', 0.12]];

/** The round's weather from a shared seed (any number). */
export function pickWeather(seed: number): Weather {
  // Hash the seed to [0, 1) so nearby seeds don't give the same weather.
  let h = Math.floor(Math.abs(seed) * 1e6) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  const r = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  let acc = 0;
  for (const [id, p] of ODDS) { acc += p; if (r < acc) return WEATHER[id]; }
  return WEATHER.clear;
}
