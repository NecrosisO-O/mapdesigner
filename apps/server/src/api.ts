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
  createMap,
  deleteMap,
  duplicateMap,
  exportJson,
  exportPng,
  getMap,
  importMap,
  listMaps,
  saveMapAs,
  saveMap
} from "./service.js";
import { assertPngExportFileName, exportFilePath, normalizeExportOptions } from "./storage.js";
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
    Body: { document: Awaited<ReturnType<typeof getMap>>["document"]; name: string; id?: string };
  }>("/api/maps/:id/save-as", async (request, reply) => {
    try {
      const body = assertRecord(request.body, "request body is required");
      const document = body.document as Awaited<ReturnType<typeof getMap>>["document"];
      if (!document || typeof document !== "object") {
        throw badRequest("document is required");
      }
      if (!document.meta || typeof document.meta !== "object" || request.params.id !== document.meta.id) {
        throw badRequest("path id and document.meta.id must match");
      }
      return createEnvelope({
        result: await saveMapAs({
          document,
          name: readStringField(body, "name")!,
          id: readStringField(body, "id", false)
        })
      });
    } catch (error) {
      return sendError(reply, "save_as_failed", error);
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

  app.post<{ Body: { content: string; generateNewId?: boolean } }>("/api/maps/import", async (request, reply) => {
    try {
      const body = assertRecord(request.body, "request body is required");
      const content = readStringField(body, "content")!;
      if (body.generateNewId !== undefined && typeof body.generateNewId !== "boolean") {
        throw badRequest("generateNewId must be a boolean");
      }
      const result = await importMap({
        content,
        generateNewId: body.generateNewId as boolean | undefined
      });
      return createEnvelope({ result: result.map, warnings: result.warnings });
    } catch (error) {
      return sendError(reply, "import_failed", error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/maps/:id/export-json", async (request, reply) => {
    try {
      return createEnvelope({ result: await exportJson(request.params.id) });
    } catch (error) {
      return sendError(reply, "export_json_failed", error);
    }
  });

  app.get<{ Params: { fileName: string } }>("/api/exports/:fileName", async (request, reply) => {
    try {
      const fileName = assertPngExportFileName(request.params.fileName);
      const content = await fs.readFile(exportFilePath(EXPORT_STORAGE_DIR, fileName));
      reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
      reply.type("image/png");
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

  app.post<{ Params: { id: string }; Body: { commands: MapCommand[] } }>("/api/maps/:id/apply", async (request, reply) => {
    try {
      const body = assertRecord(request.body, "request body is required");
      if (!Array.isArray(body.commands)) {
        throw badRequest("commands must be an array");
      }
      const result = await applyCommands(request.params.id, body.commands as MapCommand[]);
      return createEnvelope({
        result: {
          map: result.map,
          dryRun: result.dryRun,
          warnings: result.warnings,
          stats: result.stats
        },
        warnings: result.warnings
      });
    } catch (error) {
      return sendError(reply, "apply_failed", error);
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
