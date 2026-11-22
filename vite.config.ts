import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Quelle der Seite liegt in app/ (die Startseite im Hauptordner leitet auf GitHub Pages nach docs/ weiter).
// "artifact"-Modus: alles in eine HTML-Datei (für die Handy-Vorschau als claude.ai-Artefakt)
export default defineConfig(({ mode }) => ({
  root: resolve(__dirname, 'app'),
  publicDir: resolve(__dirname, 'public'),
  base: './',
  plugins: mode === 'artifact' ? [viteSingleFile()] : [],
  build: { outDir: resolve(__dirname, mode === 'artifact' ? 'artifact' : 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 },
}));
