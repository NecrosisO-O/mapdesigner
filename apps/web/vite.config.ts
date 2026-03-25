import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@mapdesigner/map-core": path.resolve(__dirname, "../../packages/map-core/src/index.ts"),
      "@mapdesigner/map-render": path.resolve(__dirname, "../../packages/map-render/src/index.ts")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3010"
    }
  }
});
