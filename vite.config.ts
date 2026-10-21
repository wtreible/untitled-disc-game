import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs: the build runs from any folder (GitHub Pages project page, Netlify, …).
  base: './',
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
