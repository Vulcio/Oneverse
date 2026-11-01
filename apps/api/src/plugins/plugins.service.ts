import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@oneverse/db";
import { BUILT_IN_PLUGINS, builtInPlugin, pluginState } from "./built-in.js";
import { listSources, summarize, type SongProviderSourceSummary } from "./song-provider/song-provider-sources.js";

export interface PluginSummary {
  id: string;
  version: string;
  label: string;
  description: string;
  provides: string[];
  docsPath: string;
  builtIn: true;
  enabled: boolean;
  /** Where "enabled" comes from: Admin, PLUGINS_ENABLED, or the default (off). */
  source: "database" | "env" | "default";
  /** The Song provider plugin's servers. */
  sources?: SongProviderSourceSummary[];
}

@Injectable()
export class PluginsService {
  async list(): Promise<{ plugins: PluginSummary[]; encryptionKey: boolean }> {
    const plugins = await Promise.all(
      BUILT_IN_PLUGINS.map(async (plugin) => {
        const state = await pluginState(plugin.id);
        return {
          ...plugin,
          provides: [...plugin.provides],
          builtIn: true as const,
          ...state,
          ...(plugin.id === "song-provider" && { sources: (await listSources()).map(summarize) }),
        };
      }),
    );
    // A server's key is encrypted with SETTINGS_ENCRYPTION_KEY: without it, keys can't be saved.
    return { plugins, encryptionKey: !!process.env.SETTINGS_ENCRYPTION_KEY };
  }

  async setEnabled(id: string, enabled: boolean) {
    if (!builtInPlugin(id)) throw new NotFoundException("No such plugin");
    await prisma.plugin.upsert({ where: { id }, create: { id, enabled }, update: { enabled } });
    return this.list();
  }

  async reset(id: string) {
    if (!builtInPlugin(id)) throw new NotFoundException("No such plugin");
    await prisma.plugin.deleteMany({ where: { id } });
    return this.list();
  }
}
