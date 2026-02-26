import { defineConfig } from 'vite';

export default defineConfig({
  root: 'dist',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../dist-build',
  },
});
