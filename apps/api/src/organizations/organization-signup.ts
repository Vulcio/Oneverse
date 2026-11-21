import { randomBytes } from "node:crypto";
import { prisma, type PrismaClient } from "@oneverse/db";
import { readPhone, type OrganizationLookalike, type OrganizationSignupRequest } from "@oneverse/core";
import { checkAddress } from "./address-lookup.js";

/** What a draft keeps: the request, its phone as +33612345678, and what the address lookup found. */
type SignupDraftData = OrganizationSignupRequest & { addressFound?: boolean | null; addressFoundAs?: string | null };

/** How long a request made before its account waits for that account: the pass's life (signup-gate.ts). */
const DRAFT_MS = 60 * 60 * 1000;

export interface LookalikeQuery {
  name: string;
  city: string;
  street?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/**
 * Organisations and waiting requests that look like this one (issues #364,
 * #533), compared as search compares names (accents, case and punctuation
 * aside, then pg_trgm):
 * - "same": nearly the same name (0.6) at the same address - same postal
 *   code and country, nearly the same street. Not asked for again.
 * - "close": a name near enough (0.45) in the same city (an organisation
 *   made before cities were asked has none: its name alone counts), or
 *   another name at the same address. Asked for only with a note.
 */
export async function findLookalikes(client: Pick<PrismaClient, "$queryRaw">, query: LookalikeQuery, exceptRequestId?: string): Promise<OrganizationLookalike[]> {
  const rows = await client.$queryRaw<{ source: "organization" | "request"; id: string; name: string; city: string | null; nameScore: number; sameAddress: boolean }[]>`
    WITH q AS (
      SELECT search_fold(${query.name}) AS name, search_fold(${query.city}) AS city,
             search_fold(${query.street ?? ""}) AS street,
             upper(replace(${query.postalCode ?? ""}, ' ', '')) AS postal,
             ${query.country ?? null}::text AS country
    ),
    candidates AS (
      SELECT 'organization' AS source, o.id, o.name, o.city, o.street, o."postalCode", o.country FROM "Organization" o
      UNION ALL
      SELECT 'request' AS source, r.id, r.name, r.city, r.street, r."postalCode", r.country FROM "OrganizationRequest" r
        WHERE r.status = 'PENDING' AND r.id <> ${exceptRequestId ?? ""}
    ),
    scored AS (
      SELECT c.source, c.id, c.name, c.city,
        similarity(search_fold(c.name), q.name)::float8 AS "nameScore",
        (c.city IS NULL OR similarity(search_fold(c.city), q.city) >= 0.6) AS "sameCity",
        (q.street <> '' AND c.street IS NOT NULL
          AND upper(replace(coalesce(c."postalCode", ''), ' ', '')) = q.postal
          AND (c.country IS NULL OR q.country IS NULL OR c.country = q.country)
          AND similarity(search_fold(c.street), q.street) >= 0.6) AS "sameAddress"
      FROM candidates c, q
    )
    SELECT source, id, name, city, "nameScore", "sameAddress" FROM scored
      WHERE ("nameScore" >= 0.45 AND "sameCity") OR "sameAddress"
      ORDER BY "sameAddress" DESC, "nameScore" DESC
      LIMIT 5`;
  return rows.map((row) => ({ source: row.source, id: row.id, name: row.name, city: row.city, match: row.sameAddress && row.nameScore >= 0.6 ? "same" : "close" }));
}

/** A request made at sign-up, kept for the account made next; its token goes in the pass. */
export async function keepSignupDraft(data: OrganizationSignupRequest): Promise<string> {
  const now = new Date();
  // Those nobody signed up with are gone after an hour.
  await prisma.organizationSignupDraft.deleteMany({ where: { expiresAt: { lt: now } } });
  const token = randomBytes(24).toString("base64url");
  const found = await checkAddress(data);
  const kept: SignupDraftData = { ...data, phone: readPhone(data.phone, data.country)?.e164 ?? data.phone, addressFound: found?.found ?? null, addressFoundAs: found?.as ?? null };
  await prisma.organizationSignupDraft.create({ data: { token, data: kept as object, expiresAt: new Date(now.getTime() + DRAFT_MS) } });
  return token;
}

/**
 * Once the account exists (BetterAuth's user-create hook): the request kept
 * for it becomes theirs, and they wait for its approval. Global admins are
 * told once the email is verified (OrganizationsService.myRequests), so a
 * mistyped address asks nobody.
 */
export async function takeSignupDraft(user: { id: string; email: string; name: string }, token: string): Promise<void> {
  const draft = await prisma.organizationSignupDraft.findUnique({ where: { token } });
  if (!draft || draft.expiresAt <= new Date()) return;
  const data = draft.data as unknown as SignupDraftData;
  await prisma.$transaction([
    prisma.organizationRequest.create({
      data: {
        requestedById: user.id,
        name: data.name,
        description: data.description ?? null,
        kind: data.kind,
        city: data.city,
        street: data.street,
        postalCode: data.postalCode ?? null,
        country: data.country,
        responsibleFirstName: data.responsibleFirstName,
        responsibleLastName: data.responsibleLastName,
        phone: data.phone ?? null,
        addressFound: data.addressFound ?? null,
        addressFoundAs: data.addressFoundAs ?? null,
        contactName: user.name || `${data.responsibleFirstName} ${data.responsibleLastName}`,
        contactEmail: user.email.toLowerCase(),
        website: data.website ?? null,
        peopleCount: data.peopleCount ?? null,
        duplicateNote: data.duplicateNote ?? null,
        looksLike: (await findLookalikes(prisma, data)) as unknown as object[],
        atSignup: true,
      },
    }),
    prisma.user.update({ where: { id: user.id }, data: { awaitingApprovalSince: new Date() } }),
    prisma.organizationSignupDraft.delete({ where: { id: draft.id } }),
  ]);
}

/**
 * Invitations always work (issue #533): someone waiting for their
 * organisation's approval who joins a team or an organisation by its invite
 * link is let in. Their request still waits, for a global admin to approve
 * or decline.
 */
export async function letInByInvitation(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId, awaitingApprovalSince: { not: null } }, data: { awaitingApprovalSince: null } });
}
