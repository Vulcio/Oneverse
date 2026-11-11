import type { Request } from "express";
import { redis } from "../jobs/redis.js";
import { clientAddress } from "../security/rate-limit.guard.js";
import { getEffectiveSecuritySettings } from "../security/security-settings.js";

/**
 * The header BetterAuth reads the client's address from (its rate limits:
 * sign-in, sign-up, password resets). Set by the API itself on every
 * /api/auth request, replacing whatever the client sent, from the same
 * X-Forwarded-For rule as the API's own limits - Admin > Security's trusted
 * proxies. BetterAuth's default (X-Forwarded-For as it comes) gives up on a
 * header with more than one address, and then puts every visitor in one
 * shared bucket per path.
 */
export const CLIENT_ADDRESS_HEADER = "x-oneverse-client-address";

/** Sets CLIENT_ADDRESS_HEADER on an /api/auth request. */
export async function markClientAddress(req: Request): Promise<void> {
  const { trustedProxies } = await getEffectiveSecuritySettings();
  req.headers[CLIENT_ADDRESS_HEADER] = clientAddress(req, trustedProxies).replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
}

/**
 * BetterAuth's rate limit counts, in Redis (fixed windows), so they hold
 * across the API's instances and its restarts - BetterAuth's default keeps
 * them in each process's memory. Without Redis, nothing's limited, as with
 * the API's own limits (RateLimitGuard).
 */
export const authRateLimitStorage = {
  async consume(key: string, rule: { window: number; max: number }): Promise<{ allowed: boolean; retryAfter: number | null }> {
    const windowMs = Math.max(1, rule.window) * 1000;
    const slot = Math.floor(Date.now() / windowMs);
    const name = `songverse:auth-rl:${key}:${rule.window}:${slot}`;
    try {
      const count = await redis().incr(name);
      if (count === 1) await redis().pexpire(name, windowMs);
      if (count <= rule.max) return { allowed: true, retryAfter: null };
    } catch {
      return { allowed: true, retryAfter: null };
    }
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(((slot + 1) * windowMs - Date.now()) / 1000)) };
  },
};
