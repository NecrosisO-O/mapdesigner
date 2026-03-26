import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");

describe("server config", () => {
  afterEach(() => {
    delete process.env.MAPDESIGNER_ROOT;
  });

  it("defaults storage directories to the repository root", async () => {
    delete process.env.MAPDESIGNER_ROOT;
    vi.resetModules();

    const config = await import("./config.js");

    expect(config.REPO_ROOT).toBe(repoRoot);
    expect(config.PROJECT_ROOT).toBe(repoRoot);
    expect(config.MAP_STORAGE_DIR).toBe(path.join(repoRoot, "storage/maps"));
    expect(config.EXPORT_STORAGE_DIR).toBe(path.join(repoRoot, "storage/exports"));
    expect(config.WEB_DIST_DIR).toBe(path.join(repoRoot, "apps/web/dist"));
  });

  it("respects MAPDESIGNER_ROOT overrides", async () => {
    process.env.MAPDESIGNER_ROOT = "/tmp/mapdesigner-custom-root";
    vi.resetModules();

    const config = await import("./config.js");

    expect(config.REPO_ROOT).toBe(repoRoot);
    expect(config.PROJECT_ROOT).toBe("/tmp/mapdesigner-custom-root");
    expect(config.MAP_STORAGE_DIR).toBe("/tmp/mapdesigner-custom-root/storage/maps");
    expect(config.EXPORT_STORAGE_DIR).toBe("/tmp/mapdesigner-custom-root/storage/exports");
    expect(config.WEB_DIST_DIR).toBe(path.join(repoRoot, "apps/web/dist"));
  });
});
