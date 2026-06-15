import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { CellRange, ExportRenderOptions, MapDocument, ValidationIssue } from "@mapdesigner/map-core";
import { validateMapDocument } from "@mapdesigner/map-core";
import { badRequest, storageError, validationFailed } from "./errors.js";

const MAP_ID_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fa5][a-zA-Z0-9_\-\u4e00-\u9fa5]{0,79}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TRANSPARENT_BACKGROUND = "transparent";
const EXPORT_PRESETS: ExportRenderOptions["preset"][] = ["clean", "reference"];
const MAX_EXPORT_PADDING = 256;
const MAX_EXPORT_SCALE = 4;
const MAX_PNG_EXPORT_RANGE_CELLS = 25_000;
export const MAX_INSPECT_AREA_RADIUS = 50;

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

export function assertSafeMapId(id: string): string {
  const normalized = id.trim();
  if (!normalized) {
    throw badRequest("map id is required");
  }
  if (!MAP_ID_PATTERN.test(normalized)) {
    throw badRequest("map id may only contain letters, numbers, CJK ideographs, underscores, and hyphens");
  }
  return normalized;
}

export function resolveStorageFile(rootDir: string, fileName: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, fileName);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw badRequest("storage path escapes the configured storage directory");
  }
  return resolvedPath;
}

export function mapFilePath(rootDir: string, id: string): string {
  return resolveStorageFile(rootDir, `${assertSafeMapId(id)}.json`);
}

export function exportFilePath(rootDir: string, fileName: string): string {
  const normalized = fileName.trim();
  if (!normalized || normalized !== path.basename(normalized) || hasPathSeparator(normalized)) {
    throw badRequest("invalid export file name");
  }
  return resolveStorageFile(rootDir, normalized);
}

export function assertExportDownloadFileName(fileName: string): string {
  const normalized = fileName.trim();
  if (
    !normalized ||
    normalized !== path.basename(normalized) ||
    hasPathSeparator(normalized) ||
    (!normalized.endsWith(".png") && !normalized.endsWith(".json"))
  ) {
    throw badRequest("invalid export file name");
  }
  return normalized;
}

export async function writeFileAtomic(filePath: string, content: string | Buffer): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );

  try {
    await fs.writeFile(temporaryPath, content);
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw storageError("failed to write file", error);
  }
}

export async function writeFileAtomicStream(
  filePath: string,
  writeContent: (write: (chunk: string | Buffer) => Promise<void>) => Promise<void>
): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  const stream = createWriteStream(temporaryPath);
  let closed = false;
  const closeStream = async (): Promise<void> => {
    if (closed) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.end(() => resolve());
    });
    closed = true;
  };

  try {
    await writeContent(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          stream.write(chunk, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        })
    );
    await closeStream();
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    stream.destroy();
    closed = true;
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw storageError("failed to write file", error);
  }
}

export function validateDocumentForWrite(document: MapDocument): ValidationIssue[] {
  const issues = validateMapDocument(document);
  const invalidIssues = issues.filter((entry) => entry.severity === "invalid");
  if (invalidIssues.length > 0) {
    throw validationFailed("map document failed validation", invalidIssues);
  }
  return issues.filter((entry) => entry.severity === "warning");
}

function readBooleanOption(input: Partial<ExportRenderOptions>, key: keyof Pick<
  ExportRenderOptions,
  "includeCoordinates" | "includeShorthand" | "includeGrid" | "includeUndesigned"
>): boolean | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw badRequest(`${key} must be a boolean`);
  }
  return value;
}

function readIntegerOption(
  input: Partial<ExportRenderOptions>,
  key: keyof Pick<ExportRenderOptions, "padding" | "scale">,
  min: number,
  max: number
): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeExportRange(value: unknown): CellRange | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("range must be an object with minRow, maxRow, minCol, and maxCol");
  }
  const input = value as Partial<CellRange>;
  const range: CellRange = {
    minRow: input.minRow as number,
    maxRow: input.maxRow as number,
    minCol: input.minCol as number,
    maxCol: input.maxCol as number
  };
  for (const [key, entry] of Object.entries(range)) {
    if (!Number.isInteger(entry)) {
      throw badRequest(`range.${key} must be an integer`);
    }
  }
  if (range.minRow > range.maxRow) {
    throw badRequest("range.minRow must be less than or equal to range.maxRow");
  }
  if (range.minCol > range.maxCol) {
    throw badRequest("range.minCol must be less than or equal to range.maxCol");
  }
  const cellCount = (range.maxRow - range.minRow + 1) * (range.maxCol - range.minCol + 1);
  if (cellCount > MAX_PNG_EXPORT_RANGE_CELLS) {
    throw badRequest(`range covers too many cells for PNG export; maximum is ${MAX_PNG_EXPORT_RANGE_CELLS}`);
  }
  return range;
}

export function normalizeExportOptions(
  input: Partial<ExportRenderOptions> = {}
): Partial<ExportRenderOptions> {
  const normalized: Partial<ExportRenderOptions> = {};

  if (input.preset !== undefined) {
    if (!EXPORT_PRESETS.includes(input.preset)) {
      throw badRequest("preset must be clean or reference");
    }
    normalized.preset = input.preset;
  }

  const padding = readIntegerOption(input, "padding", 0, MAX_EXPORT_PADDING);
  if (padding !== undefined) {
    normalized.padding = padding;
  }

  const scale = readIntegerOption(input, "scale", 1, MAX_EXPORT_SCALE);
  if (scale !== undefined) {
    normalized.scale = scale;
  }

  if (input.background !== undefined) {
    if (typeof input.background !== "string") {
      throw badRequest("background must be a #RRGGBB color or transparent");
    }
    const background = input.background.trim();
    if (!HEX_COLOR_PATTERN.test(background) && background.toLowerCase() !== TRANSPARENT_BACKGROUND) {
      throw badRequest("background must be a #RRGGBB color or transparent");
    }
    normalized.background = background.toLowerCase() === TRANSPARENT_BACKGROUND ? TRANSPARENT_BACKGROUND : background;
  }

  const includeCoordinates = readBooleanOption(input, "includeCoordinates");
  if (includeCoordinates !== undefined) {
    normalized.includeCoordinates = includeCoordinates;
  }

  const includeShorthand = readBooleanOption(input, "includeShorthand");
  if (includeShorthand !== undefined) {
    normalized.includeShorthand = includeShorthand;
  }

  const includeGrid = readBooleanOption(input, "includeGrid");
  if (includeGrid !== undefined) {
    normalized.includeGrid = includeGrid;
  }

  const includeUndesigned = readBooleanOption(input, "includeUndesigned");
  if (includeUndesigned !== undefined) {
    normalized.includeUndesigned = includeUndesigned;
  }

  const range = normalizeExportRange(input.range);
  if (range !== undefined) {
    normalized.range = range;
  }

  return normalized;
}
