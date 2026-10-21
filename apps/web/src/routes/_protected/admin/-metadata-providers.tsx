import { METADATA_CAPABILITIES, type MetadataCapability, type MetadataSettings } from "@oneverse/core";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";

type Provider = MetadataSettings["providers"][number];
type Message = { kind: "ok" | "error"; text: string } | null;

/** Runs an admin action, keeping what it says (or its error) to show. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "ok", text: await action() });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, run };
}

export function Said({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p className={`text-sm ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`} role={message.kind === "error" ? "alert" : "status"}>
      {message.text}
    </p>
  );
}

/**
 * The metadata providers (issues #22, #89): MusicBrainz, Apple Music,
 * Deezer and Spotify, in the order they're asked; what each is asked for
 * (song info, album artwork, artist pictures, artist bios - what it can
 * do); and each one's own settings, opened from its row.
 */
export function MetadataProvidersCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MetadataSettings | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const { busy, message, run } = useAction();

  const apply = (next: MetadataSettings) => {
    setSettings(next);
    setProviders(next.providers);
  };
  // A provider's own settings saved: its state, without undoing the list's unsaved changes.
  const applyOwn = (next: MetadataSettings) => {
    setSettings(next);
    setProviders((current) => current.map((p) => ({ ...p, ready: next.providers.find((n) => n.key === p.key)?.ready ?? p.ready })));
  };
  useEffect(() => {
    apiClient.getMetadataSettings().then(apply).catch(() => {});
  }, []);

  function move(index: number, by: -1 | 1) {
    setProviders((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved!);
      return next;
    });
  }
  const toggle = (key: string, capability: MetadataCapability, on: boolean) =>
    setProviders((current) => current.map((p) => (p.key === key ? { ...p, capabilities: { ...p.capabilities, [capability]: on } } : p)));

  const currently = settings?.source === "database" ? "currentlyDatabase" : settings?.source === "env" ? "currentlyEnv" : "currentlyDefault";
  return (
    <Card data-testid="metadata-providers">
      <CardHeader>
        <CardTitle className="text-sm">{t("metadataProviders.title")}</CardTitle>
        <CardDescription>{t("metadataProviders.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings ? <p className="text-sm text-muted-foreground">{t(`metadataProviders.${currently}`)}</p> : null}
        <ol className="flex flex-col divide-y rounded-md border">
          {providers.map((provider, index) => (
            <li key={provider.key} className="flex flex-col gap-3 p-3" data-testid={`provider-${provider.key}`}>
              <div className="flex items-start gap-3">
                <span className="w-5 pt-0.5 text-sm text-muted-foreground tabular-nums">{index + 1}.</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div>
                    <p className="text-sm font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground">{t(`metadataProviders.about_${provider.key}`)}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {METADATA_CAPABILITIES.filter((capability) => provider.supports.includes(capability)).map((capability) => (
                      <label key={capability} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={provider.capabilities[capability]}
                          aria-label={t("metadataProviders.capabilityFrom", { capability: t(`metadataProviders.capability_${capability}`), name: provider.name })}
                          onChange={(event) => toggle(provider.key, capability, event.target.checked)}
                        />
                        {t(`metadataProviders.capability_${capability}`)}
                        {!provider.ready[capability] ? <span className="text-xs text-muted-foreground">({t("metadataProviders.needsKey")})</span> : null}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  <Button variant="ghost" size="icon" aria-label={t("metadataProviders.moveUp", { name: provider.name })} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("metadataProviders.moveDown", { name: provider.name })}
                    disabled={index === providers.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              </div>
              <div className="pl-8">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={open === provider.key}
                  aria-label={t("metadataProviders.settingsOf", { name: provider.name })}
                  onClick={() => setOpen(open === provider.key ? null : provider.key)}
                >
                  {open === provider.key ? <ChevronDown /> : <ChevronRight />}
                  {t("metadataProviders.settings")}
                </Button>
                {open === provider.key && settings ? (
                  <div className="mt-2 flex flex-col gap-4 rounded-md bg-muted/40 p-3">
                    {provider.key === "musicbrainz" ? <MusicBrainzSettings settings={settings} onSaved={applyOwn} /> : null}
                    {provider.key === "apple_music" ? <AppleMusicSettings settings={settings} onSaved={applyOwn} /> : null}
                    {provider.key === "deezer" ? <p className="text-sm text-muted-foreground">{t("metadataProviders.noSettings")}</p> : null}
                    {provider.key === "spotify" ? <SpotifySettings settings={settings} onSaved={applyOwn} /> : null}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                apply(await apiClient.saveMetadataSettings(providers.map(({ key, capabilities }) => ({ key, ...capabilities }))));
                return t("metadataProviders.saved");
              })
            }
          >
            {t("metadataProviders.save")}
          </Button>
          {settings?.source === "database" ? (
            <ConfirmButton
              label={t("metadataProviders.revert")}
              confirmLabel={t("metadataProviders.revertConfirm")}
              busyLabel={t("admin.running")}
              cancelLabel={t("admin.cancel")}
              busy={busy}
              onConfirm={() =>
                run(async () => {
                  apply(await apiClient.resetMetadataSettings());
                  return t("metadataProviders.saved");
                })
              }
            />
          ) : null}
        </div>
        <Said message={message} />
      </CardContent>
    </Card>
  );
}

/** Save configuration, Test connection (where there's something to test) and Revert, for one provider's settings. */
export function Actions({
  busy,
  onSave,
  onTest,
  onRevert,
}: {
  busy: boolean;
  onSave: () => void;
  onTest?: () => void;
  onRevert?: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy} onClick={onSave}>
        {t("metadataProviders.save")}
      </Button>
      {onTest ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={onTest}>
          {t("metadataProviders.test")}
        </Button>
      ) : null}
      {onRevert ? (
        <ConfirmButton
          label={t("metadataProviders.revert")}
          confirmLabel={t("metadataProviders.revertConfirm")}
          busyLabel={t("admin.running")}
          cancelLabel={t("admin.cancel")}
          busy={busy}
          onConfirm={onRevert}
        />
      ) : null}
    </div>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex max-w-xl flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** MusicBrainz's contact, sent in its User-Agent as it asks. */
function MusicBrainzSettings({ settings, onSaved }: { settings: MetadataSettings; onSaved: (next: MetadataSettings) => void }) {
  const { t } = useTranslation();
  const [contact, setContact] = useState(settings.musicbrainz.source === "database" ? settings.musicbrainz.contact : "");
  const { busy, message, run } = useAction();
  const save = (value: string) =>
    run(async () => {
      const next = await apiClient.saveMusicBrainzContact(value);
      onSaved(next);
      setContact(next.musicbrainz.source === "database" ? next.musicbrainz.contact : "");
      return t("metadataProviders.saved");
    });
  return (
    <div className="flex flex-col gap-3" data-testid="musicbrainz-settings">
      <p className="text-sm text-muted-foreground">{t(`metadataProviders.contact_${settings.musicbrainz.source}`, { contact: settings.musicbrainz.contact })}</p>
      <Field id="musicbrainz-contact" label={t("metadataProviders.contact")} hint={t("metadataProviders.contactHint")}>
        <Input id="musicbrainz-contact" value={contact} placeholder={settings.musicbrainz.contact} onChange={(event) => setContact(event.target.value)} />
      </Field>
      <Actions busy={busy} onSave={() => void save(contact)} onRevert={settings.musicbrainz.source === "database" ? () => save("") : undefined} />
      <Said message={message} />
    </div>
  );
}

/**
 * Apple Music: its storefront, and the Apple Music API's MusicKit key
 * (issue #87) - or, until there's one, a developer token address. The
 * private key is never shown back, only whether one is saved.
 */
function AppleMusicSettings({ settings, onSaved }: { settings: MetadataSettings; onSaved: (next: MetadataSettings) => void }) {
  const { t } = useTranslation();
  const apple = settings.appleMusic;
  const [country, setCountry] = useState(apple.country);
  const [teamId, setTeamId] = useState(apple.source === "env" ? "" : (apple.teamId ?? ""));
  const [keyId, setKeyId] = useState(apple.source === "env" ? "" : (apple.keyId ?? ""));
  const [privateKey, setPrivateKey] = useState("");
  const [tokenUrl, setTokenUrl] = useState(apple.tokenUrlSource === "database" ? (apple.tokenUrl ?? "") : "");
  const { busy, message, run } = useAction();

  const apply = (next: MetadataSettings) => {
    onSaved(next);
    setTeamId(next.appleMusic.source === "env" ? "" : (next.appleMusic.teamId ?? ""));
    setKeyId(next.appleMusic.source === "env" ? "" : (next.appleMusic.keyId ?? ""));
    setPrivateKey("");
    setTokenUrl(next.appleMusic.tokenUrlSource === "database" ? (next.appleMusic.tokenUrl ?? "") : "");
    setCountry(next.appleMusic.country);
  };

  const currently = apple.source === "database" ? "keyDatabase" : apple.source === "env" ? "keyEnv" : apple.source === "tokenUrl" ? "keyTokenUrl" : "keyNone";
  return (
    <div className="flex flex-col gap-4" data-testid="apple-music-key">
      <p className="text-sm text-muted-foreground">{t("metadataProviders.keyDescription")}</p>
      <p className="text-sm text-muted-foreground">{t(`metadataProviders.${currently}`, { teamId: apple.teamId ?? "", keyId: apple.keyId ?? "", url: apple.tokenUrl ?? "" })}</p>
      <Field id="apple-country" label={t("artwork.country")} hint={t("artwork.countryHint")}>
        <Input id="apple-country" className="max-w-24" value={country} maxLength={2} onChange={(event) => setCountry(event.target.value)} />
      </Field>
      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <Field id="apple-team-id" label={t("metadataProviders.teamId")}>
          <Input id="apple-team-id" value={teamId} maxLength={10} autoComplete="off" onChange={(event) => setTeamId(event.target.value.toUpperCase())} />
        </Field>
        <Field id="apple-key-id" label={t("metadataProviders.keyId")}>
          <Input id="apple-key-id" value={keyId} maxLength={10} autoComplete="off" onChange={(event) => setKeyId(event.target.value.toUpperCase())} />
        </Field>
      </div>
      <Field id="apple-private-key" label={t("metadataProviders.privateKey")} hint={t("metadataProviders.privateKeyHint")}>
        <Textarea
          id="apple-private-key"
          value={privateKey}
          rows={5}
          spellCheck={false}
          autoComplete="off"
          className="font-mono text-xs"
          placeholder={apple.hasDatabasePrivateKey ? t("metadataProviders.privateKeyKeep") : "-----BEGIN PRIVATE KEY-----"}
          onChange={(event) => setPrivateKey(event.target.value)}
        />
      </Field>
      <Field id="apple-token-url" label={t("metadataProviders.tokenUrl")} hint={t("metadataProviders.tokenUrlHint")}>
        <Input
          id="apple-token-url"
          type="url"
          value={tokenUrl}
          autoComplete="off"
          placeholder={apple.tokenUrlSource === "env" ? (apple.tokenUrl ?? "") : "https://"}
          onChange={(event) => setTokenUrl(event.target.value)}
        />
      </Field>
      <Actions
        busy={busy}
        onSave={() =>
          void run(async () => {
            if (country.trim().toLowerCase() !== apple.country) await apiClient.saveArtworkSettings({ country });
            apply(await apiClient.saveAppleMusicKey({ teamId, keyId, tokenUrl, ...(privateKey.trim() && { privateKey }) }));
            return t("metadataProviders.saved");
          })
        }
        onTest={
          apple.source === "none"
            ? undefined
            : () =>
                void run(async () => {
                  const result = await apiClient.testAppleMusicKey();
                  if (!result.ok) throw new Error(result.message);
                  return result.message;
                })
        }
        onRevert={
          (apple.hasDatabasePrivateKey || apple.teamId || apple.keyId || apple.tokenUrlSource === "database") && apple.source !== "env"
            ? () =>
                run(async () => {
                  apply(await apiClient.resetAppleMusicKey());
                  return t("metadataProviders.saved");
                })
            : undefined
        }
      />
      <Said message={message} />
    </div>
  );
}

/** Spotify's developer app (issue #89): client ID, secret (never shown back) and market. */
function SpotifySettings({ settings, onSaved }: { settings: MetadataSettings; onSaved: (next: MetadataSettings) => void }) {
  const { t } = useTranslation();
  const spotify = settings.spotify;
  const [clientId, setClientId] = useState(spotify.source === "env" ? "" : (spotify.clientId ?? ""));
  const [clientSecret, setClientSecret] = useState("");
  const [market, setMarket] = useState(spotify.marketSource === "database" ? spotify.market : "");
  const { busy, message, run } = useAction();

  const apply = (next: MetadataSettings) => {
    onSaved(next);
    setClientId(next.spotify.source === "env" ? "" : (next.spotify.clientId ?? ""));
    setClientSecret("");
    setMarket(next.spotify.marketSource === "database" ? next.spotify.market : "");
  };

  return (
    <div className="flex flex-col gap-4" data-testid="spotify-settings">
      <p className="text-sm text-muted-foreground">{t("metadataProviders.spotifyDescription")}</p>
      <p className="text-sm text-muted-foreground">{t(`metadataProviders.spotify_${spotify.source}`, { clientId: spotify.clientId ?? "" })}</p>
      <Field id="spotify-client-id" label={t("metadataProviders.clientId")}>
        <Input id="spotify-client-id" value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value.trim())} />
      </Field>
      <Field id="spotify-client-secret" label={t("metadataProviders.clientSecret")} hint={t("metadataProviders.clientSecretHint")}>
        <Input
          id="spotify-client-secret"
          type="password"
          value={clientSecret}
          autoComplete="off"
          placeholder={spotify.hasDatabaseSecret ? t("metadataProviders.privateKeyKeep") : ""}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      </Field>
      <Field id="spotify-market" label={t("metadataProviders.market")} hint={t("metadataProviders.marketHint")}>
        <Input id="spotify-market" className="max-w-24" value={market} maxLength={2} placeholder={spotify.market} onChange={(event) => setMarket(event.target.value.toUpperCase())} />
      </Field>
      <Actions
        busy={busy}
        onSave={() =>
          void run(async () => {
            apply(await apiClient.saveSpotifyApp({ clientId, market, ...(clientSecret.trim() && { clientSecret }) }));
            return t("metadataProviders.saved");
          })
        }
        onTest={
          spotify.source === "none"
            ? undefined
            : () =>
                void run(async () => {
                  const result = await apiClient.testSpotifyApp();
                  if (!result.ok) throw new Error(result.message);
                  return result.message;
                })
        }
        onRevert={
          (spotify.hasDatabaseSecret || spotify.clientId || spotify.marketSource === "database") && spotify.source !== "env"
            ? () =>
                run(async () => {
                  apply(await apiClient.resetSpotifyApp());
                  return t("metadataProviders.saved");
                })
            : undefined
        }
      />
      <Said message={message} />
    </div>
  );
}

/**
 * The YouTube Data API's key (issue #169): not a metadata provider, but what
 * lets a song's YouTube link be searched for on its Links tab.
 */
export function YouTubeCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MetadataSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const { busy, message, run } = useAction();

  useEffect(() => {
    apiClient.getMetadataSettings().then(setSettings, () => undefined);
  }, []);
  if (!settings) return null;
  const youtube = settings.youtube;
  const apply = (next: MetadataSettings) => {
    setSettings(next);
    setApiKey("");
  };

  return (
    <Card data-testid="youtube-settings">
      <CardHeader>
        <CardTitle className="text-sm">{t("metadataProviders.youtubeTitle")}</CardTitle>
        <CardDescription>{t("metadataProviders.youtubeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t(`metadataProviders.youtube_${youtube.source}`)}</p>
        <Field id="youtube-api-key" label={t("metadataProviders.apiKey")} hint={t("metadataProviders.apiKeyHint")}>
          <Input
            id="youtube-api-key"
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={youtube.hasDatabaseKey ? t("metadataProviders.privateKeyKeep") : ""}
            onChange={(event) => setApiKey(event.target.value.trim())}
          />
        </Field>
        <Actions
          busy={busy}
          onSave={() =>
            void run(async () => {
              if (apiKey) apply(await apiClient.saveYouTubeKey(apiKey));
              return t("metadataProviders.saved");
            })
          }
          onTest={
            youtube.source === "none"
              ? undefined
              : () =>
                  void run(async () => {
                    const result = await apiClient.testYouTubeKey();
                    if (!result.ok) throw new Error(result.message);
                    return result.message;
                  })
          }
          onRevert={
            youtube.hasDatabaseKey
              ? () =>
                  run(async () => {
                    apply(await apiClient.resetYouTubeKey());
                    return t("metadataProviders.saved");
                  })
              : undefined
          }
        />
        <Said message={message} />
      </CardContent>
    </Card>
  );
}
