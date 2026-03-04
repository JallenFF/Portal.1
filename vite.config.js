import { defineConfig } from 'vite';
import * as path from 'path';

export default defineConfig({
  root: '.',
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3141',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'packages/core/src'),
      '@layouts': path.resolve(__dirname, 'packages/layouts/src'),
      '@physics': path.resolve(__dirname, 'packages/physics/src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,   // don't nuke index.html
    rollupOptions: {
      input: 'index.html',
    },
  },
});
