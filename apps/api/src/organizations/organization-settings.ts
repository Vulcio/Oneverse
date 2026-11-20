import { prisma } from "@oneverse/db";
import { ORGANIZATION_MODES, type OrganizationMode, type SaveOrganizationSettingsRequest } from "@oneverse/core";

const SINGLETON_ID = "singleton";

export type OrganizationSettingSource = "database" | "env" | "default";

export interface EffectiveOrganizationSettings {
  /** None (Songverse alone), one (everyone in it) or several (issue #241). */
  mode: OrganizationMode;
  /** With several: anyone may create one, not only global admins. */
  anyoneCreates: boolean;
  /** Organisations may keep their teams' files in their own bucket (issue #206). */
  ownStorage: boolean;
  /** With anyone creating: each is a request a global admin reviews (issue #364). */
  reviewRequests: boolean;
  /** Addresses suggested as they're typed and looked up when a request is sent (issue #533). */
  addressLookup: boolean;
  /** The Photon server asked for addresses outside France (OpenStreetMap; komoot's public one, or your own). */
  photonUrl: string;
  /** French addresses from the Base Adresse Nationale, through IGN's Géoplateforme. */
  addressLookupFrance: boolean;
}

type Key = keyof EffectiveOrganizationSettings;

const flag = (raw: string) => (raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : undefined);

const FIELDS: { [K in Key]: { env: string; parse: (raw: string) => EffectiveOrganizationSettings[K] | undefined; fallback: EffectiveOrganizationSettings[K] } } = {
  mode: { env: "ORGANIZATION_MODE", parse: (raw) => ORGANIZATION_MODES.find((mode) => mode === raw.trim().toUpperCase()), fallback: "NONE" },
  anyoneCreates: { env: "ORGANIZATIONS_OPEN", parse: flag, fallback: false },
  ownStorage: { env: "ORGANIZATIONS_OWN_STORAGE", parse: flag, fallback: false },
  reviewRequests: { env: "ORGANIZATIONS_REVIEWED", parse: flag, fallback: true },
  addressLookup: { env: "ADDRESS_LOOKUP", parse: flag, fallback: false },
  photonUrl: { env: "PHOTON_URL", parse: (raw) => (/^https?:\/\/\S+$/.test(raw.trim()) ? raw.trim().replace(/\/+$/, "") : undefined), fallback: "https://photon.komoot.io" },
  addressLookupFrance: { env: "ADDRESS_LOOKUP_FRANCE", parse: flag, fallback: true },
};

const KEYS = Object.keys(FIELDS) as Key[];

function resolve<K extends Key>(key: K, stored: EffectiveOrganizationSettings[K] | null | undefined): { value: EffectiveOrganizationSettings[K]; source: OrganizationSettingSource } {
  if (stored !== null && stored !== undefined) return { value: stored, source: "database" };
  const raw = process.env[FIELDS[key].env];
  const parsed = raw === undefined ? undefined : FIELDS[key].parse(raw);
  if (parsed !== undefined) return { value: parsed, source: "env" };
  return { value: FIELDS[key].fallback, source: "default" };
}

async function row() {
  const stored = await prisma.organizationSettings.findUnique({ where: { id: SINGLETON_ID } });
  return {
    mode: (ORGANIZATION_MODES as readonly string[]).includes(stored?.mode ?? "") ? (stored!.mode as OrganizationMode) : null,
    anyoneCreates: stored?.anyoneCreates ?? null,
    ownStorage: stored?.ownStorage ?? null,
    reviewRequests: stored?.reviewRequests ?? null,
    addressLookup: stored?.addressLookup ?? null,
    photonUrl: stored?.photonUrl ? stored.photonUrl.replace(/\/+$/, "") : null,
    addressLookupFrance: stored?.addressLookupFrance ?? null,
    exists: !!stored,
  };
}

/**
 * Whether the instance has organisations (issue #241): Admin >
 * Organisations' row, then the env var, then the default (none). Resolved
 * fresh on each use (CLAUDE.md): the API's instances share no memory.
 */
export async function getEffectiveOrganizationSettings(): Promise<EffectiveOrganizationSettings> {
  const stored = await row();
  return Object.fromEntries(KEYS.map((key) => [key, resolve(key, stored[key]).value])) as unknown as EffectiveOrganizationSettings;
}

/** For Admin > Organisations: each setting's value and where it comes from. */
export async function getOrganizationSettingsSummary() {
  const stored = await row();
  const settings = Object.fromEntries(KEYS.map((key) => [key, { ...resolve(key, stored[key]), env: FIELDS[key].env }])) as {
    [K in Key]: { value: EffectiveOrganizationSettings[K]; source: OrganizationSettingSource; env: string };
  };
  const sources = Object.values(settings).map((setting) => setting.source);
  return { source: (stored.exists && sources.includes("database") ? "database" : sources.includes("env") ? "env" : "none") as "database" | "env" | "none", settings };
}

/** Saves what's given: left out keeps its value, null clears it (back to the env var or default). */
export async function saveOrganizationSettings(input: SaveOrganizationSettingsRequest): Promise<void> {
  // An empty address clears it, like null.
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, value === "" ? null : value]));
  await prisma.organizationSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
}

/** Back to the environment variables. */
export async function clearOrganizationSettings(): Promise<void> {
  await prisma.organizationSettings.deleteMany({ where: { id: SINGLETON_ID } });
}
