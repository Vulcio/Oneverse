import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { apiResource } from "./oauth-clients.js";

export interface BetterAuthJwtPayload extends JWTPayload {
  email?: string;
  isGlobalAdmin?: boolean;
}

/**
 * Verifies JWTs issued by BetterAuth's JWT plugin (mounted in this same
 * API - see auth/better-auth.ts and main.ts) against its published JWKS.
 * BetterAuth owns issuance; nothing else in this API mints tokens.
 *
 * The JWKS fetch itself goes over loopback (localhost:PORT) rather than
 * the public AUTH_URL, even though both now point at this same process -
 * calling your own public HTTPS URL from inside the container it's
 * served from is a common deployment footgun (no guaranteed route back to
 * yourself, TLS cert mismatches, etc.). The `iss` claim on the token is
 * still AUTH_URL (that's what BetterAuth was configured with as its own
 * baseURL), so verification still checks against the real public issuer.
 *
 * Two kinds of token pass (issue #303): BetterAuth's own (/api/auth/token,
 * for whoever has its session cookie), and the access tokens the OAuth
 * provider gives the apps that sign in through Oneverse. Both are signed
 * with the same keys, by the same issuer, for this API (`aud`) - an ID
 * token, whose audience is the app, isn't taken.
 */
@Injectable()
export class JwtVerifierService {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: ConfigService) {
    const port = this.config.get<string>("PORT") ?? "3001";
    this.jwks = createRemoteJWKSet(new URL(`http://localhost:${port}/api/auth/jwks`));
  }

  async verify(token: string): Promise<BetterAuthJwtPayload> {
    // Read here, not when created: the Worker, deployed without AUTH_URL,
    // creates this service too but never verifies a token (issue #96).
    const issuer = this.config.getOrThrow<string>("AUTH_URL");
    try {
      const { payload } = await jwtVerify<BetterAuthJwtPayload>(token, this.jwks, { issuer, audience: apiResource() });
      return payload;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
