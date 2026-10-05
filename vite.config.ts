// Vite builds the React UI from src/ui into dist/ui, which the Express app serves.
// Development: npm start (API on 3200) and npm run dev:ui (UI on 5273, /api proxied).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  build: { outDir: '../../dist/ui', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5273, proxy: { '/api': 'http://127.0.0.1:3200' } },
});
