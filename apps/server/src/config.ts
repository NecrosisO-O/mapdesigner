import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_PORT = Number(process.env.PORT ?? 3010);
export const SERVER_HOST = process.env.HOST ?? "127.0.0.1";
export const API_TOKEN = process.env.MAPDESIGNER_TOKEN?.trim() ?? "";
export const ALLOWED_ORIGINS = new Set(
  (process.env.MAPDESIGNER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function validateListenConfig(): void {
  if (!Number.isInteger(SERVER_PORT) || SERVER_PORT < 1 || SERVER_PORT > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (!LOOPBACK_HOSTS.has(SERVER_HOST) && !API_TOKEN) {
    throw new Error("Set MAPDESIGNER_TOKEN before listening on a network interface");
  }
}

function findWorkspaceRoot(startDir: string): string {
  let current = startDir;
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

function resolveProjectRoot(): string {
  if (process.env.MAPDESIGNER_ROOT) {
    return path.resolve(process.env.MAPDESIGNER_ROOT);
  }
  return REPO_ROOT;
}

export const REPO_ROOT = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
export const PROJECT_ROOT = resolveProjectRoot();
export const STORAGE_DIR = path.join(PROJECT_ROOT, "storage");
export const MAP_STORAGE_DIR = path.join(PROJECT_ROOT, "storage/maps");
export const EXPORT_STORAGE_DIR = path.join(PROJECT_ROOT, "storage/exports");
export const DATABASE_FILE = path.join(STORAGE_DIR, "mapdesigner.db");
export const WEB_DIST_DIR = path.join(REPO_ROOT, "apps/web/dist");
