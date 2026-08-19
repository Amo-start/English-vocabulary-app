import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

// Vite 构建渲染进程 → dist/renderer
export default defineConfig({
  plugins: [vue()],
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") }
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    target: "chrome120",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  server: {
    port: 5177,
    strictPort: true
  }
});
