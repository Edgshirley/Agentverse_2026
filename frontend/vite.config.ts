import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const env = (globalThis as any).process?.env ?? {};
const backendTarget = env.BACKEND_URL || 'http://localhost:4000';
// Public hostnames the prod preview server answers to behind the reverse
// proxy (comma-separated), e.g. FRONTEND_ALLOWED_HOSTS=spread.example.com
const allowedHosts: string[] | undefined = env.FRONTEND_ALLOWED_HOSTS
  ? String(env.FRONTEND_ALLOWED_HOSTS).split(',').map((h: string) => h.trim()).filter(Boolean)
  : undefined;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
