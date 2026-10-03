import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const appRoot = path.resolve(process.argv[2]);
const storage = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-smoke-"));
const port = 3199,
  base = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, ["dist/apps/server/src/index.js"], {
  cwd: appRoot,
  env: {
    ...process.env,
    MAPDESIGNER_ROOT: storage,
    PORT: String(port),
    HOST: "127.0.0.1",
    MAPDESIGNER_TOKEN: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let log = "";
child.stderr.on("data", (data) => {
  log += data;
});
try {
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      healthy = (await fetch(base + "/api/health")).ok;
    } catch {}
    if (healthy) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!healthy) throw new Error("Production server failed: " + log);
  if (!(await fetch(base)).ok) throw new Error("Missing production UI");
  const created = await (
    await fetch(base + "/api/maps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Smoke" })
    })
  ).json();
  if (!created.ok) throw new Error(JSON.stringify(created));
  const job = await (
    await fetch(base + "/api/jobs/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "png", mapId: created.result.document.meta.id })
    })
  ).json();
  for (let i = 0; i < 100; i++) {
    const status = await (await fetch(base + "/api/jobs/" + job.result.id)).json();
    if (status.result.state === "failed") throw new Error(status.result.error);
    if (status.result.state === "done") {
      const response = await fetch(base + status.result.result.downloadUrl);
      if (!response.ok || (await response.arrayBuffer()).byteLength < 100)
        throw new Error("Invalid PNG download");
      console.log("Production UI, SQLite, worker and PNG download passed");
      break;
    }
    if (i === 99) throw new Error("Production job timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(storage, { recursive: true, force: true });
}
