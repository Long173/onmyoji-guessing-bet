import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { syncOcrAssets } from "./tools/ocr-assets.mjs";

const ROOT = path.resolve(__dirname, "..", "..");

/** Screenshot import: copy the tesseract.js worker / core / eng traineddata into public/tesseract (served locally, no CDN). */
const ocrAssets = () => ({
  name: "ocr-assets",
  configResolved() { syncOcrAssets(__dirname, (m: string) => console.log(m)); },
});

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/ — the Pages workflow sets PAGES_BASE; local builds stay at "/".
  base: process.env.PAGES_BASE ?? "/",
  plugins: [vue(), ocrAssets()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // ★ 引擎只允许被 adapters / workers 引用；页面与 store 不得 import 这里
      "@engine": path.resolve(ROOT, "battle-lab"),
    },
  },
  server: {
    fs: {
      // 允许读取工程根（引擎源码在 apps/web 之外）
      allow: [ROOT],
    },
  },
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
});
