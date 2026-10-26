import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/assets': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/ft_images': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/news_images': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/images': { target: 'http://127.0.0.1:5000', changeOrigin: true },
      '/downloaded_images': { target: 'http://127.0.0.1:5000', changeOrigin: true },
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
});
