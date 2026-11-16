import { createFileRoute } from "@tanstack/react-router";
import { type YouVersionAnswer, type YouVersionBible, type YouVersionPassage, type YouVersionSettings } from "@oneverse/core";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@oneverse/ui/components/table";
import { apiClient } from "#/lib/api-client";
import { ImportedBiblesCard } from "./-imported-bibles";
import { Actions, Field, Said, useAction } from "./-metadata-providers";

export const Route = createFileRoute("/_protected/admin/bibles")({
  loader: async () => {
    const [youversion, imported, answers] = await Promise.all([apiClient.getYouVersionSettings(), apiClient.listAdminBibles(), apiClient.getYouVersionAnswers().catch(() => [])]);
    return { youversion, imported, answers };
  },
  component: AdminBiblesPage,
});

/** Admin > Bibles: where translations come from - files imported here (issue #301), and YouVersion's App Key (issue #304). */
function AdminBiblesPage() {
  const { t } = useTranslation();
  const loaded = Route.useLoaderData();
  const [settings, setSettings] = useState<YouVersionSettings>(loaded.youversion);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("bibles.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("bibles.description")}</p>
      </div>
      <ImportedBiblesCard initial={loaded.imported} />
      <YouVersionCard settings={settings} onSaved={setSettings} />
      {settings.source === "none" ? null : <TryPassageCard />}
      {settings.source === "none" ? null : <YouVersionAnswersCard initial={loaded.answers} />}
    </div>
  );
}

function YouVersionCard({ settings, onSaved }: { settings: YouVersionSettings; onSaved: (next: YouVersionSettings) => void }) {
  const { t } = useTranslation();
  const [appKey, setAppKey] = useState("");
  const [cache, setCache] = useState(settings.cache);
  const { busy, message, run } = useAction();
  const apply = (next: YouVersionSettings) => {
    onSaved(next);
    setAppKey("");
    setCache(next.cache);
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
        {/* Keeping passages (issue #485): as long as YouVersion's Cache-Control allows. */}
        <Field id="youversion-cache" label={t("bibles.cache")} hint={t("bibles.cacheHint")}>
          <NativeSelect id="youversion-cache" value={cache ? "allowed" : "never"} className="w-64" onChange={(event) => setCache(event.target.value === "allowed")}>
            <option value="allowed">{t("bibles.cacheAllowed")}</option>
            <option value="never">{t("bibles.cacheNever")}</option>
          </NativeSelect>
        </Field>
        <p className="text-xs text-muted-foreground" data-testid="youversion-cache-source">
          {settings.cache ? t("bibles.cacheOn") : t("bibles.cacheOff")} {t(`bibles.cache_${settings.cacheSource}`)}
        </p>
        <Actions
          busy={busy}
          onSave={() =>
            void run(async () => {
              if (appKey) apply(await apiClient.saveYouVersionKey(appKey));
              if (cache !== settings.cache) apply(await apiClient.saveYouVersionCache(cache));
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
            settings.hasDatabaseKey || settings.cacheSource === "database"
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

/** A number of seconds as people say it: "45 s", "10 min", "2 h", "3 days". */
function keptFor(seconds: number | null, t: TFunction): string {
  if (seconds === null) return t("bibles.answersUnsaid");
  if (seconds <= 0) return t("bibles.answersNotKept");
  if (seconds < 120) return t("bibles.answersSeconds", { count: seconds });
  if (seconds < 3600) return t("bibles.answersMinutes", { count: Math.round(seconds / 60) });
  if (seconds < 172800) return t("bibles.answersHours", { count: Math.round(seconds / 3600) });
  return t("bibles.answersDays", { count: Math.round(seconds / 86400) });
}

/**
 * YouVersion's last answers (issue #485), newest first: what was asked, the
 * Cache-Control it came with, and so how long the server and screens may
 * keep it.
 */
function YouVersionAnswersCard({ initial }: { initial: YouVersionAnswer[] }) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? answers : answers.slice(0, 10);
  return (
    <Card data-testid="youversion-answers">
      <CardHeader>
        <CardTitle className="text-sm">{t("bibles.answersTitle")}</CardTitle>
        <CardDescription>{t("bibles.answersDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bibles.answersNone")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("bibles.answersWhen")}</TableHead>
                  <TableHead>{t("bibles.answersAsked")}</TableHead>
                  <TableHead>Cache-Control</TableHead>
                  <TableHead>{t("bibles.answersServer")}</TableHead>
                  <TableHead>{t("bibles.answersScreens")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((answer, index) => (
                  <TableRow key={`${answer.at}-${index}`} data-testid="youversion-answer">
                    <TableCell className="whitespace-nowrap text-xs">{new Date(answer.at).toLocaleString()}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs" title={answer.asked}>
                      {answer.status === 200 ? null : <span className="mr-1 text-destructive">{answer.status}</span>}
                      {answer.asked.replace(/\?.*$/, "")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {answer.cacheControl ?? <span className="text-muted-foreground">{t("bibles.answersNoHeader")}</span>}
                      {answer.age ? <span className="text-muted-foreground"> · Age {answer.age}</span> : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{keptFor(answer.shared, t)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{keptFor(answer.private, t)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex gap-2">
          {answers.length > shown.length ? (
            <Button variant="outline" size="sm" onClick={() => setAll(true)}>
              {t("bibles.answersAll", { count: answers.length })}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void apiClient
                .getYouVersionAnswers()
                .then(setAnswers)
                .catch(() => undefined)
                .finally(() => setBusy(false));
            }}
          >
            {t("bibles.answersRefresh")}
          </Button>
        </div>
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
