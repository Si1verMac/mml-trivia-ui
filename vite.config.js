import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173, // Frontend dev server port
    hmr: {
      port: 5174, // Separate HMR WebSocket port
      clientPort: 5174, // Ensure client connects to this port for HMR
    },
    proxy: {
      // Proxy SignalR hub requests to the backend
      '/triviaHub': {
        target: 'http://localhost:5000', // Replace with your backend port
        ws: true, // Enable WebSocket proxying
        changeOrigin: true,
      },
    },
  },
})
