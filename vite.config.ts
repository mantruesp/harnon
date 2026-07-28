import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev`, calls to /api/* are proxied to the Firebase hosting
// emulator (which applies the rewrite to the `claude` function). Start the
// emulator with `firebase emulators:start` so /api/claude resolves.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:5000", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
