import { spawn } from "node:child_process";

/**
 * pg_dump and pg_restore take a libpq address: Prisma's own parameters
 * (`?schema=public`, `connection_limit`…) are dropped, or libpq refuses it.
 */
const PRISMA_ONLY = ["schema", "connection_limit", "pool_timeout", "pgbouncer", "statement_cache_size", "socket_timeout", "connect_timeout_prisma"];

export function libpqUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  for (const name of PRISMA_ONLY) url.searchParams.delete(name);
  return url.toString();
}

/** A tool's version line ("pg_dump (PostgreSQL) 16.4"), or null when it isn't installed. */
export function toolVersion(tool: "pg_dump" | "pg_restore"): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(tool, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : null));
  });
}

/** Runs a tool, its stderr kept for the error; resolves on exit 0. */
export function run(tool: string, args: string[], options: { stdout?: NodeJS.WritableStream } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, { stdio: ["ignore", options.stdout ? "pipe" : "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    if (options.stdout && child.stdout) child.stdout.pipe(options.stdout);
    child.on("error", (error: NodeJS.ErrnoException) => reject(error.code === "ENOENT" ? new Error(`${tool} isn't installed where the backups run (the API/Worker image has it)`) : error));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${tool} failed (exit ${code}): ${stderr.trim().split("\n").slice(-3).join(" ")}`))));
  });
}
