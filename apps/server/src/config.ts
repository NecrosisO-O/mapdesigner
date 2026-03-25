import path from "node:path";

export const SERVER_PORT = Number(process.env.PORT ?? 3010);
export const PROJECT_ROOT = process.env.MAPDESIGNER_ROOT
  ? path.resolve(process.env.MAPDESIGNER_ROOT)
  : process.cwd();
export const MAP_STORAGE_DIR = path.join(PROJECT_ROOT, "storage/maps");
export const EXPORT_STORAGE_DIR = path.join(PROJECT_ROOT, "storage/exports");
