import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  applyCommand,
  createEmptyDocument,
  createRuntimeState,
  parseDocument,
  stringifyDocument,
  type ExportRenderOptions,
  type MapCommand,
  type MapDocument,
  type MapRuntimeState,
  type ValidationIssue
} from "@mapdesigner/map-core";
import { buildExportScene, buildMapScene, renderSvgString } from "@mapdesigner/map-render";
import { EXPORT_STORAGE_DIR, MAP_STORAGE_DIR } from "./config.js";
import { createMapId, slugify } from "./utils.js";

export interface MapListItem {
  id: string;
  name: string;
  fileName: string;
  updatedAt: string;
  revision: number;
  designedCellCount: number;
}

export interface SaveMapInput {
  document: MapDocument;
  expectedRevision: number;
}

export interface SaveMapAsInput {
  document: MapDocument;
  name: string;
  id?: string;
}

async function ensureDirectories(): Promise<void> {
  await fs.mkdir(MAP_STORAGE_DIR, { recursive: true });
  await fs.mkdir(EXPORT_STORAGE_DIR, { recursive: true });
}

function mapFilePath(id: string): string {
  return path.join(MAP_STORAGE_DIR, `${id}.json`);
}

function exportFilePath(fileName: string): string {
  return path.join(EXPORT_STORAGE_DIR, fileName);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadMapDocument(id: string): Promise<MapDocument> {
  await ensureDirectories();
  const raw = await fs.readFile(mapFilePath(id), "utf8");
  const parsed = parseDocument(raw);
  if (!parsed.document) {
    throw new Error(parsed.errors.map((entry) => entry.message).join("; "));
  }
  return parsed.document;
}

function runtimeFromDocument(document: MapDocument): MapRuntimeState {
  return createRuntimeState(document);
}

export async function listMaps(): Promise<MapListItem[]> {
  await ensureDirectories();
  const files = (await fs.readdir(MAP_STORAGE_DIR)).filter((file) => file.endsWith(".json"));
  const items = await Promise.all(
    files.map(async (fileName) => {
      const raw = await fs.readFile(path.join(MAP_STORAGE_DIR, fileName), "utf8");
      const parsed = parseDocument(raw);
      if (!parsed.document) {
        return null;
      }
      return {
        id: parsed.document.meta.id,
        name: parsed.document.meta.name,
        fileName,
        updatedAt: parsed.document.meta.updated_at,
        revision: parsed.document.meta.revision,
        designedCellCount: parsed.document.cells.length
      } satisfies MapListItem;
    })
  );
  return items.filter((item): item is MapListItem => item !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createMap(input: {
  name: string;
  description?: string;
  id?: string;
}): Promise<MapRuntimeState> {
  await ensureDirectories();
  const id = input.id ?? createMapId(input.name);
  const filePath = mapFilePath(id);
  if (await fileExists(filePath)) {
    throw new Error(`map id ${id} already exists`);
  }
  const document = createEmptyDocument({
    id,
    name: input.name,
    description: input.description ?? ""
  });
  await fs.writeFile(filePath, stringifyDocument(document), "utf8");
  return runtimeFromDocument(document);
}

export async function getMap(id: string): Promise<MapRuntimeState> {
  const document = await loadMapDocument(id);
  return runtimeFromDocument(document);
}

export async function saveMap(input: SaveMapInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const current = await loadMapDocument(input.document.meta.id);
  if (current.meta.revision !== input.expectedRevision) {
    throw new Error(
      `revision conflict: expected ${input.expectedRevision}, current is ${current.meta.revision}`
    );
  }
  await fs.writeFile(mapFilePath(input.document.meta.id), stringifyDocument(input.document), "utf8");
  return runtimeFromDocument(input.document);
}

export async function saveMapAs(input: SaveMapAsInput): Promise<MapRuntimeState> {
  await ensureDirectories();
  const now = new Date().toISOString();
  const nextId = input.id ?? createMapId(input.name);
  const nextPath = mapFilePath(nextId);
  if (await fileExists(nextPath)) {
    throw new Error(`map id ${nextId} already exists`);
  }

  const document: MapDocument = {
    ...input.document,
    meta: {
      ...input.document.meta,
      id: nextId,
      name: input.name,
      created_at: now,
      updated_at: now,
      revision: 1
    }
  };

  await fs.writeFile(nextPath, stringifyDocument(document), "utf8");
  return runtimeFromDocument(document);
}

export async function deleteMap(id: string): Promise<void> {
  await fs.unlink(mapFilePath(id));
}

export async function duplicateMap(id: string): Promise<MapRuntimeState> {
  const existing = await loadMapDocument(id);
  const now = new Date().toISOString();
  const duplicateId = createMapId(existing.meta.name);
  const document: MapDocument = {
    ...existing,
    meta: {
      ...existing.meta,
      id: duplicateId,
      name: `${existing.meta.name} Copy`,
      created_at: now,
      updated_at: now,
      revision: 1
    }
  };
  await fs.writeFile(mapFilePath(duplicateId), stringifyDocument(document), "utf8");
  return runtimeFromDocument(document);
}

export async function importMap(input: {
  content: string;
  generateNewId?: boolean;
}): Promise<{ map: MapRuntimeState; warnings: ValidationIssue[] }> {
  await ensureDirectories();
  const parsed = parseDocument(input.content);
  if (!parsed.document) {
    throw new Error(parsed.errors.map((entry) => entry.message).join("; "));
  }
  let document = parsed.document;
  const currentPath = mapFilePath(document.meta.id);
  if ((await fileExists(currentPath)) && !input.generateNewId) {
    throw new Error(`meta.id conflict for ${document.meta.id}`);
  }
  if (await fileExists(currentPath)) {
    const now = new Date().toISOString();
    document = {
      ...document,
      meta: {
        ...document.meta,
        id: createMapId(document.meta.name),
        created_at: now,
        updated_at: now,
        revision: 1
      }
    };
  }
  await fs.writeFile(mapFilePath(document.meta.id), stringifyDocument(document), "utf8");
  return {
    map: runtimeFromDocument(document),
    warnings: parsed.errors.filter((entry) => entry.severity === "warning")
  };
}

export async function exportJson(id: string): Promise<{ fileName: string; path: string }> {
  const document = await loadMapDocument(id);
  const fileName = `${slugify(document.meta.name) || document.meta.id}.json`;
  const filePath = exportFilePath(fileName);
  await fs.writeFile(filePath, stringifyDocument(document), "utf8");
  return { fileName, path: filePath };
}

export async function exportPng(
  id: string,
  options: Partial<ExportRenderOptions> = {}
): Promise<{ fileName: string; path: string }> {
  const runtime = await getMap(id);
  const baseOptions: ExportRenderOptions = {
    preset: "clean",
    includeCoordinates: false,
    includeShorthand: false,
    includeGrid: true,
    includeUndesigned: false,
    background: "#F4F0E6",
    padding: 32,
    scale: 2
  };
  const resolved: ExportRenderOptions = { ...baseOptions, ...options };
  if (resolved.preset === "reference") {
    resolved.includeCoordinates = true;
    resolved.includeShorthand = true;
  }
  const scene = buildExportScene({
    map: runtime,
    options: resolved
  });
  const svg = renderSvgString(scene);
  const fileName = `${slugify(runtime.document.meta.name) || runtime.document.meta.id}-${resolved.preset}.png`;
  const filePath = exportFilePath(fileName);
  await sharp(Buffer.from(svg)).png().toFile(filePath);
  return { fileName, path: filePath };
}

export async function applyCommands(id: string, commands: MapCommand[]): Promise<{
  map: MapRuntimeState;
  warnings: ValidationIssue[];
}> {
  const document = await loadMapDocument(id);
  let state = createRuntimeState(document);
  const warnings: ValidationIssue[] = [];

  for (const command of commands) {
    const result = applyCommand(state, command);
    if (!result.ok) {
      throw new Error(result.errors.map((entry) => entry.message).join("; "));
    }
    warnings.push(...result.warnings);
    state = result.map;
  }

  await fs.writeFile(mapFilePath(id), stringifyDocument(state.document), "utf8");
  return { map: state, warnings };
}

export async function renderInlineSvg(id: string): Promise<string> {
  const runtime = await getMap(id);
  const scene = buildMapScene(runtime);
  return renderSvgString(scene);
}
