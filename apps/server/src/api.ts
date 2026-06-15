import fs from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { ExportRenderOptions, MapCommand } from "@mapdesigner/map-core";
import { EXPORT_STORAGE_DIR, SERVER_PORT, WEB_DIST_DIR } from "./config.js";
import { badRequest, isServiceError } from "./errors.js";
import {
  applyCommands,
  applyCommandsLight,
  createMap,
  deleteMap,
  duplicateMap,
  exportJson,
  exportPng,
  getCellsInRange,
  getMapFeatures,
  getMapFeaturesInRange,
  getMapHistory,
  getHistoryStatus,
  getMap,
  getMapSummary,
  importMap,
  listMaps,
  redoMap,
  redoMapLight,
  saveMapAs,
  saveMap,
  summaryFromRuntime,
  undoMap,
  undoMapLight,
  updateMapMeta
} from "./service.js";
import { assertExportDownloadFileName, exportFilePath, normalizeExportOptions } from "./storage.js";
import { createEnvelope } from "./utils.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sendWebIndex(indexPath: string, reply: FastifyReply) {
  reply.type("text/html; charset=utf-8");
  return reply.send(await fs.readFile(indexPath, "utf8"));
}

function sendError(reply: FastifyReply, fallbackCode: string, error: unknown, fallbackStatus = 400) {
  const serviceError = isServiceError(error) ? error : null;
  reply.status(serviceError?.statusCode ?? fallbackStatus);
  return createEnvelope({
    errors: [
      {
        code: serviceError?.code ?? fallbackCode,
        message: serviceError?.message ?? "request failed",
        severity: "invalid",
        issues: serviceError?.issues
      }
    ]
  });
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(message);
  }
  return value as Record<string, unknown>;
}

function readStringField(body: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = body[key];
  if (value === undefined) {
    if (required) {
      throw badRequest(`${key} is required`);
    }
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${key} must be a non-empty string`);
  }
  return value;
}

function readIntegerQuery(value: unknown, key: string): number {
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${key} must be an integer`);
  }
  return parsed;
}

function readBooleanQuery(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw badRequest("includeUndesigned must be true or false");
}

function readIncludeMapQuery(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw badRequest("includeMap must be true or false");
}

async function applyCommandRequest(id: string, bodyInput: unknown, dryRun = false, includeMap = true) {
  const body = assertRecord(bodyInput, "request body is required");
  if (!Array.isArray(body.commands)) {
    throw badRequest("commands must be an array");
  }
  if (!includeMap) {
    const result = await applyCommandsLight(id, body.commands as MapCommand[], { dryRun });
    return createEnvelope({
      result: {
        summary: result.summary,
        ...(result.features ? { features: result.features } : {}),
        dryRun: result.dryRun,
        warnings: result.warnings,
        command_results: result.command_results,
        changes: result.changes,
        stats: result.stats
      },
      warnings: result.warnings
    });
  }
  const result = await applyCommands(id, body.commands as MapCommand[], { dryRun });
  return createEnvelope({
    result: {
      ...(includeMap ? { map: result.map } : {}),
      summary: summaryFromRuntime(result.map),
      features: result.map.document.features,
      dryRun: result.dryRun,
      warnings: result.warnings,
      command_results: result.command_results,
      changes: result.changes,
      stats: result.stats
    },
    warnings: result.warnings
  });
}

async function historyMoveResponse(result: Awaited<ReturnType<typeof undoMap>>, includeMap = true) {
  if (!result) {
    return createEnvelope({ result });
  }
  return createEnvelope({
    result: {
      ...(includeMap ? { map: result.map } : {}),
      summary: summaryFromRuntime(result.map),
      features: result.map.document.features,
      warnings: result.warnings,
      operation: result.operation,
      status: result.status
    },
    warnings: result.warnings
  });
}

async function lightHistoryMoveResponse(result: Awaited<ReturnType<typeof undoMapLight>>) {
  if (!result) {
    return createEnvelope({ result });
  }
  return createEnvelope({
    result: {
      summary: result.summary,
      ...(result.features ? { features: result.features } : {}),
      warnings: result.warnings,
      operation: result.operation,
      status: result.status
    },
    warnings: result.warnings
  });
}

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  const webIndexPath = path.join(WEB_DIST_DIR, "index.html");
  const webAssetsDir = path.join(WEB_DIST_DIR, "assets");
  const hasWebBuild = await fileExists(webIndexPath);

  if (hasWebBuild && await fileExists(webAssetsDir)) {
    await app.register(fastifyStatic, {
      root: webAssetsDir,
      prefix: "/assets/"
    });
  }

  app.get("/api/health", async () => createEnvelope({ result: { status: "ok", port: SERVER_PORT } }));

  app.get("/api/maps", async () => createEnvelope({ result: await listMaps() }));

  app.get<{ Params: { id: string } }>("/api/maps/:id", async (request, reply) => {
    try {
      return createEnvelope({ result: await getMap(request.params.id) });
    } catch (error) {
      return sendError(reply, "map_not_found", error, 404);
    }
  });

  app.get<{ Params: { id: string } }>("/api/maps/:id/summary", async (request, reply) => {
    try {
      return createEnvelope({ result: await getMapSummary(request.params.id) });
    } catch (error) {
      return sendError(reply, "map_summary_failed", error, 404);
    }
  });

  app.get<{ Params: { id: string } }>("/api/maps/:id/features", async (request, reply) => {
    try {
      return createEnvelope({ result: await getMapFeatures(request.params.id) });
    } catch (error) {
      return sendError(reply, "map_features_failed", error, 404);
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { minRow?: string; maxRow?: string; minCol?: string; maxCol?: string; limit?: string; offset?: string };
  }>("/api/maps/:id/features/range", async (request, reply) => {
    try {
      return createEnvelope({
        result: await getMapFeaturesInRange(
          request.params.id,
          {
            minRow: readIntegerQuery(request.query.minRow, "minRow"),
            maxRow: readIntegerQuery(request.query.maxRow, "maxRow"),
            minCol: readIntegerQuery(request.query.minCol, "minCol"),
            maxCol: readIntegerQuery(request.query.maxCol, "maxCol")
          },
          {
            limit: request.query.limit === undefined ? undefined : readIntegerQuery(request.query.limit, "limit"),
            offset: request.query.offset === undefined ? undefined : readIntegerQuery(request.query.offset, "offset")
          }
        )
      });
    } catch (error) {
      return sendError(reply, "map_features_range_failed", error, 404);
    }
  });

  app.get<{
    Params: { id: string };
    Querystring: { minRow?: string; maxRow?: string; minCol?: string; maxCol?: string; includeUndesigned?: string };
  }>("/api/maps/:id/cells", async (request, reply) => {
    try {
      return createEnvelope({
        result: await getCellsInRange(
          request.params.id,
          {
            minRow: readIntegerQuery(request.query.minRow, "minRow"),
            maxRow: readIntegerQuery(request.query.maxRow, "maxRow"),
            minCol: readIntegerQuery(request.query.minCol, "minCol"),
            maxCol: readIntegerQuery(request.query.maxCol, "maxCol")
          },
          { includeUndesigned: readBooleanQuery(request.query.includeUndesigned, true) }
        )
      });
    } catch (error) {
      return sendError(reply, "cells_range_failed", error);
    }
  });

  app.post<{ Body: { name: string; description?: string; id?: string } }>("/api/maps", async (request, reply) => {
    try {
      const body = assertRecord(request.body, "request body is required");
      return createEnvelope({
        result: await createMap({
          name: readStringField(body, "name")!,
          description: readStringField(body, "description", false),
          id: readStringField(body, "id", false)
        })
      });
    } catch (error) {
      return sendError(reply, "create_failed", error);
    }
  });

  app.put<{ Params: { id: string }; Body: { document: Awaited<ReturnType<typeof getMap>>["document"]; expectedRevision: number } }>(
    "/api/maps/:id",
    async (request, reply) => {
      try {
        const body = assertRecord(request.body, "request body is required");
        const document = body.document as Awaited<ReturnType<typeof getMap>>["document"];
        const expectedRevision = body.expectedRevision;
        if (!document || typeof document !== "object") {
          throw badRequest("document is required");
        }
        if (!Number.isInteger(expectedRevision)) {
          throw badRequest("expectedRevision must be an integer");
        }
        if (!document.meta || typeof document.meta !== "object" || request.params.id !== document.meta.id) {
          throw badRequest("path id and document.meta.id must match");
        }
        return createEnvelope({
          result: await saveMap({
            document,
            expectedRevision: expectedRevision as number
          })
        });
      } catch (error) {
        return sendError(reply, "save_failed", error, 409);
      }
    }
  );

  app.post<{ Params: { id: string } }>("/api/maps/:id/duplicate", async (request, reply) => {
    try {
      return createEnvelope({ result: await duplicateMap(request.params.id) });
    } catch (error) {
      return sendError(reply, "duplicate_failed", error);
    }
  });

  app.post<{
    Params: { id: string };
    Body: { document?: Awaited<ReturnType<typeof getMap>>["document"]; name: string; id?: string };
  }>("/api/maps/:id/save-as", async (request, reply) => {
    try {
      const body = assertRecord(request.body, "request body is required");
      const document = body.document as Awaited<ReturnType<typeof getMap>>["document"] | undefined;
      if (document !== undefined && (!document.meta || typeof document.meta !== "object" || request.params.id !== document.meta.id)) {
        throw badRequest("path id and document.meta.id must match");
      }
      return createEnvelope({
        result: await saveMapAs({
          document,
          sourceId: document ? undefined : request.params.id,
          name: readStringField(body, "name")!,
          id: readStringField(body, "id", false)
        })
      });
    } catch (error) {
      return sendError(reply, "save_as_failed", error);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { expectedRevision: number; name?: string; description?: string; tags?: string[] };
  }>("/api/maps/:id/meta", async (request, reply) => {
    try {
      const body = assertRecord(request.body, "request body is required");
      const expectedRevision = body.expectedRevision;
      if (!Number.isInteger(expectedRevision)) {
        throw badRequest("expectedRevision must be an integer");
      }
      const tags = body.tags;
      if (tags !== undefined && (!Array.isArray(tags) || tags.some((entry) => typeof entry !== "string"))) {
        throw badRequest("tags must be an array of strings");
      }
      return createEnvelope({
        result: await updateMapMeta({
          id: request.params.id,
          expectedRevision: expectedRevision as number,
          name: readStringField(body, "name", false),
          description: readStringField(body, "description", false),
          tags: tags as string[] | undefined
        })
      });
    } catch (error) {
      return sendError(reply, "meta_update_failed", error, 409);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/maps/:id", async (request, reply) => {
    try {
      await deleteMap(request.params.id);
      return createEnvelope({ result: { deleted: true } });
    } catch (error) {
      return sendError(reply, "delete_failed", error, 404);
    }
  });

  app.post<{ Querystring: { includeMap?: string }; Body: { content: string; generateNewId?: boolean } }>(
    "/api/maps/import",
    async (request, reply) => {
    try {
      const body = assertRecord(request.body, "request body is required");
      const content = readStringField(body, "content")!;
      const includeMap = readIncludeMapQuery(request.query.includeMap);
      if (body.generateNewId !== undefined && typeof body.generateNewId !== "boolean") {
        throw badRequest("generateNewId must be a boolean");
      }
      const result = await importMap({
        content,
        generateNewId: body.generateNewId as boolean | undefined,
        includeMap
      });
      return createEnvelope({ result: includeMap ? result.map : { summary: result.summary }, warnings: result.warnings });
    } catch (error) {
      return sendError(reply, "import_failed", error);
    }
    }
  );

  app.post<{ Params: { id: string } }>("/api/maps/:id/export-json", async (request, reply) => {
    try {
      const result = await exportJson(request.params.id);
      return createEnvelope({
        result: {
          ...result,
          downloadUrl: `/api/exports/${encodeURIComponent(result.fileName)}`
        }
      });
    } catch (error) {
      return sendError(reply, "export_json_failed", error);
    }
  });

  app.get<{ Params: { fileName: string } }>("/api/exports/:fileName", async (request, reply) => {
    try {
      const fileName = assertExportDownloadFileName(request.params.fileName);
      const content = await fs.readFile(exportFilePath(EXPORT_STORAGE_DIR, fileName));
      reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
      reply.type(fileName.endsWith(".png") ? "image/png" : "application/json; charset=utf-8");
      return reply.send(content);
    } catch (error) {
      return sendError(reply, "export_not_found", error, 404);
    }
  });

  app.post<{ Params: { id: string }; Body: Partial<ExportRenderOptions> }>("/api/maps/:id/export-png", async (request, reply) => {
    try {
      const body = request.body === undefined ? {} : assertRecord(request.body, "request body must be an object");
      const result = await exportPng(request.params.id, normalizeExportOptions(body as Partial<ExportRenderOptions>));
      return createEnvelope({
        result: {
          ...result,
          downloadUrl: `/api/exports/${encodeURIComponent(result.fileName)}`
        }
      });
    } catch (error) {
      return sendError(reply, "export_png_failed", error);
    }
  });

  app.post<{ Params: { id: string }; Querystring: { includeMap?: string }; Body: { commands: MapCommand[] } }>("/api/maps/:id/apply", async (request, reply) => {
    try {
      return await applyCommandRequest(request.params.id, request.body, false, readIncludeMapQuery(request.query.includeMap));
    } catch (error) {
      return sendError(reply, "apply_failed", error);
    }
  });

  app.post<{ Params: { id: string }; Querystring: { includeMap?: string }; Body: { commands: MapCommand[] } }>("/api/maps/:id/commands", async (request, reply) => {
    try {
      return await applyCommandRequest(request.params.id, request.body, false, readIncludeMapQuery(request.query.includeMap));
    } catch (error) {
      return sendError(reply, "commands_failed", error);
    }
  });

  app.post<{ Params: { id: string }; Querystring: { includeMap?: string }; Body: { commands: MapCommand[] } }>(
    "/api/maps/:id/commands/dry-run",
    async (request, reply) => {
      try {
        return await applyCommandRequest(request.params.id, request.body, true, readIncludeMapQuery(request.query.includeMap));
      } catch (error) {
        return sendError(reply, "commands_dry_run_failed", error);
      }
    }
  );

  app.get<{ Params: { id: string } }>("/api/maps/:id/history-status", async (request, reply) => {
    try {
      return createEnvelope({ result: await getHistoryStatus(request.params.id) });
    } catch (error) {
      return sendError(reply, "history_status_failed", error, 404);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/maps/:id/history", async (request, reply) => {
    try {
      const limit = request.query.limit === undefined ? undefined : readIntegerQuery(request.query.limit, "limit");
      return createEnvelope({ result: await getMapHistory(request.params.id, limit) });
    } catch (error) {
      return sendError(reply, "history_failed", error, 404);
    }
  });

  app.post<{ Params: { id: string }; Querystring: { includeMap?: string } }>("/api/maps/:id/undo", async (request, reply) => {
    try {
      const includeMap = readIncludeMapQuery(request.query.includeMap);
      return includeMap
        ? historyMoveResponse(await undoMap(request.params.id), includeMap)
        : lightHistoryMoveResponse(await undoMapLight(request.params.id));
    } catch (error) {
      return sendError(reply, "undo_failed", error);
    }
  });

  app.post<{ Params: { id: string }; Querystring: { includeMap?: string } }>("/api/maps/:id/redo", async (request, reply) => {
    try {
      const includeMap = readIncludeMapQuery(request.query.includeMap);
      return includeMap
        ? historyMoveResponse(await redoMap(request.params.id), includeMap)
        : lightHistoryMoveResponse(await redoMapLight(request.params.id));
    } catch (error) {
      return sendError(reply, "redo_failed", error);
    }
  });

  if (hasWebBuild) {
    app.get("/", async (_request, reply) => sendWebIndex(webIndexPath, reply));

    app.get("/*", async (request, reply) => {
      const pathname = request.url.split("?")[0] ?? "/";
      if (pathname === "/" || pathname.startsWith("/api/") || pathname.startsWith("/assets/")) {
        return reply.callNotFound();
      }
      if (path.extname(pathname)) {
        return reply.callNotFound();
      }
      return sendWebIndex(webIndexPath, reply);
    });
  } else {
    app.get("/", async (_request, reply) => {
      reply.status(503);
      return {
        ok: false,
        result: null,
        warnings: [],
        errors: [
          {
            code: "web_build_missing",
            message: "web build not found; run pnpm build before starting the production server",
            severity: "invalid"
          }
        ]
      };
    });
  }

  return app;
}
