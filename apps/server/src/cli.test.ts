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
    expect(appliedBody.result.map.document.cells).toHaveLength(1);
    expect(appliedBody.result.command_results).toHaveLength(1);
    expect(appliedBody.result.changes[0].after.terrain).toBe("plain");

    const exported = await runCli(
      ["maps", "export-png", "--map-id", mapId, "--preset", "reference"],
      { tempRoot }
    );
    expect(exported.code).toBe(0);
    const exportedBody = JSON.parse(exported.stdout);
    expect(exportedBody.result.fileName).toMatch(/cli-test-reference\.png$/);
    await expect(fs.stat(exportedBody.result.path)).resolves.toBeTruthy();
  });

  it("accepts the documented commands envelope for maps apply", async () => {
    const created = await runCli(["maps", "create", "--name", "Envelope Test"], { tempRoot });
    expect(created.code).toBe(0);
    const createdBody = JSON.parse(created.stdout);
    const mapId = createdBody.result.document.meta.id as string;

    const applied = await runCli(
      ["maps", "apply", "--map-id", mapId, "--stdin"],
      {
        tempRoot,
        input: JSON.stringify({
          commands: [
            {
              action: "set_cell",
              source: "cli",
              target: { row: 0, col: 0 },
              changes: {
                terrain: "plain",
                biome: "grassland"
              }
            }
          ]
        })
      }
    );

    expect(applied.code).toBe(0);
    const appliedBody = JSON.parse(applied.stdout);
    expect(appliedBody.ok).toBe(true);
    expect(appliedBody.result.map.document.cells).toHaveLength(1);
    expect(appliedBody.result.map.document.cells[0].terrain).toBe("plain");
  });

  it("supports dry-run and query-style commands for agent workflows", async () => {
    const created = await runCli(["maps", "create", "--name", "Agent CLI"], { tempRoot });
    expect(created.code).toBe(0);
    const createdBody = JSON.parse(created.stdout);
    const mapId = createdBody.result.document.meta.id as string;

    const preview = await runCli(
      ["maps", "apply", "--map-id", mapId, "--stdin", "--dry-run"],
      {
        tempRoot,
        input: JSON.stringify({
          commands: [
            {
              action: "set_cell",
              source: "cli",
              target: { row: 0, col: 0 },
              changes: {
                terrain: "plain",
                biome: "grassland"
              }
            }
          ]
        })
      }
    );
    expect(preview.code).toBe(0);
    const previewBody = JSON.parse(preview.stdout);
    expect(previewBody.result.dryRun).toBe(true);
    expect(previewBody.result.map.document.cells).toHaveLength(1);

    const inspectedAfterPreview = await runCli(["maps", "inspect", "--map-id", mapId], { tempRoot });
    const inspectedPreviewBody = JSON.parse(inspectedAfterPreview.stdout);
    expect(inspectedPreviewBody.result.document.cells).toHaveLength(0);

    const applied = await runCli(
      ["maps", "apply", "--map-id", mapId, "--stdin"],
      {
        tempRoot,
        input: JSON.stringify({
          commands: [
            {
              action: "set_cell",
              source: "cli",
              target: { row: 0, col: 0 },
              changes: {
                terrain: "plain",
                biome: "grassland"
              }
            }
          ]
        })
      }
    );
    expect(applied.code).toBe(0);

    const inspectCell = await runCli(
      ["maps", "inspect-cell", "--map-id", mapId, "--row", "0", "--col", "0"],
      { tempRoot }
    );
    expect(inspectCell.code).toBe(0);
    const inspectCellBody = JSON.parse(inspectCell.stdout);
    expect(inspectCellBody.result.cell.display_coord).toBe("R0C0");
    expect(inspectCellBody.result.cell.status).toBe("designed");
    expect(inspectCellBody.result.neighbors).toHaveLength(6);

    const inspectArea = await runCli(
      ["maps", "inspect-area", "--map-id", mapId, "--row", "0", "--col", "0", "--radius", "1"],
      { tempRoot }
    );
    expect(inspectArea.code).toBe(0);
    const inspectAreaBody = JSON.parse(inspectArea.stdout);
    expect(inspectAreaBody.result.radius).toBe(1);
    expect(inspectAreaBody.result.cells).toHaveLength(7);

    const neighbors = await runCli(
      ["maps", "neighbors", "--map-id", mapId, "--row", "0", "--col", "0"],
      { tempRoot }
    );
    expect(neighbors.code).toBe(0);
    const neighborsBody = JSON.parse(neighbors.stdout);
    expect(neighborsBody.result.center.display_coord).toBe("R0C0");
    expect(neighborsBody.result.neighbors).toHaveLength(6);
  });
});
