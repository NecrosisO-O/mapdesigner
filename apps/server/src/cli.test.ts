import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");

function runCli(args: string[], options?: { input?: string; tempRoot?: string }): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "apps/server/src/cli.ts", ...args],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          MAPDESIGNER_ROOT: options?.tempRoot ?? process.env.MAPDESIGNER_ROOT ?? repoRoot
        },
        stdio: "pipe"
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    if (options?.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

describe("server cli", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mapdesigner-cli-"));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("supports create, list, inspect, apply --stdin, and export-png", async () => {
    const created = await runCli(["maps", "create", "--name", "CLI Test"], { tempRoot });
    expect(created.code).toBe(0);
    const createdBody = JSON.parse(created.stdout);
    expect(createdBody.ok).toBe(true);
    const mapId = createdBody.result.document.meta.id as string;
    expect(mapId).toMatch(/^cli-test-/);

    const listed = await runCli(["maps", "list"], { tempRoot });
    expect(listed.code).toBe(0);
    const listedBody = JSON.parse(listed.stdout);
    expect(listedBody.result).toHaveLength(1);
    expect(listedBody.result[0].name).toBe("CLI Test");

    const inspected = await runCli(["maps", "inspect", "--map-id", mapId], { tempRoot });
    expect(inspected.code).toBe(0);
    const inspectedBody = JSON.parse(inspected.stdout);
    expect(inspectedBody.result.document.meta.name).toBe("CLI Test");

    const applied = await runCli(
      ["maps", "apply", "--map-id", mapId, "--stdin"],
      {
        tempRoot,
        input: JSON.stringify({
          action: "set_cell",
          source: "cli",
          target: { row: 0, col: 0 },
          changes: {
            terrain: "plain",
            biome: "grassland"
          }
        })
      }
    );
    expect(applied.code).toBe(0);
    const appliedBody = JSON.parse(applied.stdout);
    expect(appliedBody.result.document.cells).toHaveLength(1);

    const exported = await runCli(
      ["maps", "export-png", "--map-id", mapId, "--preset", "reference"],
      { tempRoot }
    );
    expect(exported.code).toBe(0);
    const exportedBody = JSON.parse(exported.stdout);
    expect(exportedBody.result.fileName).toMatch(/cli-test-reference\.png$/);
    await expect(fs.stat(exportedBody.result.path)).resolves.toBeTruthy();
  });
});
