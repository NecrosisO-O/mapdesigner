import fs from "node:fs";
import type { DesignedCellRecord } from "@mapdesigner/map-core";
import { getMapDb, insertMapDb, upsertCellsBatchDb } from "./db.js";

const BATCH_SIZE = 5000;

/**
 * Stream-import a JSON map file that may be too large for JSON.parse.
 *
 * This uses a manual streaming approach: reads the file as a UTF-8 stream,
 * locates the "cells": [ array, and extracts cell objects one at a time
 * using brace counting. Works for the known MapDocument JSON format.
 */
export async function streamImportJson(filePath: string): Promise<{ mapId: string; cellCount: number }> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 65536 });

    let buffer = "";
    let state: "header" | "cells" | "done" = "header";
    let metaSection = "";
    let cellCount = 0;
    let cellDepth = 0;
    let currentCell = "";
    let inCellsArray = false;
    let mapId = "";
    let mapName = "";
    let mapDescription = "";
    let mapTags: string[] = [];
    let mapLayout = "flat-top-even-q";
    let mapCreatedAt = "";
    let mapRevision = 0;
    let batch: DesignedCellRecord[] = [];

    function flushBatch(): void {
      if (batch.length === 0) return;
      upsertCellsBatchDb(mapId, batch);
      batch = [];
    }

    function extractString(str: string, key: string): string {
      const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
      const m = str.match(re);
      return m ? JSON.parse(`"${m[1]}"`) : "";
    }

    function extractInt(str: string, key: string): number {
      const re = new RegExp(`"${key}"\\s*:\\s*(\\d+)`);
      const m = str.match(re);
      return m ? Number.parseInt(m[1]!, 10) : 0;
    }

    stream.on("data", (chunk: string | Buffer) => {
      buffer += chunk.toString();

      if (state === "header") {
        // Look for the "cells": [ or "cells":\n[ pattern
        const cellsMatch = buffer.match(/"cells"\s*:\s*\[/);
        if (cellsMatch) {
          metaSection = buffer.slice(0, cellsMatch.index);
          // Parse metadata
          mapId = extractString(metaSection, "id") || extractString(buffer, "id");
          mapName = extractString(metaSection, "name") || extractString(buffer, "name");
          mapDescription = extractString(metaSection, "description");
          mapLayout = extractString(metaSection, "layout") || "flat-top-even-q";
          mapCreatedAt = extractString(metaSection, "created_at");
          mapRevision = extractInt(metaSection, "revision");

          // Extract tags array from meta
          const tagsMatch = metaSection.match(/"tags"\s*:\s*\[([^\]]*)\]/);
          if (tagsMatch && tagsMatch[1]?.trim()) {
            mapTags = tagsMatch[1].split(",").map(t => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
          }

          state = "cells";
          inCellsArray = true;
          const idx = cellsMatch.index ?? 0;
          buffer = buffer.slice(idx + cellsMatch[0].length);
        }
        return;
      }

      if (state === "cells") {
        let pos = 0;
        while (pos < buffer.length) {
          const ch = buffer[pos]!;

          if (ch === "{" && !escaped(buffer, pos)) {
            if (cellDepth === 0) currentCell = "";
            cellDepth++;
            if (cellDepth >= 1) currentCell += ch;
          } else if (ch === "}" && !escaped(buffer, pos)) {
            cellDepth--;
            if (cellDepth >= 0) currentCell += ch;

            if (cellDepth === 0) {
              // Complete cell object
              try {
                const cell = JSON.parse(currentCell) as DesignedCellRecord;
                batch.push({
                  row: cell.row,
                  col: cell.col,
                  terrain: cell.terrain,
                  biome: cell.biome ?? null,
                  tags: cell.tags ?? [],
                  note: cell.note ?? ""
                });
                cellCount++;

                if (batch.length >= BATCH_SIZE) {
                  flushBatch();
                }
              } catch {
                // skip malformed cell
              }
              currentCell = "";
            }
          } else if (cellDepth >= 1) {
            currentCell += ch;
          } else if (ch === "]") {
            // End of cells array
            flushBatch();
            inCellsArray = false;
            state = "done";
            break;
          }
          pos++;
        }
        buffer = buffer.slice(pos);
        return;
      }
    });

    stream.on("end", () => {
      flushBatch();
      if (!mapId) {
        reject(new Error("No map ID found in JSON"));
        return;
      }

      // Insert map metadata if new
      const now = new Date().toISOString();
      if (!getMapDb(mapId)) {
        insertMapDb({
          id: mapId,
          name: mapName,
          description: mapDescription,
          tags: JSON.stringify(mapTags),
          layout: mapLayout,
          schema_version: 1,
          created_at: mapCreatedAt || now,
          updated_at: now,
          revision: mapRevision + 1
        });
      }

      resolve({ mapId, cellCount });
    });

    stream.on("error", (err) => reject(err));
  });
}

function escaped(buffer: string, pos: number): boolean {
  let count = 0;
  let i = pos - 1;
  while (i >= 0 && buffer[i] === "\\") {
    count++;
    i--;
  }
  return count % 2 === 1;
}
