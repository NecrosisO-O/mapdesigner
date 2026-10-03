import { validDownloadTicket } from "./downloads.js";
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SERVER_HOST, SERVER_PORT, API_TOKEN, ALLOWED_ORIGINS, LOOPBACK_HOSTS } from "./config.js";
import { createEnvelope } from "./utils.js";

export function allowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
      && [String(SERVER_PORT), "5173"].includes(url.port);
  } catch { return false; }
}

export function registerAccessGuard(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/") || request.url === "/api/health") return;
    const deny = (status: number, code: string, message: string) => reply.code(status).send(createEnvelope({
      errors: [{ code, message, severity: "invalid" }]
    }));
    let hostname: string;
    try { hostname = new URL("http://" + request.headers.host).hostname; }
    catch { return deny(403, "invalid_host", "invalid request host"); }
    if (LOOPBACK_HOSTS.has(SERVER_HOST) && !LOOPBACK_HOSTS.has(hostname)) {
      return deny(403, "invalid_host", "this local service only accepts loopback hosts");
    }
    const origin = request.headers.origin;
    let sameOrigin = false;
    try { sameOrigin = !!origin && new URL(origin).host === request.headers.host; } catch { /* Rejected below. */ }
    if (origin && !allowedOrigin(origin) && !(API_TOKEN && sameOrigin)) {
      return deny(403, "origin_not_allowed", "request origin is not allowed");
    }
    if (request.method === "OPTIONS") return;
    if (API_TOKEN && !(request.method === "GET" && validDownloadTicket(request.url))) {
      const received = Buffer.from(request.headers.authorization?.replace(/^Bearer /, "") ?? "");
      const expected = Buffer.from(API_TOKEN);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        return deny(401, "authentication_required", "enter the configured access token");
      }
    }
  });
}
