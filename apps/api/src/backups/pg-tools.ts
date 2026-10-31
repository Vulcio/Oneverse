import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

/** Where PostgreSQL's own packages put each major version's tools (Debian, Ubuntu, the API image). */
const PG_LIB = "/usr/lib/postgresql";

/**
 * The pg_dump or pg_restore that fits a server of this major version: the
 * same major if installed, else the lowest newer one (pg_dump refuses a server
 * newer than itself, and reads older ones), else whichever is on the PATH. The
 * image installs several (Dockerfile.api's POSTGRES_CLIENTS), so a server
 * upgraded from 16 to 18 keeps being backed up.
 */
export function pgToolFor(tool: "pg_dump" | "pg_restore", serverMajor: number | null, root = PG_LIB): string {
  let installed: number[] = [];
  try {
    installed = readdirSync(root)
      .map(Number)
      .filter((major) => Number.isInteger(major) && existsSync(join(root, String(major), "bin", tool)))
      .sort((a, b) => a - b);
  } catch {
    return tool;
  }
  if (installed.length === 0) return tool;
  const pick = serverMajor === null ? installed.at(-1)! : (installed.find((major) => major >= serverMajor) ?? installed.at(-1)!);
  return join(root, String(pick), "bin", tool);
}

/** server_version_num (180006) → 18. */
export function majorOf(versionNum: string | number | null | undefined): number | null {
  const value = Number(versionNum);
  return Number.isFinite(value) && value > 0 ? Math.floor(value / 10000) : null;
}
