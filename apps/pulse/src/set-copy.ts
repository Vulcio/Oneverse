import type { SetlistOfflineCopy } from "@oneverse/core";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** How often the copy is fetched again while the cloud's there (ms): a set changes between songs, not by the second. */
export const SET_COPY_EVERY_MS = 5 * 60_000;

/**
 * The set Pulse is on, kept on its disk (issue #247's offline copy): its
 * songs and texts as the screens show them, fetched while the cloud's there
 * with Pulse's own token (`GET /screens/current`, issue #320: the set put on
 * it, or the event's on now at its location) and served to the room when it
 * isn't. Notes are left out: everyone with a pass reads it.
 */
export class SetCopy {
  private copy: SetlistOfflineCopy | null = null;

  constructor(
    private readonly options: {
      apiUrl: string;
      /** Pulse's own token; null: not paired yet. */
      token: () => Promise<string | null>;
      /** Where it's kept; left out, only in memory. */
      dataDir?: string;
      fetch?: typeof fetch;
      log?: (line: string) => void;
    },
  ) {}

  /** The copy of `setId`, or null when Pulse has none of that set. */
  of(setId: string | null): SetlistOfflineCopy | null {
    return setId && this.copy?.set.id === setId ? this.copy : null;
  }

  get current(): SetlistOfflineCopy | null {
    return this.copy;
  }

  private get file(): string | null {
    return this.options.dataDir ? path.join(this.options.dataDir, "set.json") : null;
  }

  /** The copy kept from before a restart, if any. */
  async load() {
    const file = this.file;
    if (!file) return;
    try {
      this.copy = JSON.parse(await readFile(file, "utf8")) as SetlistOfflineCopy;
    } catch {
      // None yet.
    }
  }

  /** The set fetched again from the cloud; true when it changed. The copy kept stays when the cloud can't be reached. */
  async refresh(): Promise<boolean> {
    const token = await this.options.token();
    if (!token) return false;
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.options.apiUrl.replace(/\/$/, "")}/screens/current`, {
        headers: { authorization: `Screen ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        this.options.log?.(`set copy: the cloud answered ${response.status}`);
        return false;
      }
      const { set } = (await response.json()) as { set: SetlistOfflineCopy | null };
      // No set on it now: the copy it had stays, for the room (it's the last one it ran).
      if (!set) return false;
      const copy = { ...set, notes: {} };
      if (copy.version === this.copy?.version && copy.set.id === this.copy.set.id) return false;
      this.copy = copy;
      const file = this.file;
      if (file) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(copy));
        await rename(`${file}.tmp`, file);
      }
      this.options.log?.(`set copy: ${copy.set.id}, version ${copy.version}`);
      return true;
    } catch (err) {
      this.options.log?.(`set copy: ${String(err)}`);
      return false;
    }
  }
}
