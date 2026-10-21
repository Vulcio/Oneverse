import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import type { ColumnPrefs, LibraryColumn } from "./-columns";

const LABELS: Record<LibraryColumn, string> = {
  artist: "library.columnArtist",
  language: "library.columnLanguage",
  publicationState: "library.columnStatus",
  tags: "library.columnTags",
  updatedAt: "library.columnUpdated",
  createdAt: "library.columnAdded",
  ccli: "library.columnCcli",
};

/** The Songs list's columns (issue #150): each shown or not, moved earlier or later; Title stays first. */
export function ColumnsMenu({ prefs, onChange }: { prefs: ColumnPrefs; onChange: (next: ColumnPrefs) => void }) {
  const { t } = useTranslation();
  const move = (index: number, by: -1 | 1) => {
    const columns = [...prefs.columns];
    const [column] = columns.splice(index, 1);
    columns.splice(index + by, 0, column!);
    onChange({ columns });
  };
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="outline" data-testid="library-columns" />}>
        <Columns3 />
        {t("library.columns")}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">{t("library.columnsHint")}</p>
        <ul className="flex flex-col" data-testid="library-columns-list">
          {prefs.columns.map((column, index) => {
            const label = t(LABELS[column.id]);
            return (
              <li key={column.id} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-accent" data-column={column.id}>
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={column.shown}
                    onChange={(event) => onChange({ columns: prefs.columns.map((other) => (other.id === column.id ? { ...other, shown: event.target.checked } : other)) })}
                  />
                  <span className="truncate">{label}</span>
                </label>
                <Button type="button" variant="ghost" size="icon" className="size-7" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("library.columnEarlier", { column: label })}>
                  <ArrowUp />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-7" disabled={index === prefs.columns.length - 1} onClick={() => move(index, 1)} aria-label={t("library.columnLater", { column: label })}>
                  <ArrowDown />
                </Button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
