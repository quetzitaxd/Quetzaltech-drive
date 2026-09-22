import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ envDir: fileURLToPath(new URL('../', import.meta.url)), plugins: [react(), tailwind()], server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3000' } } });
