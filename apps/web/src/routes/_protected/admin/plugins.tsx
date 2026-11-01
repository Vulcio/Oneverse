import { SONG_PROVIDER_HOOKS, type PluginSummary, type SongProviderHook, type SongProviderSourceSummary } from "@oneverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowUp, ExternalLink, Plug } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { apiClient } from "#/lib/api-client";
import { docsPageUrl } from "#/lib/docs";

export const Route = createFileRoute("/_protected/admin/plugins")({
  loader: () => apiClient.adminGetPlugins(),
  component: AdminPluginsPage,
});

/** What went wrong, as the API said it. */
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Admin > Plugins (issue #157): for 1.0, the plugins built into Oneverse,
 * each off until turned on here (or by PLUGINS_ENABLED), and the Song
 * provider plugin's servers - added only once they answer the API, their
 * keys kept encrypted and never shown again.
 */
function AdminPluginsPage() {
  const { t } = useTranslation();
  const summary = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("plugins.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("plugins.description")}</p>
      </div>
      {summary.plugins.map((plugin) => (
        <PluginCard key={plugin.id} plugin={plugin} encryptionKey={summary.encryptionKey} />
      ))}
    </div>
  );
}

function PluginCard({ plugin, encryptionKey }: { plugin: PluginSummary; encryptionKey: boolean }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown as chosen at once; put back if the save fails.
  const [enabled, setEnabled] = useState(plugin.enabled);
  useEffect(() => setEnabled(plugin.enabled), [plugin.enabled]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
    } catch (err) {
      setError(messageOf(err));
      setEnabled(plugin.enabled);
    } finally {
      setBusy(false);
    }
  };
  const source = plugin.source === "database" ? t("admin.securityFromDatabase") : plugin.source === "env" ? t("admin.securityFromEnv", { name: "PLUGINS_ENABLED" }) : t("plugins.offByDefault");
  return (
    <Card data-testid={`plugin-${plugin.id}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Plug className="size-4" aria-hidden />
          {t(`plugins.names.${plugin.id}`, { defaultValue: plugin.label })}
          <Badge variant="muted">{t("plugins.builtIn")}</Badge>
          <span className="text-xs font-normal text-muted-foreground">v{plugin.version}</span>
        </CardTitle>
        <CardDescription>{t(`plugins.descriptions.${plugin.id}`, { defaultValue: plugin.description })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5" aria-label={t("plugins.provides")}>
          {plugin.provides.map((hook) => (
            <Badge key={hook} variant="outline">
              {t(`plugins.hooks.${hook}`)}
            </Badge>
          ))}
        </div>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={enabled}
            disabled={busy}
            onChange={(event) => {
              const on = event.target.checked;
              setEnabled(on);
              void run(() => apiClient.adminSetPluginEnabled(plugin.id, on));
            }}
            data-testid="plugin-enabled"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t("plugins.enabled")}</span>
            <span className="text-xs text-muted-foreground">{source}</span>
          </span>
        </label>
        {plugin.source === "database" ? (
          <div>
            <ConfirmButton
              label={t("admin.authClearConfig")}
              confirmLabel={t("admin.authConfirmClear")}
              busyLabel={t("admin.authClearing")}
              cancelLabel={t("admin.cancel")}
              busy={busy}
              onConfirm={() => run(() => apiClient.adminResetPlugin(plugin.id))}
            />
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {plugin.sources ? <SongProviderSources sources={plugin.sources} encryptionKey={encryptionKey} /> : null}
        <a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href={docsPageUrl(plugin.docsPath.replace(/^\/|\/$/g, ""), i18n.language)} target="_blank" rel="noreferrer">
          {t("plugins.docs")}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </CardContent>
    </Card>
  );
}

/** The Song provider plugin's servers, in the order they're asked, and the form to add one. */
function SongProviderSources({ sources, encryptionKey }: { sources: SongProviderSourceSummary[]; encryptionKey: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="song-provider-servers">
      <h2 id="song-provider-servers" className="text-sm font-semibold">
        {t("plugins.servers")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("plugins.serversHint")}</p>
      {!encryptionKey ? (
        <p className="text-sm text-destructive" role="alert">
          {t("plugins.noEncryptionKey")}
        </p>
      ) : null}
      {sources.length === 0 ? <p className="text-sm text-muted-foreground">{t("plugins.noServers")}</p> : null}
      <ul className="flex flex-col gap-3">
        {sources.map((source, index) => (
          <SourceRow key={source.id} source={source} previous={index > 0 ? sources[index - 1]! : null} ids={sources.map((one) => one.id)} />
        ))}
      </ul>
      <AddSource />
    </section>
  );
}

function SourceRow({ source, previous, ids }: { source: SongProviderSourceSummary; previous: SongProviderSourceSummary | null; ids: string[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<{ ok: boolean; message: string } | null>(null);
  const [editing, setEditing] = useState(false);
  // What's ticked, shown at once; put back if the save fails.
  const [hooks, setHooks] = useState(source.hooks);
  const [enabled, setEnabled] = useState(source.enabled);
  useEffect(() => {
    setHooks(source.hooks);
    setEnabled(source.enabled);
  }, [source]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
      return true;
    } catch (err) {
      setError(messageOf(err));
      setHooks(source.hooks);
      setEnabled(source.enabled);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const toggleHook = (hook: SongProviderHook, on: boolean) => {
    const next = SONG_PROVIDER_HOOKS.filter((one) => (one === hook ? on : hooks.includes(one)));
    setHooks(next);
    void run(() => apiClient.adminUpdateSongProvider(source.id, { hooks: next }));
  };
  return (
    <li className="flex flex-col gap-3 rounded-md border p-3" data-testid="song-provider-source">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{source.name}</p>
          <p className="truncate text-xs text-muted-foreground">{source.apiUrl}</p>
          <p className="text-xs text-muted-foreground">
            {source.hasApiKey ? t("plugins.keySaved") : t("plugins.noKey")}
            {source.allowPrivate ? ` · ${t("plugins.onThisNetwork")}` : null}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={enabled}
            disabled={busy}
            onChange={(event) => {
              const on = event.target.checked;
              setEnabled(on);
              void run(() => apiClient.adminUpdateSongProvider(source.id, { enabled: on }));
            }}
          />
          {t("plugins.serverOn")}
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5" disabled={busy}>
        <legend className="mb-1 text-xs font-medium">{t("plugins.askedFor")}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {SONG_PROVIDER_HOOKS.map((hook) => {
            const answers = source.provides.includes(hook);
            return (
              <label key={hook} className={answers ? "flex items-center gap-2 text-sm" : "flex items-center gap-2 text-sm text-muted-foreground"}>
                <input type="checkbox" className="size-4" checked={hooks.includes(hook)} disabled={!answers} onChange={(event) => toggleHook(hook, event.target.checked)} />
                {t(`plugins.hooks.${hook}`)}
                {answers ? null : <span className="text-xs">({t("plugins.notAnswered")})</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      {source.lastError ? (
        <p className="text-xs text-destructive" data-testid="song-provider-error">
          {t("plugins.lastError", { message: source.lastError })}
        </p>
      ) : null}
      {tested ? (
        <p className={tested.ok ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-xs text-destructive"} role="status" data-testid="song-provider-test">
          {tested.message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {editing ? <EditSource source={source} onDone={() => setEditing(false)} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setTested(await apiClient.adminTestSongProvider(source.id));
            })
          }
        >
          {t("plugins.test")}
        </Button>
        {!editing ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            {t("plugins.edit")}
          </Button>
        ) : null}
        {previous ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            aria-label={t("plugins.moveUp", { name: source.name })}
            onClick={() => {
              const order = ids.filter((id) => id !== source.id);
              order.splice(order.indexOf(previous.id), 0, source.id);
              void run(() => apiClient.adminReorderSongProviders(order));
            }}
          >
            <ArrowUp aria-hidden />
          </Button>
        ) : null}
        <ConfirmButton
          label={t("plugins.remove")}
          confirmLabel={t("plugins.confirmRemove")}
          busyLabel={t("plugins.removing")}
          cancelLabel={t("admin.cancel")}
          busy={busy}
          onConfirm={async () => {
            await run(() => apiClient.adminRemoveSongProvider(source.id));
          }}
        />
      </div>
    </li>
  );
}

/** Its address, name or key changed: a new address or key is asked before it's kept. */
function EditSource({ source, onDone }: { source: SongProviderSourceSummary; onDone: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState(source.name);
  const [apiUrl, setApiUrl] = useState(source.apiUrl);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [allowPrivate, setAllowPrivate] = useState(source.allowPrivate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [apiUrl, apiKey]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.adminUpdateSongProvider(source.id, {
        ...(name.trim() !== source.name && { name }),
        ...(apiUrl.trim() !== source.apiUrl && { apiUrl }),
        ...(allowPrivate !== source.allowPrivate && { allowPrivate }),
        ...(clearKey ? { apiKey: "" } : apiKey.trim() ? { apiKey } : {}),
      });
      await router.invalidate();
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
      <SourceFields name={name} onName={setName} apiUrl={apiUrl} onApiUrl={setApiUrl} apiKey={apiKey} onApiKey={setApiKey} allowPrivate={allowPrivate} onAllowPrivate={setAllowPrivate} keyHint={source.hasApiKey ? t("plugins.keyKeep") : undefined} id={source.id} />
      {source.hasApiKey ? (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />
          {t("plugins.clearKey")}
        </label>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || !apiUrl.trim()} onClick={() => void save()}>
          {busy ? t("plugins.checking") : t("plugins.save")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          {t("admin.cancel")}
        </Button>
      </div>
    </div>
  );
}

function SourceFields(props: {
  id: string;
  name: string;
  onName: (value: string) => void;
  apiUrl: string;
  onApiUrl: (value: string) => void;
  apiKey: string;
  onApiKey: (value: string) => void;
  allowPrivate: boolean;
  onAllowPrivate: (value: boolean) => void;
  keyHint?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={`${props.id}-url`}>{t("plugins.address")}</Label>
        <Input id={`${props.id}-url`} value={props.apiUrl} onChange={(event) => props.onApiUrl(event.target.value)} placeholder="https://songs.example.com/v1" inputMode="url" autoComplete="off" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${props.id}-key`}>{t("plugins.key")}</Label>
        <Input id={`${props.id}-key`} type="password" value={props.apiKey} onChange={(event) => props.onApiKey(event.target.value)} placeholder={props.keyHint} autoComplete="new-password" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${props.id}-name`}>{t("plugins.name")}</Label>
        <Input id={`${props.id}-name`} value={props.name} onChange={(event) => props.onName(event.target.value)} placeholder={t("plugins.nameHint")} />
      </div>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" className="mt-0.5 size-4" checked={props.allowPrivate} onChange={(event) => props.onAllowPrivate(event.target.checked)} />
        <span className="flex flex-col">
          <span>{t("plugins.onThisNetwork")}</span>
          <span className="text-xs text-muted-foreground">{t("plugins.onThisNetworkHint")}</span>
        </span>
      </label>
    </div>
  );
}

/** A server added: asked for its capabilities first, everything it answers chosen. */
function AddSource() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [allowPrivate, setAllowPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.adminAddSongProvider({ apiUrl, ...(apiKey.trim() && { apiKey }), ...(name.trim() && { name }), allowPrivate });
      setName("");
      setApiUrl("");
      setApiKey("");
      setAllowPrivate(false);
      await router.invalidate();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-dashed p-3"
      data-testid="song-provider-add"
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <h3 className="text-sm font-medium">{t("plugins.addServer")}</h3>
      <SourceFields id="new-source" name={name} onName={setName} apiUrl={apiUrl} onApiUrl={setApiUrl} apiKey={apiKey} onApiKey={setApiKey} allowPrivate={allowPrivate} onAllowPrivate={setAllowPrivate} />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={busy || !apiUrl.trim()}>
          {busy ? t("plugins.checking") : t("plugins.add")}
        </Button>
      </div>
    </form>
  );
}
