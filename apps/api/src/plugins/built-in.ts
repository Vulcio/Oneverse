/**
 * Plugins (issue #157). For 1.0 every plugin is built in, shipped with
 * Oneverse and trusted like the rest of its code (brice, 2026-11-01):
 * installing plugins from elsewhere, each kept apart from the server,
 * comes after 1.0. A built-in plugin is described here, off until an
 * admin turns it on in Admin > Plugins (or PLUGINS_ENABLED lists it), and
 * answers the hooks it provides.
 */
import { prisma } from "@oneverse/db";

/** What a plugin can be asked for. */
export const PLUGIN_HOOKS = ["songInfo", "artwork", "artistPictures", "chords"] as const;
export type PluginHook = (typeof PLUGIN_HOOKS)[number];

export interface BuiltInPlugin {
  id: string;
  version: string;
  label: string;
  description: string;
  provides: readonly PluginHook[];
  /** Where its documentation is, on the docs site. */
  docsPath: string;
}

export const SONG_PROVIDER_PLUGIN: BuiltInPlugin = {
  id: "song-provider",
  version: "1.0.0",
  label: "Song provider",
  description: "Song info, artwork, artists' pictures, and chords with lyrics from any server that speaks the Song provider API.",
  provides: PLUGIN_HOOKS,
  docsPath: "/song-providers/",
};

export const BUILT_IN_PLUGINS: readonly BuiltInPlugin[] = [SONG_PROVIDER_PLUGIN];

export const builtInPlugin = (id: string): BuiltInPlugin | undefined => BUILT_IN_PLUGINS.find((plugin) => plugin.id === id);

/** Whether a plugin is on: Admin's choice, else PLUGINS_ENABLED ("song-provider,…"), else off. Read fresh each time. */
export async function pluginState(id: string): Promise<{ enabled: boolean; source: "database" | "env" | "default" }> {
  const row = await prisma.plugin.findUnique({ where: { id }, select: { enabled: true } });
  if (row) return { enabled: row.enabled, source: "database" };
  const env = process.env.PLUGINS_ENABLED?.split(",").map((name) => name.trim());
  if (env?.length && env.some(Boolean)) return { enabled: env.includes(id), source: "env" };
  return { enabled: false, source: "default" };
}
