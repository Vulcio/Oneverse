import { CATALOG_ENTRY_FIELDS, compareEntryCodes, foldForSearch, formatDuration, type CatalogEntryFieldKey, type SongbookCatalogEntry } from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Columns3, Info, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { Input } from "@oneverse/ui/components/input";
import { apiClient } from "#/lib/api-client";
import { cn } from "@oneverse/ui/lib/utils";

const PAGE_SIZE = 100;
const COLUMNS_STORAGE_KEY = "songverse.catalog.columns";
/** Always shown; the rest can be switched on and off. */
const FIXED_COLUMNS: CatalogEntryFieldKey[] = ["entryCode", "title"];
const DEFAULT_COLUMNS: CatalogEntryFieldKey[] = ["entryCode", "title", "artist", "composer", "lyricist", "key", "tempo", "tags"];
const ALL_COLUMNS = CATALOG_ENTRY_FIELDS.map((field) => field.key);

const WIDTH: Partial<Record<CatalogEntryFieldKey, string>> = {
  entryCode: "w-20 min-w-20",
  title: "min-w-56",
  year: "w-20 min-w-20",
  key: "w-20 min-w-20",
  timeSignature: "w-20 min-w-20",
  tempo: "w-20 min-w-20",
  durationSeconds: "w-24 min-w-24",
  isrc: "min-w-36",
  ccli: "min-w-24",
  tags: "min-w-44",
  links: "min-w-64",
  notes: "min-w-64",
};

type Sort = { field: CatalogEntryFieldKey; direction: 1 | -1 };
type CellRef = { entryId: string; field: CatalogEntryFieldKey };

function loadColumns(): CatalogEntryFieldKey[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) ?? "null") as unknown;
    if (Array.isArray(saved)) {
      const valid = ALL_COLUMNS.filter((key) => saved.includes(key) || FIXED_COLUMNS.includes(key));
      if (valid.length > 0) return valid;
    }
  } catch {
    // No storage (private window, blocked site data): use the defaults.
  }
  return DEFAULT_COLUMNS;
}

function saveColumns(columns: CatalogEntryFieldKey[]) {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
  } catch {
    // Not remembered; fine.
  }
}


function editText(entry: SongbookCatalogEntry, field: CatalogEntryFieldKey): string {
  const value = entry[field];
  if (value === null) return "";
  if (field === "durationSeconds" && typeof value === "number") return formatDuration(value);
  return Array.isArray(value) ? value.join("; ") : String(value);
}

function compareEntries(a: SongbookCatalogEntry, b: SongbookCatalogEntry, { field, direction }: Sort): number {
  let result: number;
  if (field === "entryCode") {
    result = compareEntryCodes(a.entryCode, b.entryCode);
  } else if (field === "title") {
    result = (a.sortTitle ?? a.title).localeCompare(b.sortTitle ?? b.title, undefined, { sensitivity: "base" });
  } else {
    const x = editText(a, field);
    const y = editText(b, field);
    // Empty cells last, whichever the direction.
    if (!x || !y) return x === y ? compareEntryCodes(a.entryCode, b.entryCode) : x ? -1 : 1;
    result = typeof a[field] === "number" ? (a[field] as number) - (b[field] as number) : x.localeCompare(y, undefined, { numeric: true });
  }
  return result === 0 ? compareEntryCodes(a.entryCode, b.entryCode) : result * direction;
}

/** A catalogue's entries as a spreadsheet: search, sort, pick columns, and (for admins) edit cells in place. */
export function CatalogEntriesTable({
  catalogId,
  entries: initialEntries,
  canEdit,
  initialSearch,
  onOpen,
}: {
  catalogId: string;
  entries: SongbookCatalogEntry[];
  canEdit: boolean;
  initialSearch: string;
  /** Opens an entry's details (issue #210). */
  onOpen: (entryId: string) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState(initialEntries);
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState<Sort>({ field: "entryCode", direction: 1 });
  const [columns, setColumns] = useState<CatalogEntryFieldKey[]>(DEFAULT_COLUMNS);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => setEntries(initialEntries), [initialEntries]);
  useEffect(() => setSearch(initialSearch), [initialSearch]);
  // After hydration, so the server and first client render agree.
  useEffect(() => setColumns(loadColumns()), []);

  const visible = useMemo(() => {
    const query = foldForSearch(search.trim());
    const matching = query
      ? entries.filter((entry) => ALL_COLUMNS.some((field) => foldForSearch(editText(entry, field)).includes(query)))
      : entries;
    return [...matching].sort((a, b) => compareEntries(a, b, sort));
  }, [entries, search, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function toggleColumn(field: CatalogEntryFieldKey) {
    const next = columns.includes(field) ? columns.filter((key) => key !== field) : ALL_COLUMNS.filter((key) => key === field || columns.includes(key));
    setColumns(next);
    saveColumns(next);
  }

  function sortBy(field: CatalogEntryFieldKey) {
    setSort((current) => ({ field, direction: current.field === field ? (current.direction === 1 ? -1 : 1) : 1 }));
  }

  /** Saves one cell; resolves false (and shows why) when the server refuses it. */
  async function saveCell(entry: SongbookCatalogEntry, field: CatalogEntryFieldKey, text: string): Promise<boolean> {
    if (text.trim() === editText(entry, field)) return true;
    try {
      const updated = await apiClient.updateSongbookCatalogEntry(catalogId, entry.id, { [field]: text });
      setEntries((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setError(null);
      return true;
    } catch (err) {
      setError(t("songbookCatalog.cellSaveFailed", { message: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  }

  /** The next (or previous) editable cell, reading across then down the current page. */
  function neighbour(from: CellRef, step: 1 | -1): CellRef | null {
    const rowIndex = rows.findIndex((row) => row.id === from.entryId);
    const columnIndex = columns.indexOf(from.field) + step;
    if (columnIndex >= 0 && columnIndex < columns.length) return { entryId: from.entryId, field: columns[columnIndex]! };
    const nextRow = rows[rowIndex + step];
    if (!nextRow) return null;
    return { entryId: nextRow.id, field: columns[step === 1 ? 0 : columns.length - 1]! };
  }

  async function remove(entry: SongbookCatalogEntry) {
    try {
      await apiClient.removeSongbookCatalogEntry(catalogId, entry.id);
      setEntries((current) => current.filter((row) => row.id !== entry.id));
      setConfirmingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          placeholder={t("songbookCatalog.search")}
          aria-label={t("songbookCatalog.search")}
          className="max-w-xs"
        />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Columns3 />
              {t("songbookCatalog.columns")}
            </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            {CATALOG_ENTRY_FIELDS.filter((field) => !FIXED_COLUMNS.includes(field.key)).map((field) => (
              <DropdownMenuItem
                key={field.key}
                closeOnClick={false}
                onClick={() => toggleColumn(field.key)}
              >
                <Check className={columns.includes(field.key) ? "opacity-100" : "opacity-0"} />
                {t(`songbookCatalog.fields.${field.key}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {canEdit ? (
          <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
            <Plus />
            {t("songbookCatalog.newEntry")}
          </Button>
        ) : null}
        <Pager page={currentPage} pageCount={pageCount} total={visible.length} onPage={setPage} />
      </div>
      {canEdit ? <p className="text-xs text-muted-foreground">{t("songbookCatalog.editHint")}</p> : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="relative w-full overflow-x-auto rounded-md border">
        <table className="w-full text-sm" data-testid="catalog-entries">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((field) => (
                <th key={field} className={cn("px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground", WIDTH[field] ?? "min-w-32")}>
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => sortBy(field)}>
                    {t(`songbookCatalog.fields.${field}`)}
                    {sort.field === field ? sort.direction === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                  </button>
                </th>
              ))}
              <th className={canEdit ? "w-20" : "w-10"} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {adding ? (
              <NewEntryRow
                catalogId={catalogId}
                columnCount={columns.length + 1}
                onAdded={(entry) => {
                  setEntries((current) => [...current, entry]);
                  setAdding(false);
                  setError(null);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : null}
            {rows.length === 0 && !adding ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-2 py-8 text-center text-muted-foreground">
                  {entries.length === 0 ? t("songbookCatalog.noEntriesYet") : t("songbookCatalog.noMatches")}
                </td>
              </tr>
            ) : null}
            {rows.map((entry) => (
              <tr key={entry.id} className="border-t align-top hover:bg-muted/30" data-testid="catalog-entry-row">
                {columns.map((field) => (
                  <td key={field} className={cn("p-0", WIDTH[field] ?? "min-w-32")}>
                    {editing?.entryId === entry.id && editing.field === field ? (
                      <CellEditor
                        initial={editText(entry, field)}
                        label={t(`songbookCatalog.fields.${field}`)}
                        onCancel={() => {
                          setEditing(null);
                          setError(null);
                        }}
                        onCommit={async (text, move) => {
                          if (!(await saveCell(entry, field, text))) return;
                          const next = move ? neighbour({ entryId: entry.id, field }, move) : null;
                          // Leaving by clicking another cell has already moved editing there.
                          setEditing((current) => (current?.entryId === entry.id && current.field === field ? next : current));
                        }}
                      />
                    ) : (
                      <CellView entry={entry} field={field} editable={canEdit} onEdit={() => setEditing({ entryId: entry.id, field })} />
                    )}
                  </td>
                ))}
                <td className="p-1 text-right whitespace-nowrap">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={t("songbookCatalog.openEntry", { code: entry.entryCode })}
                    onClick={() => onOpen(entry.id)}
                  >
                    <Info />
                  </Button>
                  {!canEdit ? null : confirmingDelete === entry.id ? (
                      <Button size="sm" variant="destructive" className="h-7" onClick={() => void remove(entry)} onBlur={() => setConfirmingDelete(null)} autoFocus>
                        {t("songbookCatalog.confirmDeleteEntry")}
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={t("songbookCatalog.deleteEntry", { code: entry.entryCode })}
                        onClick={() => setConfirmingDelete(entry.id)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <div className="flex justify-end">
          <Pager page={currentPage} pageCount={pageCount} total={visible.length} onPage={setPage} />
        </div>
      ) : null}
    </div>
  );
}

function Pager({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (page: number) => void }) {
  const { t, i18n } = useTranslation();
  const format = (n: number) => n.toLocaleString(i18n.language);
  return (
    <div className="ml-auto flex items-center gap-1 text-sm text-muted-foreground">
      <span className="tabular-nums">
        {t("songbookCatalog.showing", {
          from: format(total === 0 ? 0 : page * PAGE_SIZE + 1),
          to: format(Math.min(total, (page + 1) * PAGE_SIZE)),
          total: format(total),
        })}
      </span>
      {pageCount > 1 ? (
        <>
          <Button size="icon" variant="ghost" className="size-8" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={t("songbookCatalog.previousPage")}>
            <ChevronLeft />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(page + 1)}
            aria-label={t("songbookCatalog.nextPage")}
          >
            <ChevronRight />
          </Button>
        </>
      ) : null}
    </div>
  );
}

function CellView({
  entry,
  field,
  editable,
  onEdit,
}: {
  entry: SongbookCatalogEntry;
  field: CatalogEntryFieldKey;
  editable: boolean;
  onEdit: () => void;
}) {
  const value = entry[field];
  let content: ReactNode = editText(entry, field);
  if (field === "tags" && entry.tags.length > 0) {
    content = (
      <span className="flex flex-wrap gap-1">
        {entry.tags.map((tag) => (
          <Badge key={tag} variant="muted">
            {tag}
          </Badge>
        ))}
      </span>
    );
  } else if (field === "originalSong" && entry.original) {
    const original = entry.original;
    content = (
      <Link
        to="/songbook-catalogs/$catalogId"
        params={{ catalogId: original.catalogId }}
        search={{ q: original.entryCode }}
        className="text-primary hover:underline"
        title={`${original.catalogName} ${original.entryCode}: ${original.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        {entry.originalSong}
      </Link>
    );
  } else if (field === "entryCode") {
    content = <span className="font-medium tabular-nums">{entry.entryCode}</span>;
  }

  const text = typeof content === "string" ? content : null;
  const className = cn("block min-h-8 w-full px-2 py-1.5 text-left", text !== null && field !== "notes" && "truncate", field === "notes" && "line-clamp-2");
  if (!editable) {
    return (
      <div className={className} title={text ?? undefined} data-field={field}>
        {content}
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(className, "cursor-text hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring")}
      title={text ?? undefined}
      data-field={field}
      data-empty={value === null || (Array.isArray(value) && value.length === 0) ? "" : undefined}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          onEdit();
        }
      }}
    >
      {content}
    </div>
  );
}

function CellEditor({
  initial,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  /** `move` is where to go next: the next cell (Tab), previous (Shift+Tab), or none (Enter, or leaving the cell). */
  onCommit: (text: string, move: 1 | -1 | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  async function commit(move: 1 | -1 | null) {
    if (saving) return;
    setSaving(true);
    done.current = true;
    await onCommit(text, move);
    // Still mounted means the save was refused: keep editing.
    done.current = false;
    setSaving(false);
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit(null);
    } else if (event.key === "Tab") {
      event.preventDefault();
      void commit(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      done.current = true;
      onCancel();
    }
  }

  return (
    <input
      ref={input}
      value={text}
      aria-label={label}
      disabled={saving}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (!done.current) void commit(null);
      }}
      className="h-full min-h-8 w-full bg-background px-2 py-1.5 text-sm outline-2 -outline-offset-2 outline-primary"
    />
  );
}

function NewEntryRow({
  catalogId,
  columnCount,
  onAdded,
  onCancel,
}: {
  catalogId: string;
  columnCount: number;
  onAdded: (entry: SongbookCatalogEntry) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [entryCode, setEntryCode] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!entryCode.trim() || !title.trim()) return;
    setPending(true);
    setError(null);
    try {
      onAdded(await apiClient.addSongbookCatalogEntry(catalogId, { entryCode: entryCode.trim(), title: title.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void add();
    } else if (event.key === "Escape") {
      onCancel();
    }
  };

  return (
    <tr className="border-t bg-primary/5" data-testid="catalog-new-entry">
      <td colSpan={columnCount} className="p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={entryCode}
            onChange={(event) => setEntryCode(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("songbookCatalog.fields.entryCode")}
            aria-label={t("songbookCatalog.fields.entryCode")}
            className="h-8 w-24"
          />
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("songbookCatalog.fields.title")}
            aria-label={t("songbookCatalog.fields.title")}
            className="h-8 min-w-48 flex-1"
          />
          <Button size="sm" onClick={() => void add()} disabled={pending || !entryCode.trim() || !title.trim()}>
            {t("songbookCatalog.newEntry")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t("songbookCatalog.cancel")}
          </Button>
        </div>
        {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
      </td>
    </tr>
  );
}
