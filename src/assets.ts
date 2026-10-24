// Asset URLs and deploy switches. Built with a relative base, so the game runs from any folder
// (a GitHub Pages project page, a Netlify site root, file servers).

/** URL of a file in public/, e.g. asset('courses/tali.json'). */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/**
 * URL of course data (courses/*.json), tagged with the build: the code reads it by position (hole
 * numbers, counts), so it must come from the same deploy. Hosts cache by URL (GitHub Pages: 10
 * minutes), and a cached old copy with new code showed Blue Lake's old 17 holes in an 18-hole menu.
 */
export const data = (path: string) => (import.meta.env.DEV ? asset(path) : `${asset(path)}?v=${import.meta.env.VITE_BUILD_ID}`);

/**
 * Esri World Imagery is used under Esri's Master License Agreement, which generally needs an ArcGIS
 * account for public apps. Dev builds use it; public builds only with VITE_ESRI_IMAGERY=on (set it
 * once the terms are sorted). Without it, Tali Forest shows its drawn surface classes.
 */
export const IMAGERY = import.meta.env.DEV || import.meta.env.VITE_ESRI_IMAGERY === 'on';
