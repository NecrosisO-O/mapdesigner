import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      ["--dir", "apps/server", "exec", "tsx", "src/cli.ts", ...args],
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

  vi.setConfig({ testTimeout: 15_000 });

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
        "--include-undesigned",
        "--min-row",
        "-1",
        "--max-row",
        "1",
        "--min-col",
        "-1",
        "--max-col",
        "1"
      ],
      { tempRoot }
    );
    expect(exported.code).toBe(0);
    const exportedBody = JSON.parse(exported.stdout);
    expect(exportedBody.result.fileName).toMatch(/cli-test-reference-r-1_1-c-1_1\.png$/);
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

  it("reports river feature stats for agent-created rivers", async () => {
    const created = await runCli(["maps", "create", "--name", "River Agent CLI"], { tempRoot });
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
              action: "create_river",
              source: "cli",
              river: {
                id: "north-fork",
                name: "North Fork",
                points: [
                  { row: 0, col: 0, width: 2 },
                  { row: 0, col: 2, width: 6 }
                ]
              }
            }
          ]
        })
      }
    );

    expect(applied.code).toBe(0);
    const appliedBody = JSON.parse(applied.stdout);
    expect(appliedBody.result.map.document.features.rivers).toHaveLength(1);
    expect(appliedBody.result.stats.created_count).toBe(0);
    expect(appliedBody.result.stats.feature_stats).toEqual({
      river_created_count: 1,
      river_updated_count: 0,
      river_deleted_count: 0
    });

    const inspected = await runCli(["maps", "rivers", "inspect", "--map-id", mapId, "--river-id", "north-fork"], {
      tempRoot
    });
    expect(inspected.code).toBe(0);
    const inspectedBody = JSON.parse(inspected.stdout);
    expect(inspectedBody.result.points).toHaveLength(2);
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

    const summary = await runCli(["maps", "summary", "--map-id", mapId], { tempRoot });
    expect(summary.code).toBe(0);
    const summaryBody = JSON.parse(summary.stdout);
    expect(summaryBody.result.designed_cell_count).toBe(1);
    expect(summaryBody.result.bounds.min_row).toBe(0);

    const cells = await runCli(
      [
        "maps",
        "cells",
        "--map-id",
        mapId,
        "--min-row",
        "-1",
        "--max-row",
        "1",
        "--min-col",
        "-1",
        "--max-col",
        "1",
        "--include-undesigned"
      ],
      { tempRoot }
    );
    expect(cells.code).toBe(0);
    const cellsBody = JSON.parse(cells.stdout);
    expect(cellsBody.result.cells.some((cell: { display_coord: string; status: string }) => cell.display_coord === "R0C0" && cell.status === "designed")).toBe(true);
    expect(cellsBody.result.cells.some((cell: { status: string }) => cell.status === "undesigned")).toBe(true);
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

  it("supports summary-first range inspection for larger agent workflows", async () => {
    const created = await runCli(["maps", "create", "--name", "Large Agent CLI"], { tempRoot });
    expect(created.code).toBe(0);
    const mapId = JSON.parse(created.stdout).result.document.meta.id as string;
    const targets = [];
    for (let row = -12; row <= 12; row += 1) {
      for (let col = -12; col <= 12; col += 1) {
        targets.push({ row, col });
      }
    }

    const applied = await runCli(
      ["maps", "apply", "--map-id", mapId, "--stdin", "--summary"],
      {
        tempRoot,
        input: JSON.stringify({
          commands: [
            {
              action: "set_cells",
              source: "cli",
              targets,
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
    expect(appliedBody.result.designed_cell_count).toBe(625);

    const summary = await runCli(["maps", "summary", "--map-id", mapId], { tempRoot });
    expect(summary.code).toBe(0);
    const summaryBody = JSON.parse(summary.stdout);
    expect(summaryBody.result.designed_cell_count).toBe(625);
    expect(summaryBody.result.bounds).toEqual({
      min_row: -12,
      max_row: 12,
      min_col: -12,
      max_col: 12
    });

    const cells = await runCli(
      [
        "maps",
        "cells",
        "--map-id",
        mapId,
        "--min-row",
        "10",
        "--max-row",
        "12",
        "--min-col",
        "10",
        "--max-col",
        "12"
      ],
      { tempRoot }
    );
    expect(cells.code).toBe(0);
    const cellsBody = JSON.parse(cells.stdout);
    expect(cellsBody.result.cells).toHaveLength(9);
    expect(cellsBody.result.cells.every((cell: { status: string }) => cell.status === "designed")).toBe(true);

    const inspected = await runCli(
      ["maps", "inspect-cell", "--map-id", mapId, "--row", "12", "--col", "12"],
      { tempRoot }
    );
    expect(inspected.code).toBe(0);
    const inspectedBody = JSON.parse(inspected.stdout);
    expect(inspectedBody.result.cell.display_coord).toBe("R12C12");
    expect(inspectedBody.result.cell.status).toBe("designed");
    expect(inspectedBody.result.neighbors).toHaveLength(6);

    const area = await runCli(
      ["maps", "inspect-area", "--map-id", mapId, "--row", "11", "--col", "11", "--radius", "2"],
      { tempRoot }
    );
    expect(area.code).toBe(0);
    const areaBody = JSON.parse(area.stdout);
    expect(areaBody.result.cells).toHaveLength(19);
    expect(areaBody.result.cells.some((cell: { display_coord: string }) => cell.display_coord === "R12C12")).toBe(true);
  });

  it("supports undo and redo commands for agent workflows", async () => {
    const created = await runCli(["maps", "create", "--name", "Undo CLI"], { tempRoot });
    expect(created.code).toBe(0);
    const mapId = JSON.parse(created.stdout).result.document.meta.id as string;

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

    const status = await runCli(["maps", "history-status", "--map-id", mapId], { tempRoot });
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout).result.canUndo).toBe(true);

    const undo = await runCli(["maps", "undo", "--map-id", mapId], { tempRoot });
    expect(undo.code).toBe(0);
    const undoBody = JSON.parse(undo.stdout);
    expect(undoBody.result.map.document.cells).toHaveLength(0);
    expect(undoBody.result.status.canRedo).toBe(true);

    const redo = await runCli(["maps", "redo", "--map-id", mapId], { tempRoot });
    expect(redo.code).toBe(0);
    const redoBody = JSON.parse(redo.stdout);
    expect(redoBody.result.map.document.cells[0].terrain).toBe("plain");
    expect(redoBody.result.status.canUndo).toBe(true);
  });

  it("supports advanced edit commands through maps apply", async () => {
    const created = await runCli(["maps", "create", "--name", "Advanced CLI"], { tempRoot });
    expect(created.code).toBe(0);
    const mapId = JSON.parse(created.stdout).result.document.meta.id as string;

    const commands = {
      commands: [
        {
          action: "set_cells",
          source: "cli",
          targets: [
            { row: 0, col: 0 },
            { row: 0, col: 1 }
          ],
          changes: {
            terrain: "plain",
            biome: "grassland",
            tags: ["peak"],
            note: "batch"
          }
        },
        {
          action: "replace_terrain",
          source: "cli",
          match: { terrain: "plain" },
          changes: { terrain: "hill" }
        },
        {
          action: "replace_biome",
          source: "cli",
          match: { biome: "grassland" },
          changes: { biome: "shrubland" }
        }
      ]
    };

    const preview = await runCli(["maps", "apply", "--map-id", mapId, "--stdin", "--dry-run", "--summary"], {
      tempRoot,
      input: JSON.stringify(commands)
    });
    expect(preview.code).toBe(0);
    const previewBody = JSON.parse(preview.stdout);
    expect(previewBody.result.dry_run).toBe(true);
    expect(previewBody.result.changed_count).toBe(6);
    expect(previewBody.result.designed_cell_count).toBe(2);

    const inspectedAfterPreview = await runCli(["maps", "inspect", "--map-id", mapId], { tempRoot });
    expect(JSON.parse(inspectedAfterPreview.stdout).result.document.cells).toHaveLength(0);

    const applied = await runCli(["maps", "apply", "--map-id", mapId, "--stdin", "--summary"], {
      tempRoot,
      input: JSON.stringify(commands)
    });
    expect(applied.code).toBe(0);
    const appliedBody = JSON.parse(applied.stdout);
    expect(appliedBody.result.command_count).toBe(3);
    expect(appliedBody.result.changed_count).toBe(6);
    expect(appliedBody.result.designed_cell_count).toBe(2);
    expect(appliedBody.result.terrain_summary.after.hill).toBe(4);
    expect(appliedBody.result.biome_summary.after.shrubland).toBe(2);

    const inspected = await runCli(["maps", "inspect", "--map-id", mapId], { tempRoot });
    const cells = JSON.parse(inspected.stdout).result.document.cells;
    expect(cells).toHaveLength(2);
    expect(cells[0].terrain).toBe("hill");
    expect(cells[0].biome).toBe("shrubland");
    expect(cells[0].tags).toEqual(["peak"]);
    expect(cells[0].note).toBe("batch");
  });

  it("supports river overlay commands for agent workflows", async () => {
    const created = await runCli(["maps", "create", "--name", "River CLI"], { tempRoot });
    expect(created.code).toBe(0);
    const mapId = JSON.parse(created.stdout).result.document.meta.id as string;

    const createdRiver = await runCli(
      [
        "maps",
        "rivers",
        "create",
        "--map-id",
        mapId,
        "--id",
        "main-river",
        "--name",
        "Main River",
        "--points",
        "R0C0,R0C2",
        "--widths",
        "R0C0:2,R0C1:5,R0C2:8",
        "--summary"
      ],
      { tempRoot }
    );
    expect(createdRiver.code).toBe(0);
    const createdRiverBody = JSON.parse(createdRiver.stdout);
    expect(createdRiverBody.result.river_count).toBe(1);

    const listed = await runCli(["maps", "rivers", "list", "--map-id", mapId], { tempRoot });
    expect(listed.code).toBe(0);
    const listedBody = JSON.parse(listed.stdout);
    expect(listedBody.result[0].id).toBe("main-river");
    expect(listedBody.result[0].points[0].width).toBe(2);
    expect(listedBody.result[0].points[1]).toEqual({ row: 0, col: 1, width: 5 });

    const inspected = await runCli(
      ["maps", "rivers", "inspect", "--map-id", mapId, "--river-id", "main-river"],
      { tempRoot }
    );
    expect(inspected.code).toBe(0);
    expect(JSON.parse(inspected.stdout).result.name).toBe("Main River");

    const deleted = await runCli(
      ["maps", "rivers", "delete", "--map-id", mapId, "--river-id", "main-river", "--summary"],
      { tempRoot }
    );
    expect(deleted.code).toBe(0);
    expect(JSON.parse(deleted.stdout).result.river_count).toBe(0);
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
