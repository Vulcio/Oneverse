import type { BiblePassage, ImportedBible, PassageChapter, SetItemPassage, SetlistItemPassageRef } from "@oneverse/core";
import { passageCredit } from "@oneverse/screen/lib/set-items";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

/**
 * A set's passage item (issue #301): an imported Bible and a reference, as
 * people write it ("John 3:16-18", "Psaume 23,1-4"), read from the Bible
 * before it's kept - the set holds the reference, never the text.
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
  onSave: (passage: SetlistItemPassageRef) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [bibles, setBibles] = useState<ImportedBible[] | null>(null);
  const [bibleId, setBibleId] = useState(passage?.bibleId ?? "");
  const [reference, setReference] = useState(passage?.reference ?? "");
  const [preview, setPreview] = useState<BiblePassage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiClient.listBibles().then(
      (found) => {
        setBibles(found);
        setBibleId((current) => (found.some((bible) => bible.id === current) ? current : (found[0]?.id ?? "")));
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

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

  const ready = !!bibleId && !!reference.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="set-passage-dialog">
        <DialogHeader>
          <DialogTitle>{passage ? t("sets.passage.dialogTitleEdit") : t("sets.passage.dialogTitleNew")}</DialogTitle>
          <DialogDescription>{t("sets.passage.addHint")}</DialogDescription>
        </DialogHeader>
        {bibles && bibles.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="set-passage-no-bibles">
            {t("sets.passage.noBibles")}
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                await onSave({ bibleId, reference: reference.trim() });
                onOpenChange(false);
              });
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="set-passage-bible">{t("sets.passage.bible")}</Label>
              <NativeSelect id="set-passage-bible" value={bibleId} disabled={!bibles} onChange={(event) => (setBibleId(event.target.value), setPreview(null))}>
                {(bibles ?? []).map((bible) => (
                  <option key={bible.id} value={bible.id}>
                    {bible.abbreviation ? `${bible.abbreviation} - ${bible.name}` : bible.name}
                  </option>
                ))}
              </NativeSelect>
              {bibles?.find((bible) => bible.id === bibleId && !bible.rights.projection) ? <p className="text-xs text-muted-foreground">{t("sets.passage.notProjected")}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="set-passage-reference">{t("sets.passage.reference")}</Label>
              <div className="flex gap-2">
                <Input id="set-passage-reference" value={reference} maxLength={200} placeholder={t("bibles.referencePlaceholder")} onChange={(event) => (setReference(event.target.value), setPreview(null))} />
                <Button type="button" variant="outline" disabled={busy || !ready} onClick={() => void act(async () => setPreview(await apiClient.getBiblePassage(bibleId, reference.trim())))}>
                  {t("sets.passage.preview")}
                </Button>
              </div>
            </div>
            {preview ? (
              <div className="max-h-60 overflow-y-auto rounded-md border p-3" data-testid="set-passage-preview">
                <p className="mb-2 text-sm font-medium">{preview.reference}</p>
                <PassageVerses chapters={preview.chapters} className="text-sm" />
                {preview.bible.copyright ? <p className="mt-2 text-xs text-muted-foreground">{preview.bible.copyright}</p> : null}
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={busy || !ready}>
                {t("sets.passage.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A passage's verses, numbered, chapter by chapter. */
function PassageVerses({ chapters, className }: { chapters: PassageChapter[]; className?: string }) {
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
 * verses with its Bible's copyright beneath; why not, when it has none here
 * (its Bible deleted, or not one to keep offline).
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
    </div>
  );
}
