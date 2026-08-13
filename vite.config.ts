import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
   plugins: [react(), tailwindcss()],

   resolve: {
      alias: {
         "@": path.resolve(__dirname, "./src"),
      },
   },
   // Vite options tailored for Tauri development.
   // 1. prevent Vite from obscuring rust errors
   clearScreen: false,
   // 2. tauri expects a fixed port, fail if that port is not available
   server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
         ? {
              protocol: "ws",
              host,
              port: 1421,
           }
         : undefined,
      watch: {
         // 3. tell Vite to ignore watching `src-tauri`
         ignored: ["**/src-tauri/**"],
      },
   },

   // to make use of `TAURI_ENV_*` env variables
   envPrefix: ["VITE_", "TAURI_ENV_"],

   build: {
      // Tauri uses Chromium on Windows and WebKit on macOS and Linux
      target:
         process.env.TAURI_ENV_PLATFORM == "windows" ? "chrome105" : "safari13",
      // don't minify for debug builds
      minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
      // produce sourcemaps for debug builds
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
   },
}));
