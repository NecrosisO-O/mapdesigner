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
    expect(appliedBody.result.stats.created_count).toBe(1);
    expect(appliedBody.result.stats.terrain_summary.after.plain).toBe(1);

    const exported = await runCli(
      [
        "maps",
        "export-png",
        "--map-id",
        mapId,
        "--preset",
        "reference",
        "--scale",
        "3",
        "--padding",
        "24",
        "--background",
        "#FFFFFF",
        "--include-grid",
        "--include-coordinates",
        "--include-shorthand",
        "--include-undesigned"
      ],
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

  it("supports compact apply summaries for large automation workflows", async () => {
    const created = await runCli(["maps", "create", "--name", "Summary CLI"], { tempRoot });
    expect(created.code).toBe(0);
    const createdBody = JSON.parse(created.stdout);
    const mapId = createdBody.result.document.meta.id as string;

    const applied = await runCli(
      ["maps", "apply", "--map-id", mapId, "--stdin", "--summary"],
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
    expect(appliedBody.result.map_id).toBe(mapId);
    expect(appliedBody.result.command_count).toBe(1);
    expect(appliedBody.result.changed_count).toBe(1);
    expect(appliedBody.result.created_count).toBe(1);
    expect(appliedBody.result.designed_cell_count).toBe(1);
    expect(appliedBody.result.terrain_summary.after.plain).toBe(1);
  });

  it("reports missing flag values and unknown flags as structured errors", async () => {
    const missingValue = await runCli(["maps", "create", "--name"], { tempRoot });
    expect(missingValue.code).toBe(1);
    const missingValueBody = JSON.parse(missingValue.stdout);
    expect(missingValueBody.ok).toBe(false);
    expect(missingValueBody.errors[0].code).toBe("bad_request");
    expect(missingValueBody.errors[0].message).toMatch(/--name requires a value/);

    const unknown = await runCli(["maps", "list", "--verbose"], { tempRoot });
    expect(unknown.code).toBe(1);
    const unknownBody = JSON.parse(unknown.stdout);
    expect(unknownBody.errors[0].code).toBe("bad_request");
    expect(unknownBody.errors[0].message).toMatch(/unknown flag --verbose/);
  });

  it("reports invalid apply JSON and invalid apply envelopes cleanly", async () => {
    const created = await runCli(["maps", "create", "--name", "Invalid CLI Apply"], { tempRoot });
    expect(created.code).toBe(0);
    const mapId = JSON.parse(created.stdout).result.document.meta.id as string;

    const invalidJson = await runCli(["maps", "apply", "--map-id", mapId, "--stdin"], {
      tempRoot,
      input: "{"
    });
    expect(invalidJson.code).toBe(1);
    const invalidJsonBody = JSON.parse(invalidJson.stdout);
    expect(invalidJsonBody.errors[0].code).toBe("bad_request");
    expect(invalidJsonBody.errors[0].message).toBe("commands JSON is invalid");

    const invalidEnvelope = await runCli(["maps", "apply", "--map-id", mapId, "--stdin"], {
      tempRoot,
      input: JSON.stringify({ commands: "not-an-array" })
    });
    expect(invalidEnvelope.code).toBe(1);
    const invalidEnvelopeBody = JSON.parse(invalidEnvelope.stdout);
    expect(invalidEnvelopeBody.errors[0].code).toBe("bad_request");
    expect(invalidEnvelopeBody.errors[0].message).toMatch(/maps apply input/);
  });

  it("rejects invalid export-png flags and options", async () => {
    const created = await runCli(["maps", "create", "--name", "Invalid Export CLI"], { tempRoot });
    expect(created.code).toBe(0);
    const mapId = JSON.parse(created.stdout).result.document.meta.id as string;

    const unknownFlag = await runCli(["maps", "export-png", "--map-id", mapId, "--mystery"], { tempRoot });
    expect(unknownFlag.code).toBe(1);
    expect(JSON.parse(unknownFlag.stdout).errors[0].message).toMatch(/unknown flag --mystery/);

    const invalidScale = await runCli(["maps", "export-png", "--map-id", mapId, "--scale", "5"], { tempRoot });
    expect(invalidScale.code).toBe(1);
    const invalidScaleBody = JSON.parse(invalidScale.stdout);
    expect(invalidScaleBody.errors[0].code).toBe("bad_request");
    expect(invalidScaleBody.errors[0].message).toMatch(/scale must be an integer between 1 and 4/);
  });
});
