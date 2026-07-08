import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config for the Siddran desktop build. Tauri drives `vite` as its dev
// server and consumes `dist/` for packaged builds, so we pin the port and stop
// Vite from clearing Tauri's console output.
// https://vite.dev/config/  |  https://tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
})
