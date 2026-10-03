import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@mapdesigner/map-core": path.resolve(import.meta.dirname, "../../packages/map-core/src/index.ts"),
      "@mapdesigner/map-render": path.resolve(import.meta.dirname, "../../packages/map-render/src/index.ts")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3010"
    }
  }
});
