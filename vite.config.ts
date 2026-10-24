import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: the build runs from any folder (GitHub Pages project page, Netlify, …).
  base: './',
  // This build's id (the commit in CI, else the time): course data is fetched with it, so a new
  // deploy never pairs new code with a browser's cached copy of the old courses (src/assets.ts).
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.GITHUB_SHA?.slice(0, 8) ?? Date.now().toString(36)) },
  server: { port: 5173 },
  build: {
    // The three chunk is ~710 kB (183 kB gzipped): expected for a WebGL game.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      // three.js in its own chunk: it's most of the code and rarely changes, so it stays cached.
      output: { advancedChunks: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] } },
    },
  },
});
