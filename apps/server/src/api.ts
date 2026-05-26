import fs from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { ExportRenderOptions, MapCommand } from "@mapdesigner/map-core";
import { EXPORT_STORAGE_DIR, SERVER_PORT, WEB_DIST_DIR } from "./config.js";
import {
  applyCommands,
  canUndo,
  createMap,
  deleteMap,
  duplicateMap,
  executeSingleCommand,
  exportJson,
  exportPng,
  getCellsInRange,
  getMap,
  importMap,
  listMaps,
  mergeMap,
  saveMapAs,
  saveMap,
  undoMap
} from "./service.js";
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

function assertExportFileName(fileName: string): string {
  const normalized = fileName.trim();
  if (!normalized || normalized !== path.basename(normalized) || !normalized.endsWith(".png")) {
    throw new Error("invalid export file name");
  }
  return normalized;
}

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2147483648 });
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
      reply.status(404);
      return createEnvelope({
        errors: [{ code: "map_not_found", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Body: { name: string; description?: string; id?: string; layout?: string } }>("/api/maps", async (request, reply) => {
    try {
      const layout = request.body.layout === "square" ? "square" as const : undefined;
      return createEnvelope({ result: await createMap({ ...request.body, layout }) });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "create_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.put<{ Params: { id: string }; Body: { document: Awaited<ReturnType<typeof getMap>>["document"]; expectedRevision: number } }>(
    "/api/maps/:id",
    async (request, reply) => {
      try {
        if (request.params.id !== request.body.document.meta.id) {
          reply.status(400);
          return createEnvelope({
            errors: [{ code: "id_mismatch", message: "path id and document.meta.id must match", severity: "invalid" }]
          });
        }
        return createEnvelope({
          result: await saveMap({
            document: request.body.document,
            expectedRevision: request.body.expectedRevision
          })
        });
      } catch (error) {
        reply.status(409);
        return createEnvelope({
          errors: [{ code: "save_failed", message: (error as Error).message, severity: "invalid" }]
        });
      }
    }
  );

  app.post<{ Params: { id: string } }>("/api/maps/:id/duplicate", async (request, reply) => {
    try {
      return createEnvelope({ result: await duplicateMap(request.params.id) });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "duplicate_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  // Merge source map into target map with offset
  app.post<{
    Params: { id: string };
    Body: { sourceMapId: string; rowOffset: number; colOffset: number };
  }>("/api/maps/:id/merge", async (request, reply) => {
    try {
      const result = await mergeMap(
        request.params.id,
        request.body.sourceMapId,
        request.body.rowOffset,
        request.body.colOffset
      );
      return createEnvelope({ result });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "merge_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { document: Awaited<ReturnType<typeof getMap>>["document"]; name: string; id?: string };
  }>("/api/maps/:id/save-as", async (request, reply) => {
    try {
      if (request.params.id !== request.body.document.meta.id) {
        reply.status(400);
        return createEnvelope({
          errors: [{ code: "id_mismatch", message: "path id and document.meta.id must match", severity: "invalid" }]
        });
      }
      return createEnvelope({
        result: await saveMapAs({
          document: request.body.document,
          name: request.body.name,
          id: request.body.id
        })
      });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "save_as_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/maps/:id", async (request, reply) => {
    try {
      await deleteMap(request.params.id);
      return createEnvelope({ result: { deleted: true } });
    } catch (error) {
      reply.status(404);
      return createEnvelope({
        errors: [{ code: "delete_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Body: { content: string; generateNewId?: boolean } }>("/api/maps/import", async (request, reply) => {
    try {
      const result = await importMap(request.body);
      return createEnvelope({ result: result.map, warnings: result.warnings });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "import_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Params: { id: string } }>("/api/maps/:id/export-json", async (request, reply) => {
    try {
      return createEnvelope({ result: await exportJson(request.params.id) });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "export_json_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.get<{ Params: { fileName: string } }>("/api/exports/:fileName", async (request, reply) => {
    try {
      const fileName = assertExportFileName(request.params.fileName);
      const content = await fs.readFile(path.join(EXPORT_STORAGE_DIR, fileName));
      reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
      reply.type("image/png");
      return reply.send(content);
    } catch (error) {
      reply.status(404);
      return createEnvelope({
        errors: [{ code: "export_not_found", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Params: { id: string }; Body: Partial<ExportRenderOptions> }>("/api/maps/:id/export-png", async (request, reply) => {
    try {
      const result = await exportPng(request.params.id, request.body ?? {});
      return createEnvelope({
        result: {
          ...result,
          downloadUrl: `/api/exports/${encodeURIComponent(result.fileName)}`
        }
      });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "export_png_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  app.post<{ Params: { id: string }; Body: { commands: MapCommand[] } }>("/api/maps/:id/apply", async (request, reply) => {
    try {
      const result = await applyCommands(request.params.id, request.body.commands);
      return createEnvelope({ result: result.map, warnings: result.warnings });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "apply_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  // NEW: Range query — fetch cells visible in a viewport rectangle
  app.get<{
    Params: { id: string };
    Querystring: { minRow: string; maxRow: string; minCol: string; maxCol: string; includeUndesigned?: string };
  }>("/api/maps/:id/cells", async (request, reply) => {
    try {
      const { minRow, maxRow, minCol, maxCol, includeUndesigned } = request.query;
      const cells = await getCellsInRange(request.params.id, {
        minRow: Number(minRow),
        maxRow: Number(maxRow),
        minCol: Number(minCol),
        maxCol: Number(maxCol)
      }, { includeUndesigned: includeUndesigned !== "false" });
      return createEnvelope({ result: { cells } });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "cells_query_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  // NEW: Execute a single command (for WebUI editing)
  app.post<{ Params: { id: string }; Body: { command: MapCommand } }>("/api/maps/:id/command", async (request, reply) => {
    try {
      const result = await executeSingleCommand(request.params.id, request.body.command);
      return createEnvelope({ result: { state: result.state, changed: result.changed, warnings: result.warnings } });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "command_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  // NEW: Undo last command
  app.post<{ Params: { id: string } }>("/api/maps/:id/undo", async (request, reply) => {
    try {
      const result = await undoMap(request.params.id);
      return createEnvelope({ result });
    } catch (error) {
      reply.status(400);
      return createEnvelope({
        errors: [{ code: "undo_failed", message: (error as Error).message, severity: "invalid" }]
      });
    }
  });

  // NEW: Check undo availability
  app.get<{ Params: { id: string } }>("/api/maps/:id/undo-status", async (request, reply) => {
    try {
      const available = await canUndo(request.params.id);
      return createEnvelope({ result: { canUndo: available } });
    } catch {
      return createEnvelope({ result: { canUndo: false } });
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
