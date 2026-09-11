import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5184,
    // vite 単体で UI を開発するときは Pages Functions（wrangler pages dev）へ /api をプロキシ
    proxy: { '/api': 'http://127.0.0.1:5174' },
  },
  build: { sourcemap: false },
});
