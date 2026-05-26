import { initDb } from "./db.js";
import { SERVER_PORT } from "./config.js";
import { createServer } from "./api.js";
import { importLegacyJsonFiles } from "./service.js";

// Initialize SQLite then import legacy JSON files
initDb();
try {
  const count = importLegacyJsonFiles();
  if (count > 0) {
    console.log(`Imported ${count} legacy map(s) from storage/maps`);
  }
} catch (err) {
  console.error("Legacy import error:", err);
}

const app = await createServer();

app.listen({ port: SERVER_PORT, host: "0.0.0.0" }).catch((error) => {
  console.error(error);
  process.exit(1);
});
