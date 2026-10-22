import type { SetlistOfflineCopy } from "@oneverse/core";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** How often the copy is fetched again while the cloud's there (ms): a set changes between songs, not by the second. */
export const SET_COPY_EVERY_MS = 5 * 60_000;

/**
 * The set Pulse runs, kept on its disk (issue #247's offline copy): its
 * songs and texts as the screens show them (the API's offline copy, `for
 * screens`), fetched while the cloud's there and served to the room when it
 * isn't. Notes are left out: Pulse fetches the copy as one person, and
 * everyone with a pass reads it.
 */
export class SetCopy {
  private copy: SetlistOfflineCopy | null = null;

  constructor(
    private readonly options: {
      apiUrl: string;
      setId: string;
      token: () => Promise<string | null>;
      /** Where it's kept; left out, only in memory. */
      dataDir?: string;
      fetch?: typeof fetch;
      log?: (line: string) => void;
    },
  ) {}

  get current(): SetlistOfflineCopy | null {
    return this.copy;
  }

  private get file(): string | null {
    return this.options.dataDir ? path.join(this.options.dataDir, `set-${this.options.setId.replace(/[^A-Za-z0-9_-]/g, "")}.json`) : null;
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
      const response = await (this.options.fetch ?? fetch)(`${this.options.apiUrl.replace(/\/$/, "")}/setlists/${encodeURIComponent(this.options.setId)}/offline?for=screens`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        this.options.log?.(`set copy: the cloud answered ${response.status}`);
        return false;
      }
      const copy = { ...((await response.json()) as SetlistOfflineCopy), notes: {} };
      if (copy.version === this.copy?.version) return false;
      this.copy = copy;
      const file = this.file;
      if (file) {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(copy));
        await rename(`${file}.tmp`, file);
      }
      this.options.log?.(`set copy: version ${copy.version}`);
      return true;
    } catch (err) {
      this.options.log?.(`set copy: ${String(err)}`);
      return false;
    }
  }
}
