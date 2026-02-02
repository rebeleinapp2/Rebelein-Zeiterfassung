import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Rebelein Zeiterfassung',
        short_name: 'Zeiterfassung',
        description: 'Zeiterfassung und Office Management',
        theme_color: '#0f172a',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5000000
      }
    })
  ],
  build: {
    outDir: 'dist',
  },
  define: {
    'process.env.APP_VERSION': JSON.stringify("1.1.19"),
  },
  server: {
    port: 3000,
    host: true
  }
});