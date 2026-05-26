import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@mapdesigner/map-core": path.resolve(__dirname, "../map-core/src/index.ts")
    }
  }
});
