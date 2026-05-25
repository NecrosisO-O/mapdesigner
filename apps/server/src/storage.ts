import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ExportRenderOptions, MapDocument, ValidationIssue } from "@mapdesigner/map-core";
import { validateMapDocument } from "@mapdesigner/map-core";
import { badRequest, storageError, validationFailed } from "./errors.js";

const MAP_ID_PATTERN = /^[a-zA-Z0-9\u4e00-\u9fa5][a-zA-Z0-9_\-\u4e00-\u9fa5]{0,79}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const EXPORT_PRESETS: ExportRenderOptions["preset"][] = ["clean", "reference"];
const MAX_EXPORT_PADDING = 256;
const MAX_EXPORT_SCALE = 4;
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

export function assertPngExportFileName(fileName: string): string {
  const normalized = fileName.trim();
  if (!normalized || normalized !== path.basename(normalized) || hasPathSeparator(normalized) || !normalized.endsWith(".png")) {
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
    if (typeof input.background !== "string" || !HEX_COLOR_PATTERN.test(input.background)) {
      throw badRequest("background must be a #RRGGBB color");
    }
    normalized.background = input.background;
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

  return normalized;
}
