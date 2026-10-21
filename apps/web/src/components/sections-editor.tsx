import type { SongbookSection } from "@oneverse/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";

/**
 * A numbered book's printed volumes: number ranges with a label ("JEM1":
 * 1-371...), on a songbook (docs/songbooks-and-catalog.md §4) or a
 * catalogue (issue #55). Saved as a whole list; `onSave` throws with the
 * API's message (overlapping ranges, say).
 */
export function SectionsEditor({
  sections,
  canEdit,
  onSave,
  description,
  children,
}: {
  sections: SongbookSection[];
  canEdit: boolean;
  onSave: (next: SongbookSection[]) => Promise<void>;
  description?: string;
  /** Shown under the list: "Use the catalogue's volumes", say. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: SongbookSection[]) {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    const from = Number(start);
    const to = Number(end);
    if (!label.trim() || !Number.isInteger(from) || !Number.isInteger(to)) return;
    if (await save([...sections, { label: label.trim(), start: from, end: to }])) {
      setLabel("");
      setStart("");
      setEnd("");
    }
  }

  return (
    <Card data-testid="sections-editor">
      <CardHeader>
        <CardTitle className="text-sm">{t("songbooks.sections")}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("songbooks.noSectionsYet")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sections.map((section, index) => (
              <li key={`${section.label}-${index}`} className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{section.label}</span>{" "}
                  <span className="text-muted-foreground">
                    ({section.start}–{section.end})
                  </span>
                </span>
                {canEdit ? (
                  <Button variant="ghost" size="sm" onClick={() => void save(sections.filter((_, i) => i !== index))} disabled={saving}>
                    {t("songbooks.remove")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {children}
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("songbooks.sectionLabelPlaceholder")} className="w-28" aria-label={t("songbooks.sectionLabelPlaceholder")} />
            <Input type="number" value={start} onChange={(e) => setStart(e.target.value)} placeholder={t("songbooks.sectionStartPlaceholder")} className="w-24" aria-label={t("songbooks.sectionStartPlaceholder")} />
            <Input type="number" value={end} onChange={(e) => setEnd(e.target.value)} placeholder={t("songbooks.sectionEndPlaceholder")} className="w-24" aria-label={t("songbooks.sectionEndPlaceholder")} />
            <Button onClick={() => void add()} disabled={saving || !label.trim() || !start.trim() || !end.trim()}>
              {saving ? t("songbooks.saving") : t("songbooks.add")}
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
