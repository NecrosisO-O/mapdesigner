import fs from "node:fs/promises";
import path from "node:path";
import { getDatabase, closeDatabaseForTests } from "../apps/server/dist/apps/server/src/db.js";
import { STORAGE_DIR, MAP_STORAGE_DIR } from "../apps/server/dist/apps/server/src/config.js";
const destination = path.resolve(
  process.argv[2] ??
    path.join(STORAGE_DIR, "backups", new Date().toISOString().replaceAll(":", "-"))
);
try {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination, { recursive: false });
  await getDatabase().backup(path.join(destination, "mapdesigner.db"));
  await fs
    .cp(MAP_STORAGE_DIR, path.join(destination, "maps"), { recursive: true, force: false })
    .catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  await fs.writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        schema: 1,
        database: "mapdesigner.db",
        includesHistory: true
      },
      null,
      2
    )
  );
  console.log("Backup complete: " + destination);
} finally {
  closeDatabaseForTests();
}
