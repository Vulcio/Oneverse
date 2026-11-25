import { ApiError, type ImportedBible, type SetlistDetail, type SetlistItem, type SetlistItemPassageRef, type SongVersionSummary, type YouVersionBible } from "@oneverse/core";
import { ArrowDown, ArrowUp, BookOpen, ExternalLink, Music, Plus, Search, Text, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { FieldError } from "@oneverse/ui/components/field";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { formatSetDate, formatSetDay } from "@oneverse/ui/lib/dates";
import { AskToEditSet, SetEditRequestsCard } from "../components/set-edit-requests";
import { TextItemDialog } from "../components/set-text-dialog";
import { HostLink, usePlanning } from "../host";

/**
 * A set's running order (issue #521), for those who plan a service rather
 * than play it - a host, a pastor: its songs, texts and passages in order,
 * added, moved and removed by those who edit it (issue #578's rule), and
 * kept the same as Songverse's set page while both are open. Practising,
 * charts and Live stay in Songverse, one click away.
 */
export function RunningOrderPage({ setlistId }: { setlistId: string }) {
  const { api, links, sets, watchSet } = usePlanning();
  const { t, i18n } = useTranslation();
  const [set, setSet] = useState<SetlistDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<"song" | "text" | "passage" | null>(null);

  const load = useCallback(async () => {
    try {
      setSet(await api.getSetlist(setlistId));
      setMissing(false);
    } catch (err) {
      if (err instanceof ApiError && [400, 403, 404].includes(err.status)) setMissing(true);
      else setError(err instanceof Error ? err.message : String(err));
    }
  }, [setlistId]);
  useEffect(() => {
    void load();
  }, [load]);
  // Changed elsewhere - Songverse, another device: read again.
  useEffect(() => watchSet?.(setlistId, () => void load()), [setlistId, load]);

  /** A change, its answer the set as it now is. */
  const change = async (work: () => Promise<SetlistDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setSet(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  if (missing) {
    return (
      <Card data-testid="running-order-missing">
        <CardHeader>
          <CardTitle>{t("sets.notFoundTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">{t("sets.notFoundDescription")}</p>
          <Button variant="outline" size="sm" render={<HostLink href={links.home} />}>
            {t("runningOrder.back")}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!set) return error ? <FieldError>{error}</FieldError> : null;

  const items = [...set.items].sort((a, b) => a.position - b.position);
  const move = (index: number, by: -1 | 1) => {
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    void change(() => api.reorderSetlistItems(set.id, ids));
  };
  const songverse = sets?.songverse?.(set.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="running-order" data-can-edit={set.canEdit}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("runningOrder.kicker")}</p>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="running-order-title">
            {setTitle(set, t("sets.untitled"), i18n.language)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[set.teamName ?? set.ownerName, t("runningOrder.count", { count: items.length })].filter(Boolean).join(" · ")}
          </p>
        </div>
        {songverse ? (
          <Button variant="outline" size="sm" render={<a href={songverse} />} data-testid="running-order-songverse">
            <ExternalLink />
            {t("runningOrder.openInSongverse")}
          </Button>
        ) : null}
      </header>

      {set.canAskToEdit ? <AskToEditSet setlistId={set.id} request={set.myEditRequest} onAsked={load} /> : null}
      {set.fromEvent && set.canEdit ? <SetEditRequestsCard setlistId={set.id} /> : null}

      <Card>
        <CardContent className="flex flex-col gap-1 p-2">
          {items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground" data-testid="running-order-empty">
              {set.canEdit ? t("runningOrder.emptyEditor") : t("runningOrder.empty")}
            </p>
          ) : (
            <ol className="flex flex-col">
              {items.map((item, index) => (
                <li key={item.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50" data-testid="running-order-item" data-kind={item.kind ?? "SONG"}>
                  <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{index + 1}</span>
                  <ItemIcon item={item} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium" data-testid="running-order-item-title">
                      {itemTitle(item, t("sets.text.untitled"), t("sets.hiddenSong"))}
                    </span>
                    {itemDetail(item) ? <span className="truncate text-xs text-muted-foreground">{itemDetail(item)}</span> : null}
                  </div>
                  {set.canEdit ? (
                    <div className="flex shrink-0 items-center">
                      <Button variant="ghost" size="icon" className="size-8" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={t("runningOrder.moveUp")} data-testid="running-order-up">
                        <ArrowUp />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" disabled={busy || index === items.length - 1} onClick={() => move(index, 1)} aria-label={t("runningOrder.moveDown")} data-testid="running-order-down">
                        <ArrowDown />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" disabled={busy} onClick={() => void change(() => api.removeSetlistItem(set.id, item.id))} aria-label={t("runningOrder.remove")} data-testid="running-order-remove">
                        <Trash2 />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {set.canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdding("song")} data-testid="running-order-add-song">
            <Music />
            {t("runningOrder.addSong")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAdding("text")} data-testid="running-order-add-text">
            <Text />
            {t("runningOrder.addText")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAdding("passage")} data-testid="running-order-add-passage">
            <BookOpen />
            {t("sets.passage.add")}
          </Button>
        </div>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}

      {adding === "song" ? <AddSongDialog set={set} onClose={() => setAdding(null)} onAdded={setSet} /> : null}
      {adding === "text" ? (
        <TextItemDialog
          open
          onOpenChange={(open) => !open && setAdding(null)}
          text={null}
          onSave={async (text) => setSet(await api.addSetlistItem(set.id, { text }))}
        />
      ) : null}
      {adding === "passage" ? (
        <AddPassageDialog onClose={() => setAdding(null)} onSave={async (passage) => setSet(await api.addSetlistItem(set.id, { passage }))} />
      ) : null}
    </div>
  );
}

/** As Songverse names a set: its name and date for a date's set, else its name, else its date. */
function setTitle(set: SetlistDetail, untitled: string, locale: string): string {
  if (set.name && set.fromEvent && set.eventDate) return `${set.name} - ${formatSetDay(set.eventDate, locale)}`;
  if (set.name) return set.name;
  if (set.eventDate) return formatSetDate(set.eventDate, locale, "long");
  return untitled;
}

function itemTitle(item: SetlistItem, untitledText: string, hidden: string): string {
  if (item.text) return item.text.title || untitledText;
  if (item.passage) return item.passage.bible?.abbreviation ? `${item.passage.reference} (${item.passage.bible.abbreviation})` : item.passage.reference;
  return item.song?.title ?? hidden;
}

/** A song's artists and key, a text's first line, a passage's Bible. */
function itemDetail(item: SetlistItem): string | null {
  if (item.text) return item.text.title ? (item.text.body.split("\n").find((line) => line.trim()) ?? null) : null;
  if (item.passage) return item.passage.bible?.name ?? null;
  if (!item.song) return null;
  return [item.song.artists?.join(", "), item.song.versionName, item.song.key].filter(Boolean).join(" · ") || null;
}

function ItemIcon({ item }: { item: SetlistItem }) {
  const Icon = item.text ? Text : item.passage ? BookOpen : Music;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * A song for the set: one the viewer can read that can go in it - their
 * library, their teams', the catalogue (the library's search with
 * `addableTo`). One's own personal song going into a team's set is shared
 * with the team, or moved to it (issue #331), as they choose.
 */
function AddSongDialog({ set, onClose, onAdded }: { set: SetlistDetail; onClose: () => void; onAdded: (set: SetlistDetail) => void }) {
  const { api } = usePlanning();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<SongVersionSummary[] | null>(null);
  const [asking, setAsking] = useState<SongVersionSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void api.listSongVersions({ q: query.trim() || undefined, addableTo: set.id, pageSize: 10, sort: "title" }).then(
        (page) => live && setFound(page.items),
        (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, set.id]);

  const add = async (song: SongVersionSummary, teamAccess?: "share" | "move") => {
    setBusy(true);
    setError(null);
    try {
      onAdded(await api.addSetlistItem(set.id, { songVersionId: song.id, ...(teamAccess && { teamAccess }) }));
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "SONG_NOT_SHARED") setAsking(song);
      else setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  const team = set.teamName ?? "";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="running-order-song-dialog">
        <DialogHeader>
          <DialogTitle>{asking ? t("sets.teamAccess.title", { song: asking.title, team }) : t("runningOrder.addSong")}</DialogTitle>
          <DialogDescription>{asking ? t("sets.teamAccess.description", { team }) : t("runningOrder.addSongHint")}</DialogDescription>
        </DialogHeader>
        {asking ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Button disabled={busy} onClick={() => void add(asking, "share")} data-testid="running-order-share">
                {t("sets.teamAccess.share", { team })}
              </Button>
              <p className="text-xs text-muted-foreground">{t("sets.teamAccess.shareHint")}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Button variant="outline" disabled={busy} onClick={() => void add(asking, "move")} data-testid="running-order-move">
                {t("sets.teamAccess.move", { team })}
              </Button>
              <p className="text-xs text-muted-foreground">{t("sets.teamAccess.moveHint")}</p>
            </div>
            <Button variant="ghost" className="self-end" onClick={() => setAsking(null)}>
              {t("sets.teamAccess.cancel")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                autoFocus
                className="pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("runningOrder.searchSongs")}
                aria-label={t("runningOrder.searchSongs")}
                data-testid="running-order-song-search"
              />
            </div>
            <ul className="flex max-h-80 flex-col overflow-y-auto">
              {found?.length === 0 ? <li className="p-2 text-sm text-muted-foreground">{t("runningOrder.noSongs")}</li> : null}
              {found?.map((song) => (
                <li key={song.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void add(song)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted disabled:opacity-50"
                    data-testid="running-order-song-result"
                  >
                    <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{song.title}</span>
                      {song.versionName ? <span className="truncate text-xs text-muted-foreground">{song.versionName}</span> : null}
                    </span>
                    {song.ownerScope === "GLOBAL" ? <Badge variant="muted">{t("sets.scopeGlobal")}</Badge> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error ? <FieldError>{error}</FieldError> : null}
      </DialogContent>
    </Dialog>
  );
}

type Version = { key: string; label: string; ref: (reference: string) => SetlistItemPassageRef };

/**
 * A passage for the set (issue #301): a version - a Bible imported on the
 * server, or one of YouVersion's in the reader's language - and a reference
 * as people write it ("John 3:16-18"). Songverse's dialog previews it and
 * picks its template; this one keeps it simple.
 */
function AddPassageDialog({ onClose, onSave }: { onClose: () => void; onSave: (passage: SetlistItemPassageRef) => Promise<void> }) {
  const { api } = usePlanning();
  const { t, i18n } = useTranslation();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [versionKey, setVersionKey] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const language = i18n.language.split("-")[0] || "en";
    void Promise.all([
      api.listBibles().catch((): ImportedBible[] => []),
      api.getScriptureProviders().then(
        (providers) => (providers.youversion ? api.getYouVersionBibles(language).catch((): YouVersionBible[] => []) : []),
        (): YouVersionBible[] => [],
      ),
    ]).then(([imported, youversion]) => {
      const listed: Version[] = [
        ...imported.map((bible) => ({ key: `imported:${bible.id}`, label: bible.abbreviation ? `${bible.name} (${bible.abbreviation})` : bible.name, ref: (text: string) => ({ bibleId: bible.id, reference: text }) })),
        ...youversion.map((bible) => ({ key: `youversion:${bible.id}`, label: `${bible.title} (${bible.abbreviation}) · YouVersion`, ref: (text: string) => ({ youversionId: bible.id, reference: text }) })),
      ];
      setVersions(listed);
      setVersionKey(listed[0]?.key ?? "");
    });
  }, []);

  const version = versions?.find((one) => one.key === versionKey);
  const save = async () => {
    if (!version || !reference.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(version.ref(reference.trim()));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="running-order-passage-dialog">
        <DialogHeader>
          <DialogTitle>{t("sets.passage.dialogTitleNew")}</DialogTitle>
          <DialogDescription>{t("sets.passage.addHint")}</DialogDescription>
        </DialogHeader>
        {versions?.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="running-order-no-bibles">
            {t("sets.passage.noBibles")}
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="running-order-version">{t("biblePage.version")}</Label>
              <NativeSelect id="running-order-version" value={versionKey} disabled={!versions} onChange={(event) => setVersionKey(event.target.value)} data-testid="running-order-version">
                {versions?.map((one) => (
                  <option key={one.key} value={one.key}>
                    {one.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="running-order-reference">{t("runningOrder.reference")}</Label>
              <Input id="running-order-reference" value={reference} placeholder={t("runningOrder.referencePlaceholder")} onChange={(event) => setReference(event.target.value)} data-testid="running-order-reference" />
            </div>
            {error ? <FieldError>{error}</FieldError> : null}
            <DialogFooter>
              <Button type="submit" disabled={busy || !version || !reference.trim()} data-testid="running-order-passage-save">
                {t("sets.passage.save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
