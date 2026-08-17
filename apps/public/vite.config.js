import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: Object.fromEntries([
      '/api',
      '/assets',
      '/ft_images',
      '/news_images',
      '/images',
      '/downloaded_images'
    ].map(route => [route, 'http://localhost:5000']))
  }
});
