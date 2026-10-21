import { prisma } from "@oneverse/db";
import type { SaveCollaborationSettingsRequest } from "@oneverse/core";

const SINGLETON_ID = "singleton";
const ENV = "LIVE_CO_EDITING";

export type CollaborationSettingSource = "database" | "env" | "default";

/**
 * Live co-editing (issue #27): typing in the same song together. Admin >
 * Collaboration's row first, then LIVE_CO_EDITING, then off. Resolved fresh
 * on each use (CLAUDE.md): an admin's save holds on every API instance at once.
 */
function resolve(stored: boolean | null | undefined): { value: boolean; source: CollaborationSettingSource } {
  if (stored !== null && stored !== undefined) return { value: stored, source: "database" };
  const raw = process.env[ENV];
  if (raw === "true" || raw === "1") return { value: true, source: "env" };
  if (raw === "false" || raw === "0") return { value: false, source: "env" };
  return { value: false, source: "default" };
}

export async function liveCoEditingEnabled(): Promise<boolean> {
  const row = await prisma.collaborationSettings.findUnique({ where: { id: SINGLETON_ID } });
  return resolve(row?.liveCoEditing).value;
}

/** For Admin > Collaboration: the setting, and where it comes from. */
export async function getCollaborationSettingsSummary() {
  const row = await prisma.collaborationSettings.findUnique({ where: { id: SINGLETON_ID } });
  const liveCoEditing = { ...resolve(row?.liveCoEditing), env: ENV };
  return { source: liveCoEditing.source === "default" ? "none" : liveCoEditing.source, settings: { liveCoEditing } };
}

/** Left out keeps its value; null clears it (back to the env var or off). */
export async function saveCollaborationSettings(input: SaveCollaborationSettingsRequest): Promise<void> {
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  await prisma.collaborationSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
}

/** Back to the environment variable. */
export async function clearCollaborationSettings(): Promise<void> {
  await prisma.collaborationSettings.deleteMany({ where: { id: SINGLETON_ID } });
}
