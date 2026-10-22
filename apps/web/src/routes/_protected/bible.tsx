import { readItemScreenTemplate, type BiblePassage, type SetlistItemPassageRef, type SetlistItemScreenTemplate, type SetlistSummary, type YouVersionPassage } from "@oneverse/core";
import { setlistTitle } from "@oneverse/screen/lib/set-items";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { PassagePicker } from "#/components/passage-picker";
import { PassageTemplateSelect } from "#/components/passage-template-select";
import { PassageVerses } from "#/components/set-passage-item";
import { apiClient } from "#/lib/api-client";
import { store, stored, useBibleVersions } from "#/lib/bible-versions";

export const Route = createFileRoute("/_protected/bible")({
  component: BiblePage,
});

/** The screen template last picked for a passage (issue #310), kept on this device. */
const TEMPLATE_KEY = "oneverse.bible.template";

function storedTemplate(): SetlistItemScreenTemplate | null {
  try {
    return readItemScreenTemplate(JSON.parse(stored(TEMPLATE_KEY) || "null"));
  } catch {
    return null;
  }
}

type Read = { kind: "imported"; passage: BiblePassage } | { kind: "youversion"; passage: YouVersionPassage };

/**
 * The Bible (issue #310), in the sidebar of the members of a team or an
 * organisation that turned it on: a version in the reader's language - one
 * imported on the server, or YouVersion's - or in any other, and a passage
 * picked or typed, read with its copyright line, and added to a set.
 */
function BiblePage() {
  const { t } = useTranslation();
  const bible = useBibleVersions();
  const { version } = bible;
  const [reference, setReference] = useState("");
  const [read, setRead] = useState<Read | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const shownError = error ?? bible.error;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6" data-testid="bible-page">
      <div>
        <h1 className="text-2xl font-semibold">{t("biblePage.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("biblePage.description")}</p>
      </div>
      {bible.none ? (
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
            languages={bible.languages}
            language={bible.language}
            onLanguage={(tag) => {
              bible.setLanguage(tag);
              setRead(null);
            }}
            versions={bible.versions}
            version={version}
            onVersion={(picked) => {
              bible.setVersion(picked);
              setRead(null);
            }}
            reference={reference}
            onReference={setReference}
            busy={busy}
          />
        </form>
      )}
      {shownError ? (
        <p className="text-sm text-destructive" role="alert">
          {shownError}
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
          <AddToSet passage={{ bibleId: read.passage.bible.id, reference: read.passage.reference }} />
        </>
      ) : null}
      {read?.kind === "youversion" ? (
        <>
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
          </article>
          <AddToSet passage={{ youversionId: read.passage.bible.id, reference: read.passage.reference }} />
        </>
      ) : null}
    </div>
  );
}

/**
 * A passage, into one of the sets the reader can change: the set keeps the
 * reference and its Bible or YouVersion version, never the text, and the
 * template the screens show it with (issue #310), the last one picked on
 * this device.
 */
function AddToSet({ passage }: { passage: SetlistItemPassageRef }) {
  const { t, i18n } = useTranslation();
  const { reference } = passage;
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
  useEffect(() => setAdded(null), [passage.bibleId, passage.youversionId, reference]);

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
                .addSetlistItem(setId, { passage, ...(template && { screenTemplate: template }) })
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
