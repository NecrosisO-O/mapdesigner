#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildHexLine,
  createDisplayCoord,
  parseDisplayCoord,
  type ExportRenderOptions,
  type MapCommand,
  type RiverPoint
} from "@mapdesigner/map-core";
import {
  applyCommands,
  applyCommandsLight,
  type ApplyCommandsResult,
  type LightweightApplyCommandsResult,
  createMap,
  deleteMap,
  duplicateMap,
  exportJson,
  exportPng,
  getCellsInRange,
  getMapFeatures,
  getHistoryStatus,
  getMap,
  getMapSummary,
  getNeighbors,
  importMap,
  inspectArea,
  inspectCell,
  listMaps,
  redoMap,
  undoMap
} from "./service.js";
import { badRequest, isServiceError } from "./errors.js";
import { normalizeExportOptions } from "./storage.js";
import { createEnvelope } from "./utils.js";

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw badRequest(`${name} requires a value`);
  }
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readIntegerFlag(args: string[], name: string): number {
  const raw = readFlag(args, name);
  if (raw === undefined) {
    printFailure(`${name} is required`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    printFailure(`${name} must be an integer`);
  }
  return parsed;
}

function readOptionalIntegerFlag(args: string[], name: string): number | undefined {
  const raw = readFlag(args, name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${name} must be an integer`);
  }
  return parsed;
}

function readOptionalNumberFlag(args: string[], name: string): number | undefined {
  const raw = readFlag(args, name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw badRequest(`${name} must be a number`);
  }
  return parsed;
}

function readOptionalColorFlag(args: string[], name: string): string | undefined {
  return readFlag(args, name);
}

function readOptionalRangeFlags(args: string[]) {
  const hasAnyRangeFlag = ["--min-row", "--max-row", "--min-col", "--max-col"].some((flag) => hasFlag(args, flag));
  if (!hasAnyRangeFlag) {
    return undefined;
  }
  return {
    minRow: readIntegerFlag(args, "--min-row"),
    maxRow: readIntegerFlag(args, "--max-row"),
    minCol: readIntegerFlag(args, "--min-col"),
    maxCol: readIntegerFlag(args, "--max-col")
  };
}

function assertKnownFlags(args: string[], allowed: string[]): void {
  const allowedSet = new Set(allowed);
  for (const arg of args.slice(2)) {
    if (arg.startsWith("--") && !allowedSet.has(arg)) {
      throw badRequest(`unknown flag ${arg}`);
    }
  }
}

function printResult(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printFailure(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function buildApplySummary(result: ApplyCommandsResult | LightweightApplyCommandsResult) {
  if ("summary" in result) {
    return {
      map_id: result.mapId,
      map_name: result.summary.meta.name,
      revision: result.summary.meta.revision,
      designed_cell_count: result.summary.designed_cell_count,
      river_count: result.summary.feature_counts.rivers,
      dry_run: result.dryRun,
      warning_count: result.warnings.length,
      ...result.stats
    };
  }
  return {
    map_id: result.map.document.meta.id,
    map_name: result.map.document.meta.name,
    revision: result.map.document.meta.revision,
    designed_cell_count: result.map.document.cells.length,
    river_count: result.map.document.features.rivers.length,
    dry_run: result.dryRun,
    warning_count: result.warnings.length,
    ...result.stats
  };
}

function coordKey(coord: { row: number; col: number }): string {
  return `${coord.row},${coord.col}`;
}

function parseCoordToken(value: string): { row: number; col: number } {
  const parsed = parseDisplayCoord(value.trim());
  if (!parsed) {
    throw badRequest(`invalid coordinate ${value}; expected R<row>C<col>`);
  }
  return parsed;
}

function parseWidthAnchors(value: string | undefined): Map<string, { coord: { row: number; col: number }; width: number }> {
  const widths = new Map<string, { coord: { row: number; col: number }; width: number }>();
  if (!value) {
    return widths;
  }
  for (const token of value.split(",")) {
    if (!token.trim()) {
      continue;
    }
    const [coordRaw, widthRaw] = token.split(":");
    if (!coordRaw || !widthRaw) {
      throw badRequest("--widths entries must use R0C0:4 format");
    }
    const coord = parseCoordToken(coordRaw);
    const width = Number(widthRaw);
    if (!Number.isFinite(width)) {
      throw badRequest(`invalid river width ${widthRaw}`);
    }
    widths.set(coordKey(coord), { coord, width });
  }
  return widths;
}

function parseRiverPoints(pointsRaw: string | undefined, widthsRaw?: string): RiverPoint[] {
  if (!pointsRaw) {
    throw badRequest("--points is required");
  }
  const widths = parseWidthAnchors(widthsRaw);
  const points = pointsRaw
    .split(",")
    .filter((token) => token.trim().length > 0)
    .map((token) => {
      const coord = parseCoordToken(token);
      const width = widths.get(coordKey(coord))?.width;
      return {
        ...coord,
        ...(width === undefined ? {} : { width })
      };
    });
  for (const anchor of widths.values()) {
    if (points.some((point) => point.row === anchor.coord.row && point.col === anchor.coord.col)) {
      continue;
    }
    let inserted = false;
    for (let index = 0; index < points.length - 1; index += 1) {
      const line = buildHexLine(points[index]!, points[index + 1]!);
      const lineIndex = line.findIndex((coord) => coord.row === anchor.coord.row && coord.col === anchor.coord.col);
      if (lineIndex > 0 && lineIndex < line.length - 1) {
        points.splice(index + 1, 0, { ...anchor.coord, width: anchor.width });
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      throw badRequest(`width anchor ${createDisplayCoord(anchor.coord.row, anchor.coord.col)} is not on the river path`);
    }
  }
  return points;
}

function normalizeCommands(input: unknown): MapCommand[] {
  if (Array.isArray(input)) {
    return input as MapCommand[];
  }
  if (input && typeof input === "object" && Array.isArray((input as { commands?: unknown }).commands)) {
    return (input as { commands: MapCommand[] }).commands;
  }
  if (input && typeof input === "object" && "action" in input) {
    return [input as MapCommand];
  }
  throw badRequest("maps apply input must be a MapCommand, a MapCommand[], or an object with a commands array");
}

function parseCommandsJson(content: string): MapCommand[] {
  try {
    return normalizeCommands(JSON.parse(content) as unknown);
  } catch (error) {
    if (isServiceError(error)) {
      throw error;
    }
    throw badRequest("commands JSON is invalid");
  }
}

async function readCommands(args: string[]): Promise<MapCommand[]> {
  if (hasFlag(args, "--stdin")) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    return parseCommandsJson(Buffer.concat(chunks).toString("utf8"));
  }

  const filePath = readFlag(args, "--file");
  if (filePath) {
    return parseCommandsJson(await fs.readFile(path.resolve(filePath), "utf8"));
  }

  printFailure("maps apply requires --stdin or --file");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [group, action] = args;

  if (group !== "maps" || !action) {
    printFailure("usage: mapdesigner maps <list|create|summary|cells|inspect|inspect-cell|inspect-area|neighbors|apply|undo|redo|history-status|rivers|import|export-json|export-png|duplicate|delete>");
  }

  try {
    switch (action) {
      case "list":
        assertKnownFlags(args, []);
        printResult(createEnvelope({ result: await listMaps() }));
        break;
      case "create": {
        assertKnownFlags(args, ["--name", "--description", "--id"]);
        const name = readFlag(args, "--name");
        if (!name) {
          printFailure("maps create requires --name");
        }
        const description = readFlag(args, "--description");
        const id = readFlag(args, "--id");
        printResult(createEnvelope({ result: await createMap({ name, description, id }) }));
        break;
      }
      case "summary": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps summary requires --map-id");
        }
        printResult(createEnvelope({ result: await getMapSummary(id) }));
        break;
      }
      case "cells": {
        assertKnownFlags(args, ["--map-id", "--min-row", "--max-row", "--min-col", "--max-col", "--include-undesigned"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps cells requires --map-id");
        }
        printResult(
          createEnvelope({
            result: await getCellsInRange(
              id,
              {
                minRow: readIntegerFlag(args, "--min-row"),
                maxRow: readIntegerFlag(args, "--max-row"),
                minCol: readIntegerFlag(args, "--min-col"),
                maxCol: readIntegerFlag(args, "--max-col")
              },
              { includeUndesigned: hasFlag(args, "--include-undesigned") }
            )
          })
        );
        break;
      }
      case "inspect": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps inspect requires --map-id");
        }
        printResult(createEnvelope({ result: await getMap(id) }));
        break;
      }
      case "inspect-cell": {
        assertKnownFlags(args, ["--map-id", "--row", "--col"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps inspect-cell requires --map-id");
        }
        const row = readIntegerFlag(args, "--row");
        const col = readIntegerFlag(args, "--col");
        printResult(createEnvelope({ result: await inspectCell(id, { row, col }) }));
        break;
      }
      case "inspect-area": {
        assertKnownFlags(args, ["--map-id", "--row", "--col", "--radius"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps inspect-area requires --map-id");
        }
        const row = readIntegerFlag(args, "--row");
        const col = readIntegerFlag(args, "--col");
        const radius = readIntegerFlag(args, "--radius");
        printResult(createEnvelope({ result: await inspectArea(id, { row, col }, radius) }));
        break;
      }
      case "neighbors": {
        assertKnownFlags(args, ["--map-id", "--row", "--col"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps neighbors requires --map-id");
        }
        const row = readIntegerFlag(args, "--row");
        const col = readIntegerFlag(args, "--col");
        printResult(createEnvelope({ result: await getNeighbors(id, { row, col }) }));
        break;
      }
      case "apply": {
        assertKnownFlags(args, ["--map-id", "--stdin", "--file", "--dry-run", "--summary"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps apply requires --map-id");
        }
        const commands = await readCommands(args);
        const summaryOnly = hasFlag(args, "--summary");
        const result = summaryOnly
          ? await applyCommandsLight(id, commands, { dryRun: hasFlag(args, "--dry-run") })
          : await applyCommands(id, commands, { dryRun: hasFlag(args, "--dry-run") });
        const envelopeResult = summaryOnly ? buildApplySummary(result) : result;
        printResult(createEnvelope({ result: envelopeResult, warnings: result.warnings }));
        break;
      }
      case "history-status": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps history-status requires --map-id");
        }
        printResult(createEnvelope({ result: await getHistoryStatus(id) }));
        break;
      }
      case "undo": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps undo requires --map-id");
        }
        const result = await undoMap(id);
        printResult(createEnvelope({ result, warnings: result?.warnings ?? [] }));
        break;
      }
      case "redo": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps redo requires --map-id");
        }
        const result = await redoMap(id);
        printResult(createEnvelope({ result, warnings: result?.warnings ?? [] }));
        break;
      }
      case "rivers": {
        const riverAction = args[2];
        if (!riverAction) {
          printFailure("usage: mapdesigner maps rivers <list|inspect|create|update|delete>");
        }
        switch (riverAction) {
          case "list": {
            assertKnownFlags(args, ["--map-id"]);
            const id = readFlag(args, "--map-id");
            if (!id) {
              printFailure("maps rivers list requires --map-id");
            }
            const features = await getMapFeatures(id);
            printResult(createEnvelope({ result: features.rivers }));
            break;
          }
          case "inspect": {
            assertKnownFlags(args, ["--map-id", "--river-id"]);
            const id = readFlag(args, "--map-id");
            const riverId = readFlag(args, "--river-id");
            if (!id || !riverId) {
              printFailure("maps rivers inspect requires --map-id and --river-id");
            }
            const features = await getMapFeatures(id);
            const river = features.rivers.find((entry) => entry.id === riverId);
            if (!river) {
              throw badRequest(`river ${riverId} was not found`);
            }
            printResult(createEnvelope({ result: river }));
            break;
          }
          case "create": {
            assertKnownFlags(args, ["--map-id", "--id", "--name", "--points", "--widths", "--color", "--opacity", "--summary"]);
            const id = readFlag(args, "--map-id");
            const name = readFlag(args, "--name");
            if (!id || !name) {
              printFailure("maps rivers create requires --map-id and --name");
            }
            const result = await applyCommands(id, [
              {
                action: "create_river",
                source: "cli",
                river: {
                  id: readFlag(args, "--id"),
                  name,
                  points: parseRiverPoints(readFlag(args, "--points"), readFlag(args, "--widths")),
                  color: readOptionalColorFlag(args, "--color"),
                  opacity: readOptionalNumberFlag(args, "--opacity")
                }
              }
            ]);
            printResult(createEnvelope({ result: hasFlag(args, "--summary") ? buildApplySummary(result) : result, warnings: result.warnings }));
            break;
          }
          case "update": {
            assertKnownFlags(args, ["--map-id", "--river-id", "--name", "--points", "--widths", "--color", "--opacity", "--summary"]);
            const id = readFlag(args, "--map-id");
            const riverId = readFlag(args, "--river-id");
            if (!id || !riverId) {
              printFailure("maps rivers update requires --map-id and --river-id");
            }
            const pointsRaw = readFlag(args, "--points");
            const result = await applyCommands(id, [
              {
                action: "update_river",
                source: "cli",
                river_id: riverId,
                changes: {
                  ...(readFlag(args, "--name") ? { name: readFlag(args, "--name") } : {}),
                  ...(pointsRaw ? { points: parseRiverPoints(pointsRaw, readFlag(args, "--widths")) } : {}),
                  ...(readFlag(args, "--color") ? { color: readOptionalColorFlag(args, "--color") } : {}),
                  ...(readFlag(args, "--opacity") ? { opacity: readOptionalNumberFlag(args, "--opacity") } : {})
                }
              }
            ]);
            printResult(createEnvelope({ result: hasFlag(args, "--summary") ? buildApplySummary(result) : result, warnings: result.warnings }));
            break;
          }
          case "delete": {
            assertKnownFlags(args, ["--map-id", "--river-id", "--summary"]);
            const id = readFlag(args, "--map-id");
            const riverId = readFlag(args, "--river-id");
            if (!id || !riverId) {
              printFailure("maps rivers delete requires --map-id and --river-id");
            }
            const result = await applyCommands(id, [
              {
                action: "delete_river",
                source: "cli",
                river_id: riverId
              }
            ]);
            printResult(createEnvelope({ result: hasFlag(args, "--summary") ? buildApplySummary(result) : result, warnings: result.warnings }));
            break;
          }
          default:
            printFailure(`unknown rivers action: ${riverAction}`);
        }
        break;
      }
      case "import": {
        assertKnownFlags(args, ["--file", "--generate-new-id"]);
        const filePath = readFlag(args, "--file");
        if (!filePath) {
          printFailure("maps import requires --file");
        }
        const content = await fs.readFile(path.resolve(filePath), "utf8");
        const result = await importMap({
          content,
          generateNewId: hasFlag(args, "--generate-new-id")
        });
        printResult(createEnvelope({ result: result.map, warnings: result.warnings }));
        break;
      }
      case "export-json": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps export-json requires --map-id");
        }
        printResult(createEnvelope({ result: await exportJson(id) }));
        break;
      }
      case "export-png": {
        assertKnownFlags(args, [
          "--map-id",
          "--preset",
          "--scale",
          "--padding",
          "--background",
          "--include-grid",
          "--include-coordinates",
          "--include-shorthand",
          "--include-undesigned",
          "--min-row",
          "--max-row",
          "--min-col",
          "--max-col"
        ]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps export-png requires --map-id");
        }
        const options = normalizeExportOptions({
          preset: (readFlag(args, "--preset") ?? "clean") as ExportRenderOptions["preset"],
          scale: readOptionalIntegerFlag(args, "--scale"),
          padding: readOptionalIntegerFlag(args, "--padding"),
          background: readOptionalColorFlag(args, "--background"),
          includeGrid: hasFlag(args, "--include-grid") ? true : undefined,
          includeCoordinates: hasFlag(args, "--include-coordinates") ? true : undefined,
          includeShorthand: hasFlag(args, "--include-shorthand") ? true : undefined,
          includeUndesigned: hasFlag(args, "--include-undesigned") ? true : undefined,
          range: readOptionalRangeFlags(args)
        });
        printResult(createEnvelope({ result: await exportPng(id, options) }));
        break;
      }
      case "duplicate": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps duplicate requires --map-id");
        }
        printResult(createEnvelope({ result: await duplicateMap(id) }));
        break;
      }
      case "delete": {
        assertKnownFlags(args, ["--map-id"]);
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps delete requires --map-id");
        }
        await deleteMap(id);
        printResult(createEnvelope({ result: { deleted: true } }));
        break;
      }
      default:
        printFailure(`unknown action: ${action}`);
    }
  } catch (error) {
    const serviceError = isServiceError(error) ? error : null;
    printResult(
      createEnvelope({
        errors: [
          {
            code: serviceError?.code ?? "command_failed",
            message: serviceError?.message ?? (error as Error).message,
            severity: "invalid"
          }
        ]
      })
    );
    process.exit(1);
  }
}

await main();
