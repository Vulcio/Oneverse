import type { BiblePassage, PassageChapter, SetItemPassage, SetlistItemPassageRef, SetlistItemScreenTemplate, YouVersionPassage } from "@oneverse/core";
import { passageCredit } from "@oneverse/screen/lib/set-items";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { PassagePicker } from "#/components/passage-picker";
import { PassageTemplateSelect, templateRef } from "#/components/passage-template-select";
import { apiClient } from "#/lib/api-client";
import { useBibleVersions, versionOfPassage } from "#/lib/bible-versions";

type Preview = { kind: "imported"; passage: BiblePassage } | { kind: "youversion"; passage: YouVersionPassage };

/**
 * A set's passage item (issue #301): a version - a Bible imported on the
 * server, or YouVersion's - and a reference, picked or typed as people write
 * it ("John 3:16-18", "Psaume 23,1-4"), read before it's kept - the set holds
 * the reference, never the text - and the template the screens show it with
 * (issue #310).
 */
export function PassageItemDialog({
  open,
  onOpenChange,
  passage,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item's, to change; null for a new one. */
  passage: SetItemPassage | null;
  onSave: (passage: SetlistItemPassageRef, screenTemplate: SetlistItemScreenTemplate | null) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const current = useMemo(() => (passage ? versionOfPassage(passage, i18n.language.startsWith("fr") ? "fr" : "en") : null), [passage, i18n.language]);
  const bible = useBibleVersions(current);
  const { version } = bible;
  const [reference, setReference] = useState(passage?.reference ?? "");
  const [template, setTemplate] = useState(() => templateRef(passage?.template));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = !!version && !!reference.trim();
  const shownError = error ?? bible.error;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="set-passage-dialog">
        <DialogHeader>
          <DialogTitle>{passage ? t("sets.passage.dialogTitleEdit") : t("sets.passage.dialogTitleNew")}</DialogTitle>
          <DialogDescription>{t("sets.passage.addHint")}</DialogDescription>
        </DialogHeader>
        {bible.none ? (
          <p className="text-sm text-muted-foreground" data-testid="set-passage-no-bibles">
            {t("sets.passage.noBibles")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Reading it previews it; Save keeps it. */}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!version) return;
                const text = reference.trim();
                void act(async () =>
                  setPreview(
                    version.kind === "youversion"
                      ? { kind: "youversion", passage: await apiClient.getYouVersionPassage(Number(version.id), text) }
                      : { kind: "imported", passage: await apiClient.getBiblePassage(version.id, text) },
                  ),
                );
              }}
            >
              <PassagePicker
                languages={bible.languages}
                language={bible.language}
                onLanguage={(tag) => (bible.setLanguage(tag), setPreview(null))}
                versions={bible.versions}
                version={version}
                onVersion={(picked) => (bible.setVersion(picked), setPreview(null))}
                reference={reference}
                onReference={(text) => (setReference(text), setPreview(null))}
                busy={busy}
              />
            </form>
            <PassageTemplateSelect id="set-passage-template" value={template} onChange={setTemplate} />
            {preview ? (
              <div className="max-h-60 overflow-y-auto rounded-md border p-3" data-testid="set-passage-preview">
                <p className="mb-2 text-sm font-medium">{preview.passage.reference}</p>
                {preview.kind === "imported" ? (
                  <>
                    <PassageVerses chapters={preview.passage.chapters} className="text-sm" />
                    {preview.passage.bible.copyright ? <p className="mt-2 text-xs text-muted-foreground">{preview.passage.bible.copyright}</p> : null}
                  </>
                ) : (
                  <>
                    {preview.passage.parts.map((part) => (
                      <p key={part.id} className="text-sm leading-relaxed">
                        {part.text}
                      </p>
                    ))}
                    <p className="mt-2 text-xs text-muted-foreground">{preview.passage.bible.attribution}</p>
                  </>
                )}
                {preview.passage.rights.projection ? null : <p className="mt-2 text-xs text-muted-foreground" data-testid="set-passage-not-projected">{t("sets.passage.notProjected")}</p>}
              </div>
            ) : null}
            {shownError ? (
              <p className="text-sm text-destructive" role="alert">
                {shownError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                disabled={busy || !ready}
                onClick={() => {
                  if (!version) return;
                  const text = reference.trim();
                  void act(async () => {
                    await onSave(version.kind === "youversion" ? { youversionId: Number(version.id), reference: text } : { bibleId: version.id, reference: text }, template);
                    onOpenChange(false);
                  });
                }}
                data-testid="set-passage-save"
              >
                {t("sets.passage.save")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A passage's verses, numbered, chapter by chapter. */
export function PassageVerses({ chapters, className }: { chapters: PassageChapter[]; className?: string }) {
  const many = chapters.length > 1;
  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      {chapters.map((chapter) => (
        <p key={chapter.chapter} className="leading-relaxed">
          {chapter.verses.map((verse) => (
            <span key={verse.number}>
              <sup className="mr-0.5 text-muted-foreground">
                {many ? `${chapter.chapter}:` : ""}
                {verse.endNumber ? `${verse.number}-${verse.endNumber}` : verse.number}
              </sup>
              {verse.text}{" "}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/**
 * A passage as a player reads it in the set or in Live (issue #301): its
 * verses with its Bible's copyright beneath - a YouVersion one's attribution
 * and link; why not, when it has none here (its Bible deleted, or not one to
 * keep offline).
 */
export function PassageReading({ passage, className }: { passage: SetItemPassage; className?: string }) {
  const { t } = useTranslation();
  const credit = passageCredit(passage);
  return (
    <div className={`flex flex-col gap-4 ${className ?? ""}`} data-testid="set-passage-reading">
      {passage.chapters.length > 0 ? (
        <PassageVerses chapters={passage.chapters} className="text-xl" />
      ) : (
        <p className="text-muted-foreground">{t(passage.bible ? "sets.passage.notHere" : "sets.passage.missing")}</p>
      )}
      {credit ? <p className="text-xs text-muted-foreground">{credit}</p> : null}
      {/* A YouVersion passage (issue #310) links to it there. */}
      {passage.link ? (
        <a href={passage.link} target="_blank" rel="noreferrer" className="text-xs underline">
          {t("bibles.readOnYouVersion")}
        </a>
      ) : null}
    </div>
  );
}
