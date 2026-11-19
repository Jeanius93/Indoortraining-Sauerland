import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// "artifact"-Modus: alles in eine HTML-Datei (für die Handy-Vorschau als claude.ai-Artefakt)
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'artifact' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'artifact' ? 'artifact' : 'dist', chunkSizeWarningLimit: 2000 },
}));
