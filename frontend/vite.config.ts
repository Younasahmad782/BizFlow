import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      // Socket.IO real-time notifications
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
})
