import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React dev server proxies /api to the Express backend, so the browser
// only ever talks to one origin and there are no CORS surprises.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
