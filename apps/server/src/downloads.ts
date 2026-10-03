import { randomBytes } from "node:crypto";
const tickets = new Map<string, { fileName: string; expires: number }>();
export function downloadUrl(fileName: string): string {
  for (const [key, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(key);
  while (tickets.size >= 128) tickets.delete(tickets.keys().next().value!);
  const token = randomBytes(24).toString("hex");
  tickets.set(token, { fileName, expires: Date.now() + 5 * 60_000 });
  return "/api/exports/" + encodeURIComponent(fileName) + "?ticket=" + token;
}
export function validDownloadTicket(url: string): boolean {
  const parsed = new URL(url, "http://localhost");
  const ticket = tickets.get(parsed.searchParams.get("ticket") ?? "");
  return (
    !!ticket &&
    ticket.expires > Date.now() &&
    parsed.pathname === "/api/exports/" + encodeURIComponent(ticket.fileName)
  );
}
