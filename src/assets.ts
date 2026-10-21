// Asset URLs and deploy switches. Built with a relative base, so the game runs from any folder
// (a GitHub Pages project page, a Netlify site root, file servers).

/** URL of a file in public/, e.g. asset('courses/tali.json'). */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/**
 * Esri World Imagery is used under Esri's Master License Agreement, which generally needs an ArcGIS
 * account for public apps. Dev builds use it; public builds only with VITE_ESRI_IMAGERY=on (set it
 * once the terms are sorted). Without it, Tali Forest shows its drawn surface classes.
 */
export const IMAGERY = import.meta.env.DEV || import.meta.env.VITE_ESRI_IMAGERY === 'on';
