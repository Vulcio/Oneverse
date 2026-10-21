import { prisma } from "@oneverse/db";
import { ORGANIZATION_MODES, type OrganizationMode, type SaveOrganizationSettingsRequest } from "@oneverse/core";

const SINGLETON_ID = "singleton";

export type OrganizationSettingSource = "database" | "env" | "default";

export interface EffectiveOrganizationSettings {
  /** None (Songverse alone), one (everyone in it) or several (issue #241). */
  mode: OrganizationMode;
  /** With several: anyone may create one, not only global admins. */
  anyoneCreates: boolean;
}

type Key = keyof EffectiveOrganizationSettings;

const FIELDS: { [K in Key]: { env: string; parse: (raw: string) => EffectiveOrganizationSettings[K] | undefined; fallback: EffectiveOrganizationSettings[K] } } = {
  mode: { env: "ORGANIZATION_MODE", parse: (raw) => ORGANIZATION_MODES.find((mode) => mode === raw.trim().toUpperCase()), fallback: "NONE" },
  anyoneCreates: { env: "ORGANIZATIONS_OPEN", parse: (raw) => (raw === "true" || raw === "1" ? true : raw === "false" || raw === "0" ? false : undefined), fallback: false },
};

function resolve<K extends Key>(key: K, stored: EffectiveOrganizationSettings[K] | null | undefined): { value: EffectiveOrganizationSettings[K]; source: OrganizationSettingSource } {
  if (stored !== null && stored !== undefined) return { value: stored, source: "database" };
  const raw = process.env[FIELDS[key].env];
  const parsed = raw === undefined ? undefined : FIELDS[key].parse(raw);
  if (parsed !== undefined) return { value: parsed, source: "env" };
  return { value: FIELDS[key].fallback, source: "default" };
}

async function row() {
  const stored = await prisma.organizationSettings.findUnique({ where: { id: SINGLETON_ID } });
  return { mode: (ORGANIZATION_MODES as readonly string[]).includes(stored?.mode ?? "") ? (stored!.mode as OrganizationMode) : null, anyoneCreates: stored?.anyoneCreates ?? null, exists: !!stored };
}

/**
 * Whether the instance has organisations (issue #241): Admin >
 * Organisations' row, then the env var, then the default (none). Resolved
 * fresh on each use (CLAUDE.md): the API's instances share no memory.
 */
export async function getEffectiveOrganizationSettings(): Promise<EffectiveOrganizationSettings> {
  const stored = await row();
  return { mode: resolve("mode", stored.mode).value, anyoneCreates: resolve("anyoneCreates", stored.anyoneCreates).value };
}

/** For Admin > Organisations: each setting's value and where it comes from. */
export async function getOrganizationSettingsSummary() {
  const stored = await row();
  const settings = {
    mode: { ...resolve("mode", stored.mode), env: FIELDS.mode.env },
    anyoneCreates: { ...resolve("anyoneCreates", stored.anyoneCreates), env: FIELDS.anyoneCreates.env },
  };
  const sources = Object.values(settings).map((setting) => setting.source);
  return { source: (stored.exists && sources.includes("database") ? "database" : sources.includes("env") ? "env" : "none") as "database" | "env" | "none", settings };
}

/** Saves what's given: left out keeps its value, null clears it (back to the env var or default). */
export async function saveOrganizationSettings(input: SaveOrganizationSettingsRequest): Promise<void> {
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  await prisma.organizationSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
}

/** Back to the environment variables. */
export async function clearOrganizationSettings(): Promise<void> {
  await prisma.organizationSettings.deleteMany({ where: { id: SINGLETON_ID } });
}
