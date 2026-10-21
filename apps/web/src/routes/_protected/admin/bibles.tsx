import { createFileRoute } from "@tanstack/react-router";
import type { YouVersionBible, YouVersionPassage, YouVersionSettings } from "@oneverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";
import { Actions, Field, Said, useAction } from "./-metadata-providers";

export const Route = createFileRoute("/_protected/admin/bibles")({
  loader: () => apiClient.getYouVersionSettings(),
  component: AdminBiblesPage,
});

/** Admin > Bibles (issue #304): where translations come from - for now, YouVersion's App Key. */
function AdminBiblesPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<YouVersionSettings>(Route.useLoaderData());
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("bibles.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("bibles.description")}</p>
      </div>
      <YouVersionCard settings={settings} onSaved={setSettings} />
      {settings.source === "none" ? null : <TryPassageCard />}
    </div>
  );
}

function YouVersionCard({ settings, onSaved }: { settings: YouVersionSettings; onSaved: (next: YouVersionSettings) => void }) {
  const { t } = useTranslation();
  const [appKey, setAppKey] = useState("");
  const { busy, message, run } = useAction();
  const apply = (next: YouVersionSettings) => {
    onSaved(next);
    setAppKey("");
  };
  return (
    <Card data-testid="youversion-settings">
      <CardHeader>
        <CardTitle className="text-sm">{t("bibles.youversionTitle")}</CardTitle>
        <CardDescription>{t("bibles.youversionDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground" data-testid="youversion-source">
          {t(`bibles.youversion_${settings.source}`)}
        </p>
        <Field id="youversion-app-key" label={t("bibles.appKey")} hint={t("metadataProviders.apiKeyHint")}>
          <Input
            id="youversion-app-key"
            type="password"
            value={appKey}
            autoComplete="off"
            placeholder={settings.hasDatabaseKey ? t("metadataProviders.privateKeyKeep") : ""}
            onChange={(event) => setAppKey(event.target.value.trim())}
          />
        </Field>
        <Actions
          busy={busy}
          onSave={() =>
            void run(async () => {
              if (appKey) apply(await apiClient.saveYouVersionKey(appKey));
              return t("metadataProviders.saved");
            })
          }
          onTest={
            settings.source === "none"
              ? undefined
              : () =>
                  void run(async () => {
                    const result = await apiClient.testYouVersionKey();
                    if (!result.ok) throw new Error(result.message);
                    return result.message;
                  })
          }
          onRevert={
            settings.hasDatabaseKey
              ? () =>
                  run(async () => {
                    apply(await apiClient.resetYouVersionKey());
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

/** A passage read through the key, with the version's attribution as it must be shown. */
function TryPassageCard() {
  const { t } = useTranslation();
  const [language, setLanguage] = useState("en");
  const [bibles, setBibles] = useState<YouVersionBible[] | null>(null);
  const [bibleId, setBibleId] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [passage, setPassage] = useState<YouVersionPassage | null>(null);
  const { busy, message, run } = useAction();
  return (
    <Card data-testid="youversion-try">
      <CardHeader>
        <CardTitle className="text-sm">{t("bibles.tryTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field id="youversion-language" label={t("bibles.language")} hint={t("bibles.languageHint")}>
            <Input id="youversion-language" value={language} className="w-32" onChange={(event) => setLanguage(event.target.value.trim())} />
          </Field>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !language}
            onClick={() =>
              void run(async () => {
                const found = await apiClient.getYouVersionBibles(language);
                setBibles(found);
                setBibleId(found[0]?.id ?? null);
                setPassage(null);
                return found.length ? "" : t("bibles.noVersions");
              })
            }
          >
            {t("bibles.findVersions")}
          </Button>
        </div>
        {bibles?.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field id="youversion-version" label={t("bibles.version")}>
              <NativeSelect id="youversion-version" value={String(bibleId ?? "")} onChange={(event) => setBibleId(Number(event.target.value))}>
                {bibles.map((bible) => (
                  <option key={bible.id} value={bible.id}>
                    {bible.abbreviation} - {bible.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="youversion-reference" label={t("bibles.reference")}>
              <Input id="youversion-reference" value={reference} placeholder={t("bibles.referencePlaceholder")} onChange={(event) => setReference(event.target.value)} />
            </Field>
            <Button
              size="sm"
              disabled={busy || bibleId === null || !reference.trim()}
              onClick={() =>
                void run(async () => {
                  setPassage(await apiClient.getYouVersionPassage(bibleId!, reference.trim()));
                  return "";
                })
              }
            >
              {t("bibles.read")}
            </Button>
          </div>
        ) : null}
        {passage ? (
          <figure className="flex flex-col gap-2" data-testid="youversion-passage">
            <figcaption className="text-sm font-medium">
              {passage.reference} ({passage.bible.abbreviation})
            </figcaption>
            {passage.parts.map((part) => (
              <p key={part.id} className="text-sm">
                {part.text}
              </p>
            ))}
            {/* YouVersion's attribution, as text: shown with every passage. */}
            <p className="text-xs text-muted-foreground">{passage.bible.attribution}</p>
            {passage.bible.link ? (
              <a href={passage.bible.link} target="_blank" rel="noreferrer" className="text-xs underline">
                {t("bibles.readOnYouVersion")}
              </a>
            ) : null}
          </figure>
        ) : null}
        {message?.text ? <Said message={message} /> : null}
      </CardContent>
    </Card>
  );
}
