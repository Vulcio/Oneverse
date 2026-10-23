/** A pass this old (ms) is asked for again: well before it expires, while the cloud's still there. */
export const PULSE_PASS_RENEW_MS = 60 * 60 * 1000;
/** Not asked again sooner than this (ms): a session comes round often. */
const ASK_AGAIN_MS = 60 * 1000;

/**
 * The way to a set's Pulse for a device in it (issue #247, docs/live-session.md,
 * "How the room's devices reach Pulse"): while the cloud says a Pulse is in the
 * set (`pulse` on the session), the device asks for a pass, and asks again
 * every PULSE_PASS_RENEW_MS. Both are kept through an outage: `link` is Pulse's
 * page with the pass, for the "Continue on Pulse" link while the cloud's gone.
 * Songverse's sync client and the operator's live client both keep one.
 */
export class PulseDoor {
  private url: string | null = null;
  private pass: { value: string; expiresAt: number; at: number } | null = null;
  private asked = -Infinity;

  constructor(
    /** Asks the cloud for a pass (`{type: "pass"}`). */
    private readonly ask: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** A session from the cloud: the Pulse it names (none: the door's closed), and a pass asked for if one's due. */
  heard(pulse: string | null | undefined) {
    if (pulse === undefined) return;
    this.url = pulse;
    if (!pulse) return;
    const now = this.now();
    if (this.pass && now - this.pass.at < PULSE_PASS_RENEW_MS) return;
    if (now - this.asked < ASK_AGAIN_MS) return;
    this.asked = now;
    this.ask();
  }

  /** The cloud's answer. */
  passed(pass: string, expiresAt: number) {
    this.pass = { value: pass, expiresAt, at: this.now() };
  }

  /** Pulse's page with the pass, while both are known and the pass is good; else null. */
  get link(): string | null {
    if (!this.url || !this.pass || this.pass.expiresAt <= this.now()) return null;
    return `${this.url.replace(/\/$/, "")}/#pass=${encodeURIComponent(this.pass.value)}`;
  }

  /** Another set, or none. */
  clear() {
    this.url = null;
    this.pass = null;
    this.asked = -Infinity;
  }
}
