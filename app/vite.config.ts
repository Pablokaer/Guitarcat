import { alphaTab } from "@coderline/alphatab-vite";
import { defineConfig } from "vite";

// Set by `tauri android dev` so the phone can reach the dev server over the LAN.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [alphaTab()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/plugins/**"] },
  },
  build: {
    target: "es2022",
  },
});
