import type { AdminBible, BiblePassage } from "@oneverse/core";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { Field, Said, useAction } from "./-metadata-providers";

const RIGHTS = [
  ["canProject", "projection"],
  ["canOffline", "offline"],
  ["canExport", "export"],
] as const;

/**
 * Bibles imported from files (issue #301): Zefania, Beblia, OSIS or
 * json-bible, converted by the Worker. Each one's name, abbreviation and
 * copyright line, and what its licence lets it be used for, all off until
 * the admin ticks them.
 */
export function ImportedBiblesCard({ initial }: { initial: AdminBible[] }) {
  const { t } = useTranslation();
  const [bibles, setBibles] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const { busy, message, run } = useAction();
  const importing = bibles.some((bible) => bible.status === "IMPORTING");

  // Until the Worker has read every file.
  useEffect(() => {
    if (!importing) return;
    const timer = setInterval(() => void apiClient.listAdminBibles().then(setBibles, () => undefined), 2000);
    return () => clearInterval(timer);
  }, [importing]);

  const replace = (next: AdminBible) => setBibles((current) => current.map((bible) => (bible.id === next.id ? next : bible)));

  return (
    <Card data-testid="imported-bibles">
      <CardHeader>
        <CardTitle className="text-sm">{t("bibles.importedTitle")}</CardTitle>
        <CardDescription>{t("bibles.importedDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            className="hidden"
            accept=".xml,.osis,.json,application/xml,text/xml,application/json"
            data-testid="bible-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void run(async () => {
                const added = await apiClient.importBible(file, file.name);
                setBibles((current) => [added, ...current]);
                return t("bibles.importStarted", { name: file.name });
              });
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {t("bibles.importFile")}
          </Button>
        </div>
        <Said message={message} />
        {bibles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bibles.noImported")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {bibles.map((bible) => (
              <ImportedBibleRow key={bible.id} bible={bible} onChange={replace} onRemoved={() => setBibles((current) => current.filter((one) => one.id !== bible.id))} />
            ))}
          </ul>
        )}
        {bibles.some((bible) => bible.status === "READY") ? <TryImportedPassage bibles={bibles.filter((bible) => bible.status === "READY")} /> : null}
      </CardContent>
    </Card>
  );
}

function ImportedBibleRow({ bible, onChange, onRemoved }: { bible: AdminBible; onChange: (next: AdminBible) => void; onRemoved: () => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(bible.name);
  const [abbreviation, setAbbreviation] = useState(bible.abbreviation ?? "");
  const [copyright, setCopyright] = useState(bible.copyright ?? "");
  const { busy, message, run } = useAction();
  const ready = bible.status === "READY";
  const edit = () => {
    setName(bible.name);
    setAbbreviation(bible.abbreviation ?? "");
    setCopyright(bible.copyright ?? "");
    setEditing(true);
  };
  return (
    <li className="flex flex-col gap-3 p-3" data-testid="imported-bible" data-status={bible.status.toLowerCase()}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {bible.name}
            {bible.abbreviation ? <span className="text-muted-foreground"> ({bible.abbreviation})</span> : null}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="imported-bible-status">
            {bible.status === "IMPORTING"
              ? t("bibles.statusImporting")
              : bible.status === "FAILED"
                ? t("bibles.statusFailed", { error: bible.error ?? "" })
                : t("bibles.statusReady", { books: bible.books.length, verses: bible.verseCount, format: bible.sourceFormat ?? "" })}
          </p>
          {ready ? <p className="text-xs text-muted-foreground">{bible.copyright || t("bibles.noCopyright")}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {ready && !editing ? (
            <Button variant="outline" size="sm" onClick={edit}>
              {t("bibles.edit")}
            </Button>
          ) : null}
          <ConfirmButton
            label={t("bibles.delete")}
            confirmLabel={t("bibles.confirmDelete")}
            busyLabel={t("bibles.deleting")}
            cancelLabel={t("bibles.cancel")}
            busy={busy}
            onConfirm={() =>
              run(async () => {
                await apiClient.deleteBible(bible.id);
                onRemoved();
                return "";
              })
            }
          />
        </div>
      </div>
      {ready ? (
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1" disabled={busy}>
          <legend className="sr-only">{t("bibles.rights")}</legend>
          {RIGHTS.map(([field, right]) => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                data-testid={`bible-right-${right}`}
                checked={bible.rights[right]}
                onChange={(event) => void run(async () => (onChange(await apiClient.updateBible(bible.id, { [field]: event.target.checked })), ""))}
              />
              {t(`bibles.right_${right}`)}
            </label>
          ))}
        </fieldset>
      ) : null}
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Field id={`bible-name-${bible.id}`} label={t("bibles.name")}>
              <Input id={`bible-name-${bible.id}`} value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field id={`bible-abbreviation-${bible.id}`} label={t("bibles.abbreviation")}>
              <Input id={`bible-abbreviation-${bible.id}`} className="w-28" value={abbreviation} onChange={(event) => setAbbreviation(event.target.value)} />
            </Field>
          </div>
          <Field id={`bible-copyright-${bible.id}`} label={t("bibles.copyright")} hint={t("bibles.copyrightHint")}>
            <Textarea id={`bible-copyright-${bible.id}`} rows={2} value={copyright} onChange={(event) => setCopyright(event.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !name.trim()}
              onClick={() =>
                void run(async () => {
                  onChange(await apiClient.updateBible(bible.id, { name: name.trim(), abbreviation, copyright }));
                  setEditing(false);
                  return t("metadataProviders.saved");
                })
              }
            >
              {t("bibles.save")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              {t("bibles.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {message?.text ? <Said message={message} /> : null}
    </li>
  );
}

/** A passage of an imported Bible, as it reads, with its copyright line. */
function TryImportedPassage({ bibles }: { bibles: AdminBible[] }) {
  const { t } = useTranslation();
  const [bibleId, setBibleId] = useState(bibles[0]!.id);
  const [reference, setReference] = useState("");
  const [passage, setPassage] = useState<BiblePassage | null>(null);
  const { busy, message, run } = useAction();
  const chosen = bibles.some((bible) => bible.id === bibleId) ? bibleId : bibles[0]!.id;
  return (
    <div className="flex flex-col gap-3 border-t pt-4" data-testid="imported-try">
      <p className="text-sm font-medium">{t("bibles.tryTitle")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field id="imported-version" label={t("bibles.version")}>
          <NativeSelect id="imported-version" value={chosen} onChange={(event) => setBibleId(event.target.value)}>
            {bibles.map((bible) => (
              <option key={bible.id} value={bible.id}>
                {bible.abbreviation ? `${bible.abbreviation} - ${bible.name}` : bible.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="imported-reference" label={t("bibles.reference")}>
          <Input id="imported-reference" value={reference} placeholder={t("bibles.referencePlaceholder")} onChange={(event) => setReference(event.target.value)} />
        </Field>
        <Button
          size="sm"
          disabled={busy || !reference.trim()}
          onClick={() =>
            void run(async () => {
              setPassage(null);
              setPassage(await apiClient.getBiblePassage(chosen, reference.trim()));
              return "";
            })
          }
        >
          {t("bibles.read")}
        </Button>
      </div>
      {passage ? (
        <figure className="flex flex-col gap-2" data-testid="imported-passage">
          <figcaption className="text-sm font-medium">
            {passage.reference}
            {passage.bible.abbreviation ? ` (${passage.bible.abbreviation})` : ""}
          </figcaption>
          {passage.chapters.map((chapter) => (
            <p key={chapter.chapter} className="text-sm">
              {chapter.verses.map((verse) => (
                <span key={verse.number}>
                  <sup className="mr-0.5 text-muted-foreground">{verse.endNumber ? `${verse.number}-${verse.endNumber}` : verse.number}</sup>
                  {verse.text}{" "}
                </span>
              ))}
            </p>
          ))}
          {passage.bible.copyright ? <p className="text-xs text-muted-foreground">{passage.bible.copyright}</p> : null}
        </figure>
      ) : null}
      {message?.text ? <Said message={message} /> : null}
    </div>
  );
}
