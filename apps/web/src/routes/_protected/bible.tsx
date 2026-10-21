import { readItemScreenTemplate, type BibleBookLocale, type BiblePassage, type ImportedBible, type SetlistItemScreenTemplate, type SetlistSummary, type YouVersionBible, type YouVersionPassage } from "@oneverse/core";
import { setlistTitle } from "@oneverse/screen/lib/set-items";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { importedVersion, languageTag, PassagePicker, pickerLanguages, youVersionVersion } from "#/components/passage-picker";
import { PassageTemplateSelect } from "#/components/passage-template-select";
import { PassageVerses } from "#/components/set-passage-item";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/bible")({
  component: BiblePage,
});

/** Where the last language and version read are kept on this device. */
const LANGUAGE_KEY = "oneverse.bible.language";
const VERSION_KEY = "oneverse.bible.version";
/** And the screen template last picked for a passage (issue #310). */
const TEMPLATE_KEY = "oneverse.bible.template";

function storedTemplate(): SetlistItemScreenTemplate | null {
  try {
    return readItemScreenTemplate(JSON.parse(stored(TEMPLATE_KEY) || "null"));
  } catch {
    return null;
  }
}

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: picked again next time.
  }
}

type Read = { kind: "imported"; passage: BiblePassage } | { kind: "youversion"; passage: YouVersionPassage };

/**
 * The Bible (issue #310), in the sidebar of the members of a team or an
 * organisation that turned it on: a version in the reader's language - one
 * imported on the server, or YouVersion's - or in any other, and a passage
 * picked or typed, read with its copyright line. An imported Bible's passage
 * goes into a set from here; YouVersion's can't yet, until each version's
 * licence is read (#304).
 */
function BiblePage() {
  const { t, i18n } = useTranslation();
  const locale: BibleBookLocale = i18n.language.startsWith("fr") ? "fr" : "en";
  const [imported, setImported] = useState<ImportedBible[] | null>(null);
  const [hasYouVersion, setHasYouVersion] = useState(false);
  const [language, setLanguage] = useState(() => stored(LANGUAGE_KEY) || i18n.language.split("-")[0] || "en");
  const [youversion, setYouversion] = useState<YouVersionBible[]>([]);
  const [versionKey, setVersionKey] = useState(() => stored(VERSION_KEY));
  const [reference, setReference] = useState("");
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([apiClient.listBibles(), apiClient.getScriptureProviders().catch(() => ({ youversion: false }))]).then(
      ([bibles, providers]) => {
        setImported(bibles);
        setHasYouVersion(providers.youversion);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);
  // YouVersion's versions in the language picked.
  useEffect(() => {
    if (!hasYouVersion) return;
    let current = true;
    void apiClient
      .getYouVersionBibles(language)
      .catch(() => [])
      .then((found) => current && setYouversion(found));
    return () => {
      current = false;
    };
  }, [hasYouVersion, language]);

  const languages = useMemo(() => pickerLanguages(i18n.language, imported ?? []), [i18n.language, imported]);
  // The server's Bibles in that language (and those that don't say theirs), then YouVersion's.
  const versions = useMemo(
    () => [
      ...(imported ?? []).filter((bible) => [language, null].includes(languageTag(bible.language))).map((bible) => importedVersion(bible, locale)),
      ...youversion.map((bible) => youVersionVersion(bible, locale)),
    ],
    [imported, youversion, language, locale],
  );
  const version = versions.find((one) => one.key === versionKey) ?? versions[0] ?? null;

  async function readPassage() {
    if (!version) return;
    setBusy(true);
    setError(null);
    try {
      setRead(
        version.kind === "youversion"
          ? { kind: "youversion", passage: await apiClient.getYouVersionPassage(Number(version.id), reference.trim()) }
          : { kind: "imported", passage: await apiClient.getBiblePassage(version.id, reference.trim()) },
      );
    } catch (err) {
      setRead(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const none = imported !== null && imported.length === 0 && !hasYouVersion;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6" data-testid="bible-page">
      <div>
        <h1 className="text-2xl font-semibold">{t("biblePage.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("biblePage.description")}</p>
      </div>
      {none ? (
        <p className="text-sm text-muted-foreground" data-testid="bible-none">
          {t("biblePage.none")}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void readPassage();
          }}
        >
          <PassagePicker
            languages={languages}
            language={language}
            onLanguage={(tag) => {
              setLanguage(tag);
              store(LANGUAGE_KEY, tag);
              setYouversion([]);
              setRead(null);
            }}
            versions={versions}
            version={version}
            onVersion={(picked) => {
              setVersionKey(picked.key);
              store(VERSION_KEY, picked.key);
              setRead(null);
            }}
            reference={reference}
            onReference={setReference}
            busy={busy}
          />
        </form>
      )}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {read?.kind === "imported" ? (
        <>
          <article className="flex flex-col gap-3" data-testid="bible-passage">
            <h2 className="text-lg font-semibold">
              {read.passage.reference}
              {read.passage.bible.abbreviation ? <span className="ml-2 text-sm font-normal text-muted-foreground">{read.passage.bible.abbreviation}</span> : null}
            </h2>
            <PassageVerses chapters={read.passage.chapters} className="text-base" />
            {read.passage.bible.copyright ? <p className="text-xs text-muted-foreground">{read.passage.bible.copyright}</p> : null}
          </article>
          <AddToSet bibleId={read.passage.bible.id} reference={read.passage.reference} />
        </>
      ) : null}
      {read?.kind === "youversion" ? (
        <article className="flex flex-col gap-3" data-testid="bible-passage">
          <h2 className="text-lg font-semibold">
            {read.passage.reference}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{read.passage.bible.abbreviation}</span>
          </h2>
          {read.passage.parts.map((part) => (
            <p key={part.id} className="leading-relaxed">
              {part.text}
            </p>
          ))}
          {/* YouVersion's attribution, shown with every passage. */}
          <p className="text-xs text-muted-foreground">{read.passage.bible.attribution}</p>
          {read.passage.bible.link ? (
            <a href={read.passage.bible.link} target="_blank" rel="noreferrer" className="text-xs underline">
              {t("bibles.readOnYouVersion")}
            </a>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("biblePage.youversionNotInSets")}</p>
        </article>
      ) : null}
    </div>
  );
}

/**
 * An imported Bible's passage, into one of the sets the reader can change:
 * the set keeps the reference, never the text, and the template the screens
 * show it with (issue #310), the last one picked on this device.
 */
function AddToSet({ bibleId, reference }: { bibleId: string; reference: string }) {
  const { t, i18n } = useTranslation();
  const [sets, setSets] = useState<SetlistSummary[] | null>(null);
  const [setId, setSetId] = useState("");
  const [template, setTemplate] = useState(storedTemplate);
  const [added, setAdded] = useState<SetlistSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiClient.listSetlists().then(
      (found) => {
        // The ones still to come first, the nearest at the top; past ones aren't offered.
        const mine = found.filter((set) => set.canEdit && !set.past).sort((a, b) => (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999"));
        setSets(mine);
        setSetId(mine[0]?.id ?? "");
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);
  useEffect(() => setAdded(null), [bibleId, reference]);

  if (sets && sets.length === 0) return null;
  return (
    <Card data-testid="bible-add-to-set">
      <CardHeader>
        <CardTitle className="text-sm">{t("biblePage.addToSet")}</CardTitle>
        <CardDescription>{t("biblePage.addToSetHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <PassageTemplateSelect
          id="bible-template"
          value={template}
          onChange={(picked) => {
            setTemplate(picked);
            store(TEMPLATE_KEY, JSON.stringify(picked));
            setAdded(null);
          }}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <Label htmlFor="bible-set">{t("biblePage.set")}</Label>
            <NativeSelect id="bible-set" value={setId} disabled={!sets} onChange={(event) => (setSetId(event.target.value), setAdded(null))}>
              {(sets ?? []).map((set) => (
                <option key={set.id} value={set.id}>
                  {setlistTitle(set, t, i18n.language)}
                  {set.teamName ? ` (${set.teamName})` : ""}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button
            disabled={busy || !setId}
            onClick={() => {
              setBusy(true);
              setError(null);
              void apiClient
                .addSetlistItem(setId, { passage: { bibleId, reference }, ...(template && { screenTemplate: template }) })
                .then(
                  () => setAdded(sets?.find((set) => set.id === setId) ?? null),
                  (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
                )
                .finally(() => setBusy(false));
            }}
            data-testid="bible-add"
          >
            {t("biblePage.add")}
          </Button>
        </div>
        {added ? (
          <p className="text-sm" data-testid="bible-added">
            {t("biblePage.added", { reference })}{" "}
            <Link to="/sets/$setlistId" params={{ setlistId: added.id }} className="underline">
              {setlistTitle(added, t, i18n.language)}
            </Link>
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
