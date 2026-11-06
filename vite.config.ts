import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// package.json is the single source of the app version (SiteFooter reads
// __GATEAI_VERSION__); do not duplicate the version string elsewhere.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version || '1.0.0';

export default defineConfig(() => {
  return {
    define: {
      __GATEAI_VERSION__: JSON.stringify(pkgVersion),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          id: '/',
          name: 'GateAI',
          short_name: 'GateAI',
          description: 'GateAI 管理控制台',
          lang: 'zh-CN',
          theme_color: '#09090b',
          background_color: '#09090b',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Disable the plugin default navigateFallback (index.html):
          // without this, workbox still precaches/binds index.html even
          // though it is removed from globPatterns below.
          navigateFallback: undefined,
          globPatterns: ['**/*.{js,css,ico,png,svg,woff,woff2}'],
          // index.html is NOT precached: navigation uses NetworkFirst so a
          // new deploy cannot leave an old tab pointing at deleted chunks;
          // offline navigation falls back to the runtime-cached page.
          runtimeCaching: [
            {
              urlPattern: ({ request }: any) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'gateai-navigation',
                networkTimeoutSeconds: 3,
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 1, maxAgeSeconds: 86400 },
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
