import { prisma } from "@oneverse/db";
import { planiverseUrl, screenUrl, songverseUrl } from "../common/utils/web-apps.js";

/**
 * Sign in with Oneverse (issue #303, docs/sign-in-with-oneverse.md): the
 * API is an OAuth 2.1 / OpenID Connect provider, and the web apps are its
 * clients. They're public clients - no secret to copy between the API's and
 * the apps' settings, PKCE required - and the API's own, so nobody is asked
 * "allow Songverse?".
 */
export const OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"];

/**
 * The API as an OAuth resource: what an app asks a token for (`resource`),
 * and the access token's audience. The API's own address, which is also the
 * audience of the tokens BetterAuth's /token gives, so JwtAuthGuard takes both.
 */
export function apiResource(): string {
  return new URL(process.env.AUTH_URL ?? "http://localhost:3001").origin;
}

export interface OAuthAppClient {
  clientId: string;
  name: string;
  /** The app's address, where it's sent back after signing out. */
  uri: string;
  /** `<app>/auth/callback`, the only address a code is sent to. */
  redirectUri: string;
}

/** The web apps that sign in through Oneverse: Songverse, and Planiverse and the screen app's console (issue #305) when they're deployed. */
export function oauthAppClients(): OAuthAppClient[] {
  const planiverse = planiverseUrl();
  const screen = screenUrl();
  return [
    { clientId: "songverse", name: "Songverse", uri: songverseUrl() },
    ...(planiverse ? [{ clientId: "planiverse", name: "Planiverse", uri: planiverse }] : []),
    ...(screen ? [{ clientId: "screen", name: "Oneverse screen", uri: screen }] : []),
  ].map((client) => ({ ...client, redirectUri: `${client.uri}/auth/callback` }));
}

/**
 * Writes the apps' clients from WEB_URL, PLANIVERSE_URL and SCREEN_URL, when the API
 * starts: an address that changed is the clients' new one at the next start.
 * A client whose app is no longer deployed is turned off, not deleted (its
 * tokens are refused).
 */
export async function registerOAuthClients(): Promise<void> {
  const clients = oauthAppClients();
  for (const client of clients) {
    const fields = {
      name: client.name,
      uri: client.uri,
      redirectUris: [client.redirectUri],
      postLogoutRedirectUris: [client.uri],
      disabled: false,
      skipConsent: true,
      enableEndSession: true,
      requirePKCE: true,
      tokenEndpointAuthMethod: "none",
      applicationType: "web",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      scopes: OAUTH_SCOPES,
    };
    await prisma.oauthClient.upsert({ where: { clientId: client.clientId }, create: { clientId: client.clientId, ...fields }, update: fields });
  }
  await prisma.oauthClient.updateMany({
    where: { clientId: { in: ["songverse", "planiverse", "screen"], notIn: clients.map((client) => client.clientId) } },
    data: { disabled: true },
  });
}
