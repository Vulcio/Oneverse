/**
 * The Song provider plugin's servers (issue #157): added in Admin >
 * Plugins, each asked for the hooks chosen there among those it says it
 * answers, its key encrypted with SETTINGS_ENCRYPTION_KEY and never sent
 * back. Read fresh on every use, so a change made through one API
 * instance is seen by the others and the Worker at once.
 */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SONG_PROVIDER_HOOKS, type SongProviderHook, type SongProviderSourceInput, type SongProviderSourceUpdate } from "@oneverse/core";
import { prisma, type SongProviderSource } from "@oneverse/db";
import { decryptSecret, encryptSecret } from "@oneverse/secret-crypto";
import { checkOutsideUrl, OutsideAddressError } from "../../security/outside-address.js";
import { pluginState, SONG_PROVIDER_PLUGIN } from "../built-in.js";
import { SongProviderError, songProviderCapabilities, type SongProviderEndpoint } from "./song-provider-client.js";

export interface SongProviderSourceSummary {
  id: string;
  name: string;
  apiUrl: string;
  /** Whether a key is saved; the key itself is never sent back. */
  hasApiKey: boolean;
  allowPrivate: boolean;
  hooks: SongProviderHook[];
  /** What it said it answers when last checked. */
  provides: SongProviderHook[];
  enabled: boolean;
  lastError: string | null;
  checkedAt: string | null;
}

export interface ActiveSongProvider extends SongProviderEndpoint {
  id: string;
}

const hooksOf = (values: string[]): SongProviderHook[] => SONG_PROVIDER_HOOKS.filter((hook) => values.includes(hook));

export function summarize(row: SongProviderSource): SongProviderSourceSummary {
  return {
    id: row.id,
    name: row.name,
    apiUrl: row.apiUrl,
    hasApiKey: !!row.apiKeyEnc,
    allowPrivate: row.allowPrivate,
    hooks: hooksOf(row.hooks),
    provides: hooksOf(row.provides),
    enabled: row.enabled,
    lastError: row.lastError,
    checkedAt: row.checkedAt?.toISOString() ?? null,
  };
}

function endpointOf(row: SongProviderSource): ActiveSongProvider {
  return { id: row.id, name: row.name, apiUrl: row.apiUrl, apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc, process.env.SETTINGS_ENCRYPTION_KEY) : null, allowPrivate: row.allowPrivate };
}

export const listSources = () => prisma.songProviderSource.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });

/** The servers asked for `hook`, in order: the plugin on, the server on, the hook chosen for it. */
export async function activeSources(hook: SongProviderHook): Promise<ActiveSongProvider[]> {
  if (!(await pluginState(SONG_PROVIDER_PLUGIN.id)).enabled) return [];
  return (await listSources()).filter((row) => row.enabled && row.hooks.includes(hook)).map(endpointOf);
}

/** Which hooks have a server to ask, for Admin > Metadata's "ready". */
export async function readyHooks(): Promise<Set<SongProviderHook>> {
  if (!(await pluginState(SONG_PROVIDER_PLUGIN.id)).enabled) return new Set();
  return new Set((await listSources()).filter((row) => row.enabled).flatMap((row) => hooksOf(row.hooks)));
}

export async function sourceById(id: string): Promise<ActiveSongProvider> {
  const row = await prisma.songProviderSource.findUnique({ where: { id } });
  if (!row) throw new NotFoundException("No such song provider");
  return endpointOf(row);
}

/** A server's failure kept for Admin to show, and cleared once it answers again; written only when it changes. */
export async function noteOutcome(id: string, error: string | null): Promise<void> {
  const where = error === null ? { id, lastError: { not: null } } : { id };
  await prisma.songProviderSource.updateMany({ where, data: { lastError: error } }).catch(() => undefined);
}

function checkAddress(apiUrl: string, allowPrivate: boolean) {
  try {
    checkOutsideUrl(apiUrl, { allowPrivate });
  } catch (error) {
    if (error instanceof OutsideAddressError) throw new BadRequestException([`apiUrl: ${error.message}`]);
    throw error;
  }
}

/** Its capabilities, asked now: a failure is the admin's to read, as a 400. */
async function ask(endpoint: SongProviderEndpoint) {
  try {
    return await songProviderCapabilities(endpoint);
  } catch (error) {
    if (error instanceof SongProviderError) throw new BadRequestException([`${endpoint.apiUrl} ${error.message.charAt(0).toLowerCase()}${error.message.slice(1)}`]);
    throw error;
  }
}

const encrypt = (key: string) => encryptSecret(key, process.env.SETTINGS_ENCRYPTION_KEY);

/** A server added: asked for its capabilities first, so only one that answers the API is kept. */
export async function createSource(input: SongProviderSourceInput & { apiUrl: string }): Promise<SongProviderSourceSummary> {
  const allowPrivate = input.allowPrivate ?? false;
  const apiUrl = input.apiUrl.trim().replace(/\/+$/, "");
  checkAddress(apiUrl, allowPrivate);
  const apiKey = input.apiKey?.trim() || null;
  const capabilities = await ask({ name: input.name ?? apiUrl, apiUrl, apiKey, allowPrivate });
  const provides = capabilities.provides;
  const hooks = (input.hooks ?? provides).filter((hook) => provides.includes(hook));
  const last = await prisma.songProviderSource.aggregate({ _max: { position: true } });
  const row = await prisma.songProviderSource.create({
    data: {
      name: input.name?.trim() || capabilities.name,
      apiUrl,
      apiKeyEnc: apiKey ? encrypt(apiKey) : null,
      allowPrivate,
      hooks,
      provides,
      enabled: input.enabled ?? true,
      position: (last._max.position ?? -1) + 1,
      checkedAt: new Date(),
    },
  });
  return summarize(row);
}

/** A change: a field left out keeps its value; an empty key clears it. A new address or key is asked again. */
export async function updateSource(id: string, input: SongProviderSourceUpdate): Promise<SongProviderSourceSummary> {
  const row = await prisma.songProviderSource.findUnique({ where: { id } });
  if (!row) throw new NotFoundException("No such song provider");
  const apiUrl = input.apiUrl !== undefined ? input.apiUrl.trim().replace(/\/+$/, "") : row.apiUrl;
  const allowPrivate = input.allowPrivate ?? row.allowPrivate;
  const keyChanged = input.apiKey !== undefined;
  const apiKey = keyChanged ? input.apiKey?.trim() || null : row.apiKeyEnc ? decryptSecret(row.apiKeyEnc, process.env.SETTINGS_ENCRYPTION_KEY) : null;
  let provides = hooksOf(row.provides);
  const reconnect = apiUrl !== row.apiUrl || allowPrivate !== row.allowPrivate || keyChanged;
  if (reconnect) {
    checkAddress(apiUrl, allowPrivate);
    provides = (await ask({ name: row.name, apiUrl, apiKey, allowPrivate })).provides;
  }
  const hooks = (input.hooks ?? hooksOf(row.hooks)).filter((hook) => provides.includes(hook));
  const updated = await prisma.songProviderSource.update({
    where: { id },
    data: {
      ...(input.name !== undefined && input.name?.trim() && { name: input.name.trim() }),
      apiUrl,
      allowPrivate,
      ...(keyChanged && { apiKeyEnc: apiKey ? encrypt(apiKey) : null }),
      hooks,
      provides,
      ...(typeof input.enabled === "boolean" && { enabled: input.enabled }),
      ...(reconnect && { checkedAt: new Date(), lastError: null }),
    },
  });
  return summarize(updated);
}

export async function deleteSource(id: string): Promise<void> {
  const { count } = await prisma.songProviderSource.deleteMany({ where: { id } });
  if (count === 0) throw new NotFoundException("No such song provider");
}

export async function reorderSources(ids: string[]): Promise<void> {
  await prisma.$transaction(ids.map((id, position) => prisma.songProviderSource.updateMany({ where: { id }, data: { position } })));
}

/** Test connection: its capabilities asked again, what it answers kept, the hooks it no longer answers dropped. */
export async function testSource(id: string): Promise<{ ok: boolean; message: string; source: SongProviderSourceSummary }> {
  const endpoint = await sourceById(id);
  try {
    const capabilities = await songProviderCapabilities(endpoint);
    const row = await prisma.songProviderSource.findUniqueOrThrow({ where: { id } });
    const updated = await prisma.songProviderSource.update({
      where: { id },
      data: { provides: capabilities.provides, hooks: hooksOf(row.hooks).filter((hook) => capabilities.provides.includes(hook)), checkedAt: new Date(), lastError: null },
    });
    return { ok: true, message: `${capabilities.name} answers: ${capabilities.provides.join(", ") || "nothing"}`, source: summarize(updated) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await prisma.songProviderSource.update({ where: { id }, data: { checkedAt: new Date(), lastError: message } });
    return { ok: false, message, source: summarize(updated) };
  }
}

/**
 * Whether the server may download an image from this address (issue #112):
 * one on the address of a server asked for artwork or artists' pictures,
 * under that server's own rules.
 */
export async function songProviderImageRules(url: string): Promise<{ allowPrivate: boolean } | null> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  const sources = [...(await activeSources("artwork")), ...(await activeSources("artistPictures"))];
  const source = sources.find((one) => {
    try {
      return new URL(one.apiUrl).origin === origin;
    } catch {
      return false;
    }
  });
  return source ? { allowPrivate: source.allowPrivate } : null;
}
