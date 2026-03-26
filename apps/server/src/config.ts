import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_PORT = Number(process.env.PORT ?? 3010);

function resolveProjectRoot(): string {
  if (process.env.MAPDESIGNER_ROOT) {
    return path.resolve(process.env.MAPDESIGNER_ROOT);
  }

  let current = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

export const PROJECT_ROOT = resolveProjectRoot();
export const MAP_STORAGE_DIR = path.join(PROJECT_ROOT, "storage/maps");
export const EXPORT_STORAGE_DIR = path.join(PROJECT_ROOT, "storage/exports");
