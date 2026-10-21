/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function version() {
  let sha = process.env.GITHUB_SHA?.slice(0, 7)
  if (!sha) { try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { sha = 'local' } }
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version()) },
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: { skipWaiting: true, clientsClaim: true },
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Torque — Gestión de taller mecánico',
        short_name: 'Torque',
        description: 'Órdenes, inventario, costos y rentabilidad real de tu taller mecánico.',
        lang: 'es-MX',
        theme_color: '#14202b',
        background_color: '#eef1f4',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  test: { environment: 'node', setupFiles: ['src/tests/setup.ts'], include: ['src/tests/**/*.test.ts'], env: { TZ: 'America/Mexico_City' } },
})
