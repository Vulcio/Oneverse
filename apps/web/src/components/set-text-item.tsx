import { SETLIST_TEXT_MAX, textSlides, type SetlistItemText } from "@oneverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";

/**
 * A set's text item (issue #305): its title and body, written here. The
 * body's paragraphs, split by a blank line, are its slides on the screens
 * (textSlides), shown as they're typed.
 */
export function TextItemDialog({
  open,
  onOpenChange,
  text,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item's, to change; null for a new one. */
  text: SetlistItemText | null;
  onSave: (text: SetlistItemText) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(text?.title ?? "");
  const [body, setBody] = useState(text?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = body.trim() ? textSlides({ title, body }).length : 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: title.trim(), body });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="set-text-dialog">
        <DialogHeader>
          <DialogTitle>{text ? t("sets.text.dialogTitleEdit") : t("sets.text.dialogTitleNew")}</DialogTitle>
          <DialogDescription>{t("sets.text.addHint")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="set-text-title">{t("sets.text.title")}</Label>
            <Input id="set-text-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="set-text-body">{t("sets.text.body")}</Label>
            <Textarea id="set-text-body" value={body} rows={8} maxLength={SETLIST_TEXT_MAX} onChange={(event) => setBody(event.target.value)} />
            <p className="text-xs text-muted-foreground">
              {t("sets.text.bodyHint")}
              {count > 0 ? ` ${t("sets.text.slides", { count })}` : ""}
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={saving || !body.trim()}>
              {t("sets.text.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A text item's slides, one after the other, as a player reads them in the set or in Live. */
export function TextItemSlides({ text, className }: { text: SetlistItemText; className?: string }) {
  return (
    <div className={`flex flex-col gap-6 ${className ?? ""}`} data-testid="set-text-slides">
      {textSlides(text).map((slide) => (
        <p key={slide.passId} className="text-xl leading-relaxed whitespace-pre-line">
          {slide.lines.join("\n")}
        </p>
      ))}
    </div>
  );
}
