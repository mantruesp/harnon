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
      // Search/verify calls use web_search with multiple tool iterations and
      // can legitimately take well over a minute. Vite's dev proxy (http-proxy
      // under the hood) has a default timeout well short of that, and returns
      // a 504 to the browser once it gives up — before the real response ever
      // arrives. Match this to the Cloud Function's own timeoutSeconds (300).
      "/api": { target: "http://127.0.0.1:5050", changeOrigin: true, timeout: 300_000, proxyTimeout: 300_000 },
    },
  },
  build: { outDir: "dist" },
});
