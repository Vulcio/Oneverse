import {
  characterBoundaries,
  chordLineFromText,
  chordLineToText,
  generateId,
  ID_PREFIXES,
  layoutChordLine,
  placeChords,
  TRANSPOSE_STEP_OPTIONS,
  transposeChord,
  transposeKey,
  type ArrangementDetail,
  type ArrangementDocumentV2,
  type ArrangementItemV2,
  type OverrideV2,
  type SectionInstance,
  type SongDocumentV2,
  type SetlistSummary,
  type SongVersionDetail,
  passName,
  sectionNumbers,
} from "@oneverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Eye, EyeOff, MessageSquare, MoveHorizontal, Pencil, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { nameKeyChanges } from "#/components/song-editor/song-form";
import { SongOrder } from "#/components/song-editor/structured/song-order";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";
import { setlistTitle, transposeLabel } from "#/lib/setlists";
import { cn } from "@oneverse/ui/lib/utils";

type Item = ArrangementItemV2;
const CAPOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Editing an arrangement (docs/arrangement-document-v2.md): its order, key,
 * capo and tempo, and on each pass the song's chords replaced, moved or
 * hidden, lines hidden or their words changed, lines added, and notes
 * (#24) - the song itself never changes. Chords are shown and typed
 * in the key the pass is played in, and stored in the song's key.
 */
export function ArrangementEditor({
  initial,
  version,
  set,
}: {
  initial: ArrangementDetail;
  version: SongVersionDetail;
  /** The set it's for, when it's one song's own arrangement for a set. */
  set: Pick<SetlistSummary, "id" | "name" | "eventDate"> | null;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const song = version.documentJson;
  const [detail, setDetail] = useState(initial);
  const [doc, setDoc] = useState<ArrangementDocumentV2>(initial.document);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const readOnly = !detail.canEdit;
  const sectionIds = useMemo(() => new Set(song.sections.map((section) => section.id)), [song.sections]);
  const songKey = song.defaults.key ?? null;
  const steps = doc.defaults.transposeSteps ?? 0;
  const arrangementKey = songKey ? (transposeKey(songKey, steps) ?? songKey) : "";
  const dirty =
    JSON.stringify(doc) !== JSON.stringify(detail.document) || name.trim() !== detail.name || description.trim() !== (detail.description ?? "");

  function change(next: ArrangementDocumentV2) {
    setDoc(next);
    setMessage(null);
  }
  const setDefaults = (patch: Partial<ArrangementDocumentV2["defaults"]>) => change({ ...doc, defaults: { ...doc.defaults, ...patch } });
  const setItem = (next: Item) => change({ ...doc, items: doc.items.map((item) => (item.id === next.id ? next : item)) });

  async function run(action: () => Promise<ArrangementDetail>, done: string) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await action();
      setDetail(updated);
      setDoc(updated.document);
      setName(updated.name);
      setDescription(updated.description ?? "");
      setMessage({ kind: "ok", text: done });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }
  const save = () =>
    run(
      () => apiClient.updateArrangement(detail.id, { name: name.trim(), description: description.trim() || null, document: doc, updatedAt: detail.updatedAt }),
      t("arrangements.saved"),
    );

  // The key each pass is played in: the arrangement's, plus key changes so far.
  const passSteps = useMemo(() => {
    let current = steps;
    return doc.items.map((item) => (current += item.keyChange?.steps ?? 0));
  }, [doc.items, steps]);

  return (
    <div className="flex flex-col gap-6">
      {set ? (
        <Link
          to="/sets/$setlistId"
          params={{ setlistId: set.id }}
          className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {setlistTitle(set, t, i18n.language)}
        </Link>
      ) : (
        <Link
          to="/library/$songVersionId"
          params={{ songVersionId: version.id }}
          search={{ tab: "arrangements" }}
          className="flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {version.title}
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {readOnly ? (
            <h1 className="text-2xl font-semibold">{detail.name}</h1>
          ) : (
            <Input
              aria-label={t("arrangements.name")}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              className="h-10 max-w-md text-xl font-semibold"
            />
          )}
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {t("arrangements.of", { title: version.title })} ·{" "}
            {set ? t("arrangements.forSet", { set: setlistTitle(set, t, i18n.language) }) : (detail.teamName ?? t("arrangements.mine"))}
            {detail.isTeamDefault ? (
              <Badge variant="muted" className="gap-1">
                <Star className="size-3" aria-hidden />
                {t("arrangements.usual")}
              </Badge>
            ) : null}
          </p>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {detail.ownerScope === "TEAM" && !detail.setlistId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() =>
                  void run(
                    () => apiClient.updateArrangement(detail.id, { isTeamDefault: !detail.isTeamDefault, updatedAt: detail.updatedAt }),
                    detail.isTeamDefault ? t("arrangements.noLongerUsual") : t("arrangements.nowUsual", { team: detail.teamName }),
                  )
                }
              >
                <Star />
                {detail.isTeamDefault ? t("arrangements.unmarkUsual") : t("arrangements.markUsual", { team: detail.teamName })}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={!dirty || saving}
              onClick={() => {
                setDoc(detail.document);
                setName(detail.name);
                setDescription(detail.description ?? "");
                setMessage(null);
              }}
            >
              {t("arrangements.discard")}
            </Button>
            <Button type="button" disabled={!dirty || saving || !name.trim()} onClick={() => void save()}>
              {saving ? t("arrangements.saving") : t("arrangements.save")}
            </Button>
          </div>
        )}
        {message ? (
          <p className={cn("basis-full text-sm", message.kind === "error" ? "text-destructive" : "text-muted-foreground")} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        ) : null}
      </div>

      {detail.needsReview || detail.problems.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-4 text-sm" data-testid="review-banner">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 text-amber-600" aria-hidden />
            {detail.needsReview ? t("arrangements.reviewTitle") : t("arrangements.problemsTitle")}
          </p>
          <p className="text-muted-foreground">
            {detail.needsReview ? t("arrangements.reviewDescription") : null}
            {detail.needsReview && detail.problems.length > 0 ? " " : null}
            {detail.problems.length > 0 ? t("arrangements.problemsDescription", { count: detail.problems.length }) : null}
          </p>
          {readOnly || !detail.needsReview ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={saving || dirty}
              onClick={() => void run(() => apiClient.markArrangementReviewed(detail.id), t("arrangements.reviewed"))}
            >
              {t("arrangements.markReviewed")}
            </Button>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-sm">{t("arrangements.settings")}</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset disabled={readOnly} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="arrangement-key">{t("arrangements.key")}</Label>
                <NativeSelect
                  id="arrangement-key"
                  value={steps}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    const key = songKey ? (transposeKey(songKey, next) ?? songKey) : "";
                    change({ ...doc, defaults: { ...doc.defaults, transposeSteps: next }, items: nameKeyChanges(doc.items, key) as Item[] });
                  }}
                >
                  {TRANSPOSE_STEP_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {transposeLabel(songKey, option, t)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="arrangement-capo">{t("arrangements.capoLabel")}</Label>
                <NativeSelect id="arrangement-capo" value={doc.defaults.capo ?? 0} onChange={(event) => setDefaults({ capo: Number(event.target.value) || null })}>
                  {CAPOS.map((capo) => (
                    <option key={capo} value={capo}>
                      {capo ? t("arrangements.capo", { capo }) : t("arrangements.noCapo")}
                    </option>
                  ))}
                </NativeSelect>
                {!doc.defaults.capo && version.capo ? (
                  <p className="text-xs text-muted-foreground">{t("arrangements.songSuggestsCapo", { capo: version.capo })}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="arrangement-tempo">{t("arrangements.tempo")}</Label>
                <Input
                  id="arrangement-tempo"
                  type="number"
                  min={20}
                  max={400}
                  value={doc.defaults.tempo ?? ""}
                  placeholder={song.defaults.tempo ? String(song.defaults.tempo) : ""}
                  onChange={(event) => setDefaults({ tempo: event.target.value ? Number(event.target.value) : null })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="arrangement-description">{t("arrangements.descriptionLabel")}</Label>
                <Textarea id="arrangement-description" rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} />
              </div>
              {readOnly ? null : (
                <ConfirmButton
                  label={t("arrangements.delete")}
                  confirmLabel={t("arrangements.deleteConfirm")}
                  busyLabel={t("arrangements.deleting")}
                  cancelLabel={t("arrangements.cancel")}
                  onConfirm={async () => {
                    await apiClient.deleteArrangement(detail.id);
                    if (set) await navigate({ to: "/sets/$setlistId", params: { setlistId: set.id } });
                    else await navigate({ to: "/library/$songVersionId", params: { songVersionId: version.id }, search: { tab: "arrangements" } });
                  }}
                />
              )}
            </fieldset>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {readOnly ? null : (
            <SongOrder
              sections={song.sections}
              // Passes whose section was deleted from the song are kept (see PassEditor) but can't be reordered.
              flow={doc.items.filter((item) => sectionIds.has(item.sectionId))}
              onChange={(flow: SectionInstance[]) =>
                change({
                  ...doc,
                  items: [
                    ...(nameKeyChanges(flow, arrangementKey).map((item) => ({ overrides: [], ...item })) as Item[]),
                    ...doc.items.filter((item) => !sectionIds.has(item.sectionId)),
                  ],
                })
              }
              songKey={arrangementKey}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("arrangements.passes")}</CardTitle>
              <CardDescription>{readOnly ? t("arrangements.readOnly") : t("arrangements.passesHint")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {doc.items.map((item, i) => (
                <PassEditor
                  key={item.id}
                  item={item}
                  song={song}
                  steps={passSteps[i]!}
                  readOnly={readOnly}
                  onChange={setItem}
                  onRemove={() => change({ ...doc, items: doc.items.filter((other) => other.id !== item.id) })}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --- one pass

const without = (item: Item, drop: (override: OverrideV2) => boolean): OverrideV2[] => item.overrides.filter((override) => !drop(override));

type LyricOverride = Extract<OverrideV2, { type: "lyric" }>;
type InsertOverride = Extract<OverrideV2, { type: "insert_line" }>;

/** A line as this pass has it: the song's (its words perhaps changed), or one the version adds (#24). */
interface Row {
  id: string;
  kind: "lyric" | "note";
  text: string;
  chords: { id: string; at: number; raw: string }[];
  hidden: boolean;
  /** The song's line, for one of its own. */
  songLine: SongDocumentV2["sections"][number]["lines"][number] | null;
  lyric: LyricOverride | null;
  insert: InsertOverride | null;
}

/** The pass's lines in order, the way the chart draws them (hidden ones kept, struck through). */
function passRows(section: SongDocumentV2["sections"][number], item: Item): Row[] {
  const hidden = new Set(item.overrides.flatMap((o) => (o.type === "hide_line" ? [o.lineId] : [])));
  const rows: Row[] = section.lines.map((line) => {
    const lyric = item.overrides.find((o): o is LyricOverride => o.type === "lyric" && o.lineId === line.id) ?? null;
    return {
      id: line.id,
      kind: line.kind,
      text: lyric ? lyric.text : line.text,
      chords: lyric ? placeChords(line.chords, lyric.text, lyric.chordPositions) : line.chords,
      hidden: hidden.has(line.id),
      songLine: line,
      lyric,
      insert: null,
    };
  });
  for (const override of item.overrides) {
    if (override.type !== "insert_line") continue;
    const row: Row = { ...override.line, hidden: false, songLine: null, lyric: null, insert: override };
    if (override.afterLineId === null) rows.unshift(row);
    else {
      const at = rows.findIndex((candidate) => candidate.id === override.afterLineId);
      if (at >= 0) rows.splice(at + 1, 0, row);
    }
  }
  return rows;
}

/** A line's characters, each with where it starts (for placing a chord before it). */
function characters(text: string): { at: number; char: string }[] {
  const starts = [...characterBoundaries(text)].filter((at) => at < text.length).sort((a, b) => a - b);
  return starts.map((at, i) => ({ at, char: text.slice(at, starts[i + 1] ?? text.length) }));
}

/** What the pass editor is doing to a line: changing its words, or adding (or editing) a line. */
type Editing = { kind: "words"; lineId: string } | { kind: "add"; afterLineId: string | null } | { kind: "edit"; lineId: string } | null;

function PassEditor({
  item,
  song,
  steps,
  readOnly,
  onChange,
  onRemove,
}: {
  item: Item;
  song: SongDocumentV2;
  steps: number;
  readOnly: boolean;
  onChange: (item: Item) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [chord, setChord] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteLine, setNoteLine] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [lineDraft, setLineDraft] = useState("");
  const section = song.sections.find((candidate) => candidate.id === item.sectionId);
  if (!section) {
    // Its section was deleted from the song: shown until the owner removes the pass.
    return (
      <div data-pass-editor={item.id} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm">
        <AlertTriangle className="size-4 text-destructive" aria-hidden />
        <span className="flex-1">{t("arrangements.sectionGone")}</span>
        {readOnly ? null : (
          <Button type="button" size="sm" variant="outline" onClick={onRemove}>
            {t("arrangements.removePass")}
          </Button>
        )}
      </div>
    );
  }
  const songKey = song.defaults.key ?? null;
  const key = songKey ? (transposeKey(songKey, steps) ?? songKey) : null;
  const shown = (raw: string) => transposeChord(raw, steps, key);
  const rows = passRows(section, item);
  // Changes whose chord or line was deleted from the song since: listed, never dropped silently.
  const lineIds = new Set(rows.map((row) => row.id));
  const songLineIds = new Set(section.lines.map((line) => line.id));
  const chordIds = new Set(rows.flatMap((row) => [...(row.songLine?.chords ?? []), ...row.chords].map((c) => c.id)));
  const stale = item.overrides.filter((o) =>
    o.type === "chord" || o.type === "hide_chord"
      ? !chordIds.has(o.chordId)
      : o.type === "insert_line"
        ? !!o.afterLineId && !lineIds.has(o.afterLineId)
        : o.type === "lyric" || o.type === "hide_line"
          ? !songLineIds.has(o.lineId)
          : !lineIds.has(o.lineId),
  );
  const replaced = new Map(item.overrides.flatMap((o) => (o.type === "chord" ? [[o.chordId, o.raw] as const] : [])));
  const hiddenChords = new Set(item.overrides.flatMap((o) => (o.type === "hide_chord" ? [o.chordId] : [])));
  const notes = new Map(item.overrides.flatMap((o) => (o.type === "performance_note" ? [[o.lineId, o.note] as const] : [])));
  // Named by the one rule (issue #344): "Chorus", "Verse 2".
  const heading = passName(item, section, sectionNumbers(song.sections).get(section.id), (type) => t(`chart.sections.${type}`)) ?? "";
  const set = (overrides: OverrideV2[]) => onChange({ ...item, overrides });

  const selectedRow = chord ? rows.find((row) => row.chords.some((c) => c.id === chord)) : undefined;
  const selected = selectedRow?.chords.find((c) => c.id === chord) ?? null;
  function replaceChord(raw: string | null) {
    if (!selected) return;
    // Typed in the key this pass is played in; stored in the song's key.
    const stored = raw ? transposeChord(raw.trim(), -steps, songKey) : null;
    const rest = without(item, (o) => o.type === "chord" && o.chordId === selected.id);
    set(stored && stored !== selected.raw ? [...rest, { type: "chord", chordId: selected.id, raw: stored }] : rest);
    setChord(null);
  }

  // --- words, and added lines

  /** The song line's words on this pass, with its chords moved where `positions` says; as the song's, no change. */
  function setWords(row: Row, text: string, positions: Record<string, number>) {
    const line = row.songLine!;
    const moved = Object.fromEntries(
      Object.entries(positions).filter(([id, at]) => {
        const original = line.chords.find((c) => c.id === id);
        return original && at <= text.length && (text !== line.text || at !== original.at);
      }),
    );
    const rest = without(item, (o) => o.type === "lyric" && o.lineId === line.id);
    const lyric: LyricOverride = { type: "lyric", lineId: line.id, text, ...(Object.keys(moved).length > 0 ? { chordPositions: moved } : {}) };
    set(text === line.text && Object.keys(moved).length === 0 ? rest : [...rest, lyric]);
  }

  function replaceInsert(old: InsertOverride, next: InsertOverride | null) {
    const kept = next ? new Set(next.line.chords.map((c) => c.id)) : new Set<string>();
    const gone = old.line.chords.map((c) => c.id).filter((id) => !kept.has(id));
    set(
      item.overrides.flatMap((o): OverrideV2[] => {
        if (o === old) return next ? [next] : [];
        if ((o.type === "chord" || o.type === "hide_chord") && gone.includes(o.chordId)) return [];
        if (!next && o.type === "performance_note" && o.lineId === old.line.id) return [];
        // A line added after the removed one now follows what it followed.
        if (!next && o.type === "insert_line" && o.afterLineId === old.line.id) return [{ ...o, afterLineId: old.afterLineId }];
        return [o];
      }),
    );
  }

  function saveLine(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (editing.kind === "words") {
      const row = rows.find((candidate) => candidate.id === editing.lineId);
      if (row?.songLine) setWords(row, lineDraft, row.lyric?.chordPositions ?? {});
    } else if (editing.kind === "add") {
      const parsed = chordLineFromText(lineDraft);
      if (parsed.text.trim() || parsed.chords.length > 0) {
        const line = { id: generateId(ID_PREFIXES.insertedLine), kind: "lyric" as const, ...parsed };
        set([...item.overrides, { type: "insert_line", afterLineId: editing.afterLineId, line }]);
      }
    } else {
      const row = rows.find((candidate) => candidate.id === editing.lineId);
      if (row?.insert) {
        const parsed = chordLineFromText(lineDraft, row.insert.line.chords);
        if (parsed.text.trim() || parsed.chords.length > 0) replaceInsert(row.insert, { ...row.insert, line: { ...row.insert.line, ...parsed } });
      }
    }
    setEditing(null);
  }

  function startEditing(next: Editing, text: string) {
    setChord(null);
    setNoteLine(null);
    setEditing(next);
    setLineDraft(text);
  }

  /** Puts the selected chord before character `at` (at the end with the line's length). */
  function moveChord(at: number) {
    if (!selected || !selectedRow) return;
    if (selectedRow.insert) {
      const chords = selectedRow.insert.line.chords.map((c) => (c.id === selected.id ? { ...c, at } : c)).sort((a, b) => a.at - b.at);
      replaceInsert(selectedRow.insert, { ...selectedRow.insert, line: { ...selectedRow.insert.line, chords } });
    } else {
      setWords(selectedRow, selectedRow.text, { ...selectedRow.lyric?.chordPositions, [selected.id]: at });
    }
    setMoving(false);
    setChord(null);
  }

  const lineForm = editing ? (
    <form className="my-1 flex flex-wrap items-center gap-1.5 font-sans" onSubmit={saveLine} data-testid="line-form">
      <Input
        aria-label={editing.kind === "words" ? t("arrangements.wordsOnPass") : t("arrangements.newLine")}
        value={lineDraft}
        maxLength={2000}
        placeholder={editing.kind === "words" ? undefined : t("arrangements.newLinePlaceholder")}
        onChange={(event) => setLineDraft(event.target.value)}
        className="h-8 min-w-0 flex-1 font-mono"
        autoFocus
      />
      <Button type="submit" size="sm" variant="outline">
        {editing.kind === "words" ? t("arrangements.setWords") : editing.kind === "add" ? t("arrangements.addLine") : t("arrangements.saveLine")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
        {t("arrangements.cancel")}
      </Button>
      {editing.kind === "words" ? null : <p className="w-full text-xs text-muted-foreground">{t("arrangements.newLineHint")}</p>}
    </form>
  ) : null;

  const iconButton = (label: string, onClick: () => void, icon: React.ReactNode) => (
    <button type="button" className="rounded p-1 hover:bg-muted" aria-label={label} title={label} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <div data-pass-editor={item.id} className={cn(item.overrides.length > 0 && "-ml-3 border-l-2 border-amber-500/70 pl-2.5")}>
      <p className="mb-1 flex flex-wrap items-baseline gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <span>{heading}</span>
        {item.keyChange ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary normal-case">{t("chart.keyChange", { key: key ?? item.keyChange.key })}</span> : null}
        {item.overrides.length > 0 ? <span className="font-normal text-amber-700 normal-case dark:text-amber-400">{t("chart.differs")}</span> : null}
        {readOnly ? null : (
          <button
            type="button"
            className="ml-auto flex items-center gap-1 font-normal normal-case hover:text-foreground"
            onClick={() => startEditing({ kind: "add", afterLineId: null }, "")}
          >
            <Plus className="size-3" />
            {t("arrangements.addLineStart")}
          </button>
        )}
      </p>
      {item.note ? <p className="mb-1 text-xs text-muted-foreground italic">{item.note}</p> : null}
      <div className="flex flex-col gap-1 font-mono text-sm">
        {editing?.kind === "add" && editing.afterLineId === null ? lineForm : null}
        {rows.map((row) => {
          const words = layoutChordLine(
            row.text,
            row.chords.map((c) => ({ at: c.at, id: c.id, label: shown(replaced.get(c.id) ?? c.raw) })),
          );
          const editingThis = editing && editing.kind !== "add" && editing.lineId === row.id;
          return (
            <Fragment key={row.id}>
              {editingThis ? (
                lineForm
              ) : (
                <div className="group flex items-start gap-1" data-line-id={row.id} data-added={row.insert ? "" : undefined}>
                  <p className={cn("min-w-0 flex-1", row.hidden && "text-muted-foreground line-through opacity-50")}>
                    {row.kind === "note" ? (
                      <span className="font-sans text-xs italic">{row.text}</span>
                    ) : (
                      words.map((word, w) => (
                        <Fragment key={w}>
                          {w > 0 ? "​" : null}
                          <span className="inline-flex whitespace-pre">
                            {word.map((cell, c) => {
                              const width = cell.chord ? cell.chord.length + 1 : 0;
                              return (
                                <span key={c} className="inline-flex flex-col" style={width ? { minWidth: `${width}ch` } : undefined}>
                                  <span className="font-bold text-primary">
                                    {cell.chords.length === 0
                                      ? " "
                                      : cell.chords.map((part, k) => (
                                          <Fragment key={part.id}>
                                            {k > 0 ? " " : null}
                                            <button
                                              type="button"
                                              disabled={readOnly || row.hidden}
                                              data-arr-chord={part.label}
                                              aria-pressed={chord === part.id}
                                              onClick={() => {
                                                setEditing(null);
                                                setMoving(false);
                                                setChord(chord === part.id ? null : part.id!);
                                                setDraft(part.label);
                                              }}
                                              className={cn(
                                                "rounded-sm enabled:hover:bg-primary/10",
                                                chord === part.id && "bg-primary text-primary-foreground",
                                                replaced.has(part.id!) && "underline decoration-amber-500 decoration-2",
                                                hiddenChords.has(part.id!) && "text-muted-foreground line-through opacity-50",
                                              )}
                                            >
                                              {part.label}
                                            </button>
                                          </Fragment>
                                        ))}
                                  </span>
                                  <span className={cn((row.insert || row.lyric) && "text-amber-800 dark:text-amber-300")}>{cell.text}</span>
                                </span>
                              );
                            })}
                          </span>
                        </Fragment>
                      ))
                    )}
                    {row.insert ? <span className="ml-2 font-sans text-xs text-amber-700 dark:text-amber-400">{t("arrangements.added")}</span> : null}
                    {row.lyric ? <span className="ml-2 font-sans text-xs text-amber-700 dark:text-amber-400">{t("arrangements.wordsChanged")}</span> : null}
                    {notes.get(row.id) ? <span className="ml-2 font-sans text-xs text-amber-700 italic dark:text-amber-400">{notes.get(row.id)}</span> : null}
                  </p>
                  {readOnly ? null : (
                    <span className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                      {row.insert ? (
                        <>
                          {iconButton(t("arrangements.editLine"), () => startEditing({ kind: "edit", lineId: row.id }, chordLineToText(row.insert!.line)), <Pencil className="size-3.5" />)}
                          {iconButton(t("arrangements.removeLine"), () => replaceInsert(row.insert!, null), <Trash2 className="size-3.5" />)}
                        </>
                      ) : (
                        <>
                          {iconButton(
                            row.hidden ? t("arrangements.showLine") : t("arrangements.hideLine"),
                            () =>
                              set(row.hidden ? without(item, (o) => o.type === "hide_line" && o.lineId === row.id) : [...item.overrides, { type: "hide_line", lineId: row.id }]),
                            row.hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />,
                          )}
                          {row.kind === "lyric" && !row.hidden
                            ? iconButton(t("arrangements.changeWords"), () => startEditing({ kind: "words", lineId: row.id }, row.text), <Pencil className="size-3.5" />)
                            : null}
                        </>
                      )}
                      {iconButton(
                        t("arrangements.lineNote"),
                        () => {
                          setEditing(null);
                          setNoteLine(noteLine === row.id ? null : row.id);
                          setNoteDraft(notes.get(row.id) ?? "");
                        },
                        <MessageSquare className="size-3.5" />,
                      )}
                      {iconButton(t("arrangements.addLineAfter"), () => startEditing({ kind: "add", afterLineId: row.id }, ""), <Plus className="size-3.5" />)}
                    </span>
                  )}
                </div>
              )}
              {editingThis && row.lyric ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-start font-sans"
                  onClick={() => {
                    set(without(item, (o) => o.type === "lyric" && o.lineId === row.id));
                    setEditing(null);
                  }}
                >
                  <RotateCcw />
                  {t("arrangements.songWords")}
                </Button>
              ) : null}
              {editing?.kind === "add" && editing.afterLineId === row.id ? lineForm : null}
            </Fragment>
          );
        })}
      </div>

      {stale.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 text-xs" data-testid="stale-changes">
          {stale.map((override, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-destructive">
              <AlertTriangle className="size-3" aria-hidden />
              <span>
                {override.type === "chord"
                  ? t("arrangements.stale.chord", { chord: shown(override.raw) })
                  : override.type === "hide_chord"
                    ? t("arrangements.stale.hideChord")
                    : override.type === "hide_line"
                      ? t("arrangements.stale.hideLine")
                      : override.type === "performance_note"
                        ? t("arrangements.stale.note", { note: override.note })
                        : override.type === "lyric"
                          ? t("arrangements.stale.lyric", { text: override.text })
                          : override.type === "insert_line"
                            ? t("arrangements.stale.insert", { text: override.line.text })
                            : t("arrangements.stale.other")}
              </span>
              {readOnly ? null : (
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2" onClick={() => set(item.overrides.filter((o) => o !== override))}>
                  {t("arrangements.removeChange")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {selected && selectedRow ? (
        <div className="mt-2 flex flex-col gap-2 rounded-md border p-2 text-sm" data-testid="chord-override">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("arrangements.chordOnPass", { chord: shown(selected.raw) })}</span>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                replaceChord(draft);
              }}
            >
              <Input
                aria-label={t("arrangements.replaceWith")}
                value={draft}
                maxLength={64}
                onChange={(event) => setDraft(event.target.value)}
                className="h-8 w-24 font-mono"
                autoFocus
              />
              <Button type="submit" size="sm" variant="outline">
                {t("arrangements.replace")}
              </Button>
            </form>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                const isHidden = hiddenChords.has(selected.id);
                set(isHidden ? without(item, (o) => o.type === "hide_chord" && o.chordId === selected.id) : [...item.overrides, { type: "hide_chord", chordId: selected.id }]);
                setChord(null);
              }}
            >
              {hiddenChords.has(selected.id) ? <Eye /> : <EyeOff />}
              {hiddenChords.has(selected.id) ? t("arrangements.showChord") : t("arrangements.hideChord")}
            </Button>
            {selectedRow.text.length > 0 ? (
              <Button type="button" size="sm" variant="ghost" aria-pressed={moving} onClick={() => setMoving(!moving)}>
                <MoveHorizontal />
                {t("arrangements.moveChord")}
              </Button>
            ) : null}
            {replaced.has(selected.id) ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => replaceChord(null)}>
                <RotateCcw />
                {t("arrangements.asInSong")}
              </Button>
            ) : null}
          </div>
          {moving ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t("arrangements.moveHint", { chord: shown(replaced.get(selected.id) ?? selected.raw) })}</span>
              <div className="flex flex-wrap font-mono" role="group" aria-label={t("arrangements.moveChord")} data-testid="chord-positions">
                {[...characters(selectedRow.text), { at: selectedRow.text.length, char: "⏎" }].map(({ at, char }) => (
                  <button
                    key={at}
                    type="button"
                    data-at={at}
                    aria-label={at === selectedRow.text.length ? t("arrangements.moveToEnd") : t("arrangements.moveBefore", { char })}
                    aria-pressed={at === selected.at}
                    onClick={() => moveChord(at)}
                    className={cn(
                      "min-w-[1ch] rounded-sm border-l-2 border-transparent whitespace-pre hover:border-primary hover:bg-primary/10",
                      at === selected.at && "border-primary bg-primary/10",
                      at === selectedRow.text.length && "px-1 text-muted-foreground",
                    )}
                  >
                    {char}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {noteLine ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const rest = without(item, (o) => o.type === "performance_note" && o.lineId === noteLine);
            set(noteDraft.trim() ? [...rest, { type: "performance_note", lineId: noteLine, note: noteDraft.trim() }] : rest);
            setNoteLine(null);
          }}
        >
          <Input
            aria-label={t("arrangements.lineNote")}
            value={noteDraft}
            maxLength={500}
            placeholder={t("arrangements.lineNotePlaceholder")}
            onChange={(event) => setNoteDraft(event.target.value)}
            className="h-8 max-w-sm"
            autoFocus
          />
          <Button type="submit" size="sm" variant="outline">
            {t("arrangements.setNote")}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
