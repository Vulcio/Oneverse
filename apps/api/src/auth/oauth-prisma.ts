import { Prisma, prisma } from "@oneverse/db";

/**
 * The OAuth provider's optional lists (a client's scopes, a token's
 * resources...): null means "any" to it and [] "none", and a Postgres list
 * can't be null, so they're Json columns (issue #303). BetterAuth's Prisma
 * adapter writes a list as it is, and null for one left out - which Prisma
 * refuses for a Json column unless it's spelled `Prisma.DbNull`.
 */
const OPTIONAL_LISTS: Record<string, readonly string[]> = {
  OauthClient: ["scopes", "clientCredentialsScopes", "contacts", "postLogoutRedirectUris", "grantTypes", "responseTypes"],
  OauthResource: ["allowedScopes"],
  OauthRefreshToken: ["resources", "requestedUserInfoClaims"],
  OauthAccessToken: ["resources", "requestedUserInfoClaims"],
  OauthConsent: ["resources", "requestedUserInfoClaims"],
};

function withDbNull(fields: readonly string[], data: unknown): unknown {
  if (Array.isArray(data)) return data.map((row) => withDbNull(fields, row));
  if (!data || typeof data !== "object") return data;
  const row = { ...(data as Record<string, unknown>) };
  for (const field of fields) if (row[field] === null) row[field] = Prisma.DbNull;
  return row;
}

/** The Prisma client BetterAuth is given: the shared one, null lists spelled for Json. */
export const authPrisma = prisma.$extends({
  query: {
    $allModels: {
      $allOperations({ model, args, query }) {
        const fields = OPTIONAL_LISTS[model];
        if (!fields || !args || typeof args !== "object") return query(args);
        const next = { ...(args as Record<string, unknown>) };
        for (const key of ["data", "create", "update"]) if (key in next) next[key] = withDbNull(fields, next[key]);
        return query(next as typeof args);
      },
    },
  },
});
