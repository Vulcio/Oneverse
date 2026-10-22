import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

/**
 * Pulse's own page (issue #247): the operator's console built for it by the
 * screen app (`pnpm --filter @oneverse/screen-app build:pulse`, its
 * `dist/pulse`), served to the room's devices: `pulse.html` at `/`, and its
 * `assets/`. Nothing in the page is secret - what it shows comes from
 * GET /set and /sync, both behind a pass.
 */

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export class ConsolePage {
  constructor(private readonly dir: string) {}

  /** False when the request isn't the page's. */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    const pathname = new URL(request.url ?? "/", "http://pulse").pathname;
    if (pathname === "/") return this.send(response, "pulse.html", "text/html; charset=utf-8", "no-cache");
    const name = /^\/assets\/([A-Za-z0-9._-]+)$/.exec(pathname)?.[1];
    if (!name || name.startsWith(".")) return false;
    const type = TYPES[path.extname(name)];
    if (!type) return false;
    // Named by their content: kept as long as the browser wants.
    return this.send(response, path.join("assets", name), type, "public, max-age=31536000, immutable");
  }

  private async send(response: ServerResponse, file: string, type: string, cache: string): Promise<boolean> {
    let body: Buffer;
    try {
      body = await readFile(path.join(this.dir, file));
    } catch {
      response.writeHead(404, { "content-type": "text/plain" }).end("Pulse's page isn't built: pnpm --filter @oneverse/screen-app build:pulse");
      return true;
    }
    response.writeHead(200, { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff" }).end(body);
    return true;
  }
}
