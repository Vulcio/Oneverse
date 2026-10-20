import { prisma, type Prisma } from "@songverse/db";
import type { SaveSonicServerRequest } from "@songverse/core";
import { decryptSecret, encryptSecret } from "@songverse/secret-crypto";
import { randomBytes } from "node:crypto";
import { checkOutsideUrl, OutsideAddressError, type OutsideAddressRules } from "../security/outside-address.js";
import { getEffectiveStemSeparationSettings, type EffectiveStemSeparationSettings } from "./stem-separation-settings.js";

/**
 * Songverse Sonic servers (issue #300): a team or an organisation may run
 * its own and connect it, when Admin > Stem separation allows it. A song's
 * recordings are split on its team's server, else its team's
 * organisation's, else the instance's; each separation keeps which, so its
 * status, its stems and its webhooks are asked of and checked against that
 * one. Resolved fresh on every use, as the instance's settings are.
 */

export type SonicServerOwner = { kind: "team"; id: string } | { kind: "organization"; id: string };

export interface SeparationServer extends EffectiveStemSeparationSettings {
  /** A team's or an organisation's own server; null: the instance's. */
  id: string | null;
  owner: (SonicServerOwner & { name: string }) | null;
  /** Its calls held to the outside-address rules: every own server's. */
  guard: OutsideAddressRules | null;
}

function envBool(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : null;
}

/** Whether teams and organisations may connect their own servers, and on private or local addresses: Admin's, else STEM_SEPARATION_OWN_SERVERS(_PRIVATE), else no. */
export async function ownServersPolicy(): Promise<{ allowed: boolean; allowPrivate: boolean }> {
  const row = await prisma.stemSeparationSettings.findUnique({ where: { id: "singleton" }, select: { ownServers: true, ownServersPrivate: true } });
  return {
    allowed: row?.ownServers ?? envBool("STEM_SEPARATION_OWN_SERVERS") ?? false,
    allowPrivate: row?.ownServersPrivate ?? envBool("STEM_SEPARATION_OWN_SERVERS_PRIVATE") ?? false,
  };
}

type ServerRow = Prisma.SonicServerGetPayload<{ include: { team: { select: { name: true } }; organization: { select: { name: true } } } }>;
const WITH_OWNER = { team: { select: { name: true } }, organization: { select: { name: true } } } as const;

function fromRow(row: ServerRow, allowPrivate: boolean): SeparationServer {
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;
  return {
    id: row.id,
    owner: row.teamId ? { kind: "team", id: row.teamId, name: row.team?.name ?? "" } : { kind: "organization", id: row.organizationId!, name: row.organization?.name ?? "" },
    guard: { allowPrivate },
    apiUrl: row.apiUrl,
    apiKey: decryptSecret(row.apiKeyEnc, passphrase),
    callbackSecret: decryptSecret(row.callbackSecretEnc, passphrase),
    fastModel: row.fastModel ?? "htdemucs",
    hqModel: row.hqModel ?? "htdemucs_ft",
    hqEnabled: row.hqEnabled,
    monthlyLimit: row.monthlyLimit,
  };
}

async function instanceServer(): Promise<SeparationServer | null> {
  const settings = await getEffectiveStemSeparationSettings();
  return settings.apiUrl && settings.apiKey ? { ...settings, id: null, owner: null, guard: null } : null;
}

/** The server a song's recordings are split on: its team's, else its organisation's (when allowed), else the instance's; null for none. */
export async function serverForSong(songVersionId: string): Promise<SeparationServer | null> {
  const song = await prisma.songVersion.findUnique({ where: { id: songVersionId }, select: { ownerScope: true, ownerTeam: { select: { id: true, organizationId: true } } } });
  const team = song?.ownerScope === "TEAM" ? song.ownerTeam : null;
  if (team) {
    const policy = await ownServersPolicy();
    if (policy.allowed) {
      const own =
        (await prisma.sonicServer.findUnique({ where: { teamId: team.id }, include: WITH_OWNER })) ??
        (team.organizationId ? await prisma.sonicServer.findUnique({ where: { organizationId: team.organizationId }, include: WITH_OWNER }) : null);
      if (own) return fromRow(own, policy.allowPrivate);
    }
  }
  return instanceServer();
}

/** The server a separation went to; null when it was a team's or an organisation's that's since been removed (or the instance's, no longer set up). */
export async function serverOfSeparation(separation: { sonicServerId: string | null; ownServer: boolean }): Promise<SeparationServer | null> {
  if (!separation.ownServer) return instanceServer();
  if (!separation.sonicServerId) return null;
  const row = await prisma.sonicServer.findUnique({ where: { id: separation.sonicServerId }, include: WITH_OWNER });
  return row ? fromRow(row, (await ownServersPolicy()).allowPrivate) : null;
}

/** A server by its ID, for its webhooks: the instance's for null. */
export async function serverById(id: string | null): Promise<SeparationServer | null> {
  return serverOfSeparation({ sonicServerId: id, ownServer: id !== null });
}

const ownerWhere = (owner: SonicServerOwner) => (owner.kind === "team" ? { teamId: owner.id } : { organizationId: owner.id });

/** For its team's or organisation's admins: never the key, only that there is one. */
export async function sonicServerSummary(owner: SonicServerOwner) {
  const [row, policy] = await Promise.all([prisma.sonicServer.findUnique({ where: ownerWhere(owner) }), ownServersPolicy()]);
  return {
    /** Whether Admin lets teams and organisations connect their own, and on private addresses. */
    allowed: policy.allowed,
    allowPrivate: policy.allowPrivate,
    server: row
      ? { apiUrl: row.apiUrl, hasKey: true, fastModel: row.fastModel, hqModel: row.hqModel, hqEnabled: row.hqEnabled, monthlyLimit: row.monthlyLimit, updatedAt: row.updatedAt.toISOString() }
      : null,
  };
}

export class SonicServerInputError extends Error {}

/** Saves a team's or an organisation's server: the address and key the first time; then what's given (an empty key keeps it; null clears a model or the limit). */
export async function saveSonicServer(owner: SonicServerOwner, input: SaveSonicServerRequest): Promise<void> {
  const passphrase = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!passphrase) throw new SonicServerInputError("This server can't keep a key safely yet: its admin sets SETTINGS_ENCRYPTION_KEY");
  const existing = await prisma.sonicServer.findUnique({ where: ownerWhere(owner) });
  const data: Prisma.SonicServerUncheckedUpdateInput = {};
  if (input.apiUrl) {
    // Refused now rather than at its first job: the rules every call to it is held to.
    try {
      checkOutsideUrl(input.apiUrl, { allowPrivate: (await ownServersPolicy()).allowPrivate });
    } catch (error) {
      if (error instanceof OutsideAddressError) throw new SonicServerInputError(`apiUrl isn't allowed: ${error.message}`);
      throw error;
    }
    data.apiUrl = input.apiUrl.replace(/\/+$/, "");
  }
  if (input.apiKey) data.apiKeyEnc = encryptSecret(input.apiKey, passphrase);
  for (const key of ["fastModel", "hqModel", "monthlyLimit"] as const) if (input[key] !== undefined) data[key] = input[key];
  if (input.hqEnabled != null) data.hqEnabled = input.hqEnabled;
  if (existing) {
    await prisma.sonicServer.update({ where: { id: existing.id }, data });
    return;
  }
  if (!data.apiUrl || !data.apiKeyEnc) throw new SonicServerInputError("A Sonic server needs its address and its API key");
  await prisma.sonicServer.create({
    data: {
      ...(data as Prisma.SonicServerUncheckedCreateInput),
      ...ownerWhere(owner),
      // What its webhooks are signed with: its own, made now.
      callbackSecretEnc: encryptSecret(randomBytes(32).toString("base64url"), passphrase),
    },
  });
}

/** Disconnects it: what's being split there fails (nothing more can be asked of it), what was split stays. */
export async function removeSonicServer(owner: SonicServerOwner): Promise<void> {
  const row = await prisma.sonicServer.findUnique({ where: ownerWhere(owner), select: { id: true } });
  if (!row) return;
  await prisma.$transaction([
    prisma.stemSeparation.updateMany({ where: { sonicServerId: row.id, status: { in: ["QUEUED", "SUBMITTED", "FAST_READY"] } }, data: { status: "FAILED", error: "Its Sonic server was disconnected" } }),
    prisma.sonicServer.delete({ where: { id: row.id } }),
  ]);
}

/** Admin's list: every server connected, whose, and where (never a key). */
export async function listSonicServers() {
  const rows = await prisma.sonicServer.findMany({ include: { ...WITH_OWNER, _count: { select: { separations: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    owner: row.teamId ? { kind: "team" as const, id: row.teamId, name: row.team?.name ?? "" } : { kind: "organization" as const, id: row.organizationId!, name: row.organization?.name ?? "" },
    apiUrl: row.apiUrl,
    separations: row._count.separations,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
