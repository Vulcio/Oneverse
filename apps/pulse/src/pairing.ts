import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** How often a code waiting to be confirmed asks for its token (ms). */
export const CLAIM_EVERY_MS = 2_000;

/**
 * Pulse paired like a screen (issue #320): with no token of its own yet, it
 * asks the cloud for a code as a Pulse and shows it (`code`: on /health and
 * in its log) until someone confirms it in Screens > Pair a screen, then
 * keeps the token it's given in its data folder. A code that expires is
 * replaced by a new one.
 */
export class Pairing {
  private token: string | null = null;
  private waiting: { code: string; expiresAt: string } | null = null;
  private stopped = false;

  constructor(
    private readonly options: {
      apiUrl: string;
      /** Where its token is kept; left out, only in memory. */
      dataDir?: string;
      /** A token given in its environment instead (PULSE_SCREEN_TOKEN). */
      given?: string;
      fetch?: typeof fetch;
      log?: (line: string) => void;
      wait?: (ms: number) => Promise<void>;
    },
  ) {}

  /** The code to show while it waits to be paired; null once it is. */
  get code(): { code: string; expiresAt: string } | null {
    return this.token ? null : this.waiting;
  }

  /** Its token: given, kept from before, or null while it isn't paired. */
  async current(): Promise<string | null> {
    if (this.token) return this.token;
    if (this.options.given) return (this.token = this.options.given);
    const file = this.file;
    if (file) {
      try {
        this.token = (await readFile(file, "utf8")).trim() || null;
      } catch {
        // Not paired yet.
      }
    }
    return this.token;
  }

  stop() {
    this.stopped = true;
  }

  /** Until it's paired: a code, shown, then its token asked for every couple of seconds. */
  async pair(): Promise<string | null> {
    const fetch_ = this.options.fetch ?? fetch;
    const wait = this.options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const api = this.options.apiUrl.replace(/\/$/, "");
    while (!this.stopped && !(await this.current())) {
      try {
        const started = await fetch_(`${api}/screens/pairings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "PULSE" }), signal: AbortSignal.timeout(30_000) });
        if (!started.ok) throw new Error(`the cloud answered ${started.status}`);
        const pairing = (await started.json()) as { pairingId: string; code: string; secret: string; expiresAt: string };
        this.waiting = { code: pairing.code, expiresAt: pairing.expiresAt };
        this.options.log?.(`pairing: show ${pairing.code} in Screens > Pair a screen (until ${pairing.expiresAt})`);
        while (!this.stopped) {
          await wait(CLAIM_EVERY_MS);
          const claim = await fetch_(`${api}/screens/pairings/${encodeURIComponent(pairing.pairingId)}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: pairing.secret }), signal: AbortSignal.timeout(30_000) });
          if (claim.status === 202) continue;
          // Expired: a new code.
          if (claim.status === 410) break;
          if (!claim.ok) throw new Error(`the cloud answered ${claim.status}`);
          const { token, screen } = (await claim.json()) as { token: string; screen: { name: string; kind?: string } };
          if (screen.kind !== "PULSE") this.options.log?.("pairing: paired as a screen, not a Pulse");
          await this.keep(token);
          this.options.log?.(`pairing: paired as "${screen.name}"`);
          break;
        }
      } catch (err) {
        this.options.log?.(`pairing: ${String(err)}`);
        await wait(10_000);
      }
    }
    this.waiting = null;
    return this.token;
  }

  private get file(): string | null {
    return this.options.dataDir ? path.join(this.options.dataDir, "token") : null;
  }

  private async keep(token: string) {
    this.token = token;
    const file = this.file;
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, token, { mode: 0o600 });
    await chmod(file, 0o600);
  }
}
