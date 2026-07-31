import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev`, calls to /api/* are proxied to the Firebase hosting
// emulator (which applies the rewrite to the `claude` function). Start the
// emulator with `firebase emulators:start` so /api/claude resolves.
// Hosting emulator runs on :5050, not Firebase's default :5000 — port 5000
// is squatted by macOS's AirPlay Receiver (AirTunes) on most Macs, which
// silently swallows every request with a blank 403 instead of a helpful
// "port in use" error.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:5050", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
