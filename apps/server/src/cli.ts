#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import type { ExportRenderOptions, MapCommand } from "@mapdesigner/map-core";
import {
  applyCommands,
  createMap,
  deleteMap,
  duplicateMap,
  exportJson,
  exportPng,
  getMap,
  importMap,
  listMaps
} from "./service.js";
import { createEnvelope } from "./utils.js";

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printResult(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printFailure(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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
  throw new Error("maps apply input must be a MapCommand, a MapCommand[], or an object with a commands array");
}

async function readCommands(args: string[]): Promise<MapCommand[]> {
  if (hasFlag(args, "--stdin")) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    return normalizeCommands(parsed);
  }

  const filePath = readFlag(args, "--file");
  if (filePath) {
    const parsed = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as unknown;
    return normalizeCommands(parsed);
  }

  printFailure("maps apply requires --stdin or --file");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [group, action] = args;

  if (group !== "maps" || !action) {
    printFailure("usage: mapdesigner maps <list|create|inspect|apply|import|export-json|export-png|duplicate|delete>");
  }

  try {
    switch (action) {
      case "list":
        printResult(createEnvelope({ result: await listMaps() }));
        break;
      case "create": {
        const name = readFlag(args, "--name");
        if (!name) {
          printFailure("maps create requires --name");
        }
        const description = readFlag(args, "--description");
        const id = readFlag(args, "--id");
        printResult(createEnvelope({ result: await createMap({ name, description, id }) }));
        break;
      }
      case "inspect": {
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps inspect requires --map-id");
        }
        printResult(createEnvelope({ result: await getMap(id) }));
        break;
      }
      case "apply": {
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps apply requires --map-id");
        }
        const commands = await readCommands(args);
        const result = await applyCommands(id, commands);
        printResult(createEnvelope({ result: result.map, warnings: result.warnings }));
        break;
      }
      case "import": {
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
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps export-json requires --map-id");
        }
        printResult(createEnvelope({ result: await exportJson(id) }));
        break;
      }
      case "export-png": {
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps export-png requires --map-id");
        }
        const preset = (readFlag(args, "--preset") ?? "clean") as ExportRenderOptions["preset"];
        printResult(createEnvelope({ result: await exportPng(id, { preset }) }));
        break;
      }
      case "duplicate": {
        const id = readFlag(args, "--map-id");
        if (!id) {
          printFailure("maps duplicate requires --map-id");
        }
        printResult(createEnvelope({ result: await duplicateMap(id) }));
        break;
      }
      case "delete": {
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
    printResult(
      createEnvelope({
        errors: [
          {
            code: "command_failed",
            message: (error as Error).message,
            severity: "invalid"
          }
        ]
      })
    );
    process.exit(1);
  }
}

await main();
