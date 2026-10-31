import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which Oneverse this is (issue #164). One version for the whole product: the
 * root package.json's, which is the release being prepared. An image built for
 * a release (.github/workflows/release.yml) is given it exactly, with its commit
 * (ONEVERSE_VERSION, ONEVERSE_COMMIT); any other build reports it as `-dev`,
 * which SemVer orders before the release itself.
 */
export interface ServerVersion {
  version: string;
  /** The commit it was built from, when the build was told (a release image is). */
  commit: string | null;
}

let cached: ServerVersion | undefined;

/** The workspace's package.json, found upward from this file (src/ or dist/, in the repo or the image). */
function workspaceVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const file = join(dir, "package.json");
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "oneverse" && pkg.version) return pkg.version;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "0.0.0";
}

export function resolveVersion(env: NodeJS.ProcessEnv, workspace: () => string): ServerVersion {
  const release = env.ONEVERSE_VERSION?.trim().replace(/^v/, "");
  const commit = env.ONEVERSE_COMMIT?.trim() || null;
  return { version: release || `${workspace()}-dev`, commit: commit ? commit.slice(0, 12) : null };
}

export function serverVersion(): ServerVersion {
  cached ??= resolveVersion(process.env, workspaceVersion);
  return cached;
}
