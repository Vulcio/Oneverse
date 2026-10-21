import {
  NOTE_PRESETS,
  notePasses,
  prettyChord,
  shownNotes,
  type NoteAnchor,
  type NotePlaceChoice,
  type NoteColor,
  type NoteLook,
  type NoteShow,
  type NoteSize,
  type NoteStyle,
  type RenderedChart,
  type RenderedPass,
  type SongDocumentV2,
  type SongNote,
} from "@oneverse/core";
import { CheckCheck, CloudOff, MessageSquare, MessageSquarePlus, MoveUp, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@oneverse/ui/components/sheet";
import { Textarea } from "@oneverse/ui/components/textarea";
import { cn } from "@oneverse/ui/lib/utils";
import type { ChartNotesLayer, PassMarks } from "#/components/song-chart";
import { MARGIN_GAP, NotesOverlay, type OverlayLayout, type OverlayNote } from "#/components/notes-overlay";
import { noteBody, notePlace, useNewNotes, type NotesContext, type SongNotesState } from "#/lib/notes";
import { usePresence, useSongPresence } from "#/lib/live-notes";
import { PresenceChip } from "#/components/presence";
import { PersonAvatar } from "#/components/person-avatar";

/**
 * Notes on the chart (issue #256): placed where they're pinned - the song
 * above the chart, a section under its name, a line, chord or word under its
 * line, between sections after the first - with who wrote each and how many
 * replies. A tap opens its thread; press and hold (or right-click) adds one.
 */

type Note = SongNote & { pending?: true };

// Section types with a name of their own (as the chart says them).
const NAMED_SECTIONS = new Set(["intro", "verse", "pre-chorus", "chorus", "post-chorus", "bridge", "vamp", "breakdown", "instrumental", "interlude", "outro", "tag"]);

/** What a note is pinned to, in words ("On G7", "On “grace”", "After Chorus"). */
function useAnchorLabel(chart: RenderedChart, document: SongDocumentV2 | null) {
  const { t } = useTranslation();
  return (anchor: NoteAnchor): string => {
    if (anchor.kind === "song") return t("songNotes.on.song");
    const pass = anchor.passId ? chart.passes.find((one) => one.id === anchor.passId) : undefined;
    const sectionId = anchor.kind === "afterPass" ? pass?.section.id : anchor.sectionId;
    const somePass = pass ?? chart.passes.find((one) => one.section.id === sectionId);
    const section = somePass ? passName(somePass, t) : "";
    if (anchor.kind === "section") return t("songNotes.on.section", { section });
    if (anchor.kind === "afterPass") return t("songNotes.on.afterPass", { section });
    const line = document?.sections.flatMap((one) => one.lines).find((one) => one.id === anchor.lineId);
    const text = line?.text ?? "";
    if (anchor.kind === "chord") {
      const rendered = chart.passes.flatMap((one) => one.lines).find((one) => one.id === anchor.lineId)?.chords.find((chord) => chord.id === anchor.chordId);
      return t("songNotes.on.chord", { chord: prettyChord(rendered?.label ?? line?.chords.find((chord) => chord.id === anchor.chordId)?.raw ?? "") });
    }
    if (anchor.kind === "word") return t("songNotes.on.word", { word: wordAt(text, anchor.at) });
    return t(anchor.kind === "afterLine" ? "songNotes.on.afterLine" : "songNotes.on.line", { line: short(text) });
  };
}

function passName(pass: RenderedPass, t: (key: string) => string): string {
  return pass.label ?? pass.section.label ?? (NAMED_SECTIONS.has(pass.section.type) ? t(`chart.sections.${pass.section.type}`) : "");
}

/** The word (or syllable run) starting at `at`. */
function wordAt(text: string, at: number): string {
  return /^\S+/.exec(text.slice(at))?.[0] ?? short(text);
}

/** Where the word holding character `at` starts. */
export function wordStart(text: string, at: number): number {
  let start = Math.min(Math.max(at, 0), text.length);
  while (start > 0 && /\S/.test(text[start - 1]!)) start--;
  return start;
}

function short(text: string, max = 32): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A note on the chart: who wrote it, what it says, its replies; a tap opens it. */
/** Each colour's looks (issue #264): a card, a light tint, plain text; and its value, for marks and lines. */
const NOTE_COLOR_CLASSES: Record<NoteColor, Record<NoteLook, string> & { value: string }> = {
  amber: {
    card: "border-amber-300/70 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100 dark:hover:bg-amber-400/20",
    minimal: "bg-amber-100/80 text-amber-950 hover:bg-amber-200/80 dark:bg-amber-400/15 dark:text-amber-100",
    plain: "text-amber-700 hover:underline dark:text-amber-300",
    value: "#f59e0b",
  },
  blue: {
    card: "border-sky-300/70 bg-sky-50 text-sky-950 hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-100 dark:hover:bg-sky-400/20",
    minimal: "bg-sky-100/80 text-sky-950 hover:bg-sky-200/80 dark:bg-sky-400/15 dark:text-sky-100",
    plain: "text-sky-700 hover:underline dark:text-sky-300",
    value: "#0ea5e9",
  },
  green: {
    card: "border-emerald-300/70 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100 dark:hover:bg-emerald-400/20",
    minimal: "bg-emerald-100/80 text-emerald-950 hover:bg-emerald-200/80 dark:bg-emerald-400/15 dark:text-emerald-100",
    plain: "text-emerald-700 hover:underline dark:text-emerald-300",
    value: "#10b981",
  },
  pink: {
    card: "border-pink-300/70 bg-pink-50 text-pink-950 hover:bg-pink-100 dark:border-pink-400/30 dark:bg-pink-400/10 dark:text-pink-100 dark:hover:bg-pink-400/20",
    minimal: "bg-pink-100/80 text-pink-950 hover:bg-pink-200/80 dark:bg-pink-400/15 dark:text-pink-100",
    plain: "text-pink-700 hover:underline dark:text-pink-300",
    value: "#ec4899",
  },
  violet: {
    card: "border-violet-300/70 bg-violet-50 text-violet-950 hover:bg-violet-100 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-100 dark:hover:bg-violet-400/20",
    minimal: "bg-violet-100/80 text-violet-950 hover:bg-violet-200/80 dark:bg-violet-400/15 dark:text-violet-100",
    plain: "text-violet-700 hover:underline dark:text-violet-300",
    value: "#8b5cf6",
  },
  gray: {
    card: "border-zinc-300/70 bg-zinc-50 text-zinc-900 hover:bg-zinc-100 dark:border-zinc-400/30 dark:bg-zinc-400/10 dark:text-zinc-100 dark:hover:bg-zinc-400/20",
    minimal: "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-400/15 dark:text-zinc-100",
    plain: "text-zinc-600 hover:underline dark:text-zinc-300",
    value: "#71717a",
  },
};
const NOTE_SIZE_CLASSES: Record<NoteSize, string> = { S: "text-[0.7rem]", M: "text-xs", L: "text-base" };

/** A note's colour, for what it marks and the lines leading to it (issue #264). */
export const noteColorValue = (color: NoteColor) => NOTE_COLOR_CLASSES[color].value;

export function NoteChip({
  note,
  label,
  onOpen,
  isNew = false,
  look = "card",
  size = "M",
  color = "amber",
}: {
  note: Note;
  label?: string;
  onOpen: (noteId: string) => void;
  /** Written or replied to since one last opened the song (issue #27). */
  isNew?: boolean;
  /** How it looks (issue #264): a card with its writer's picture, a light tint, or its text alone. */
  look?: NoteLook;
  size?: NoteSize;
  color?: NoteColor;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => onOpen(note.id)}
      className={cn(
        "inline-flex max-w-full items-start gap-1.5 text-left font-sans leading-snug",
        NOTE_SIZE_CLASSES[size],
        NOTE_COLOR_CLASSES[color][look],
        look === "card" && "rounded-md border px-1.5 py-1",
        look === "minimal" && "rounded px-1.5 py-0.5",
        look === "plain" && "italic",
        look !== "plain" && "pointer-coarse:min-h-9 pointer-coarse:items-center",
        note.pending && "border-dashed opacity-80",
      )}
      data-note-look={look}
      title={note.placeName ?? undefined}
      aria-label={t("songNotes.open", { name: note.author.displayName, content: note.content })}
      data-note-id={note.id}
      data-note-place={note.place}
      data-note-new={isNew ? "" : undefined}
    >
      {look === "card" ? <PersonAvatar name={note.author.displayName} avatarUrl={note.author.avatarUrl} size={16} className="mt-px" /> : null}
      {isNew ? <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" role="img" aria-label={t("songNotes.new")} title={t("songNotes.new")} /> : null}
      {label ? <span className="shrink-0 font-semibold">{label}</span> : null}
      <span className="line-clamp-2 min-w-0 break-words whitespace-pre-wrap">{note.content}</span>
      {note.moved ? <MoveUp className="mt-px size-3 shrink-0 opacity-70" aria-label={t("songNotes.moved")} /> : null}
      {note.pending ? <CloudOff className="mt-px size-3 shrink-0 opacity-70" aria-label={t("songNotes.pending")} /> : null}
      {note.replies.length > 0 ? (
        <span className="ml-0.5 inline-flex shrink-0 items-center gap-0.5 tabular-nums opacity-80" data-note-replies={note.replies.length}>
          <MessageSquare className="size-3" aria-hidden />
          {note.replies.length}
        </span>
      ) : null}
    </button>
  );
}

function Chips({
  notes,
  labelOf,
  onOpen,
  isNew,
  style,
}: {
  notes: Note[];
  labelOf?: (note: Note) => string | undefined;
  onOpen: (noteId: string) => void;
  isNew?: (note: Note) => boolean;
  style?: NoteStyle;
}) {
  if (notes.length === 0) return null;
  return (
    <div className={cn("my-1 flex flex-wrap", style?.look === "plain" ? "gap-x-3 gap-y-0.5" : "gap-1")} data-notes="">
      {notes.map((note) => (
        <NoteChip key={note.id} note={note} label={labelOf?.(note)} onOpen={onOpen} isNew={isNew?.(note)} look={style?.look} size={style?.size} color={style?.color} />
      ))}
    </div>
  );
}

/**
 * Notes on a chart, for a page: what to draw where (the SongChart's layer),
 * the song's own notes for above it, and the dialogs to read, reply and add.
 */
export function useChartNotes({
  state,
  chart,
  document,
  show,
  context,
  openNoteId,
  marks = true,
  style = NOTE_PRESETS.standard,
}: {
  state: SongNotesState;
  chart: RenderedChart;
  document: SongDocumentV2 | null;
  /** The mode's Display setting: all notes, one's own, or none. */
  show: NoteShow;
  /** The mode's Display setting (issue #263): what each note is on, marked on the chart. */
  marks?: boolean;
  context: NotesContext;
  /** A note's thread to open first (a notification's link). */
  openNoteId?: string;
  /** The mode's Display settings (issue #264): where notes go, and how they look. */
  style?: NoteStyle;
}) {
  const [threadId, setThreadId] = useState<string | null>(openNoteId ?? null);
  // Beside or in the margin (issue #264): what the overlay measured - the room under lines, and the margin's width (none: beside instead).
  const [layout, setLayout] = useState<OverlayLayout>({ room: {}, margin: 0 });
  const [adding, setAdding] = useState<NoteAnchor | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const labelOf = useAnchorLabel(chart, document);
  const isNew = useNewNotes(context.songVersionId, state.me);

  const placed = useMemo(() => {
    const visible = shownNotes(
      state.notes.map((note) => ({ ...note, authorId: note.author.id })),
      show,
      state.me,
    );
    const top: Note[] = [];
    const section = new Map<string, Note[]>();
    const after = new Map<string, Note[]>();
    const lines = new Map<string, Note[]>();
    const chords = new Map<string, Set<string>>();
    // What each note is on, marked on the chart (issue #263): a word's characters, a line, a section.
    const words = new Map<string, [number, number][]>();
    // Beside or in the margin (issue #264): the notes on a chord, a word, a line or a section, placed by the overlay.
    const floating: { note: Note; passId: string }[] = [];
    const markedLines = new Set<string>();
    const sections = new Set<string>();
    const push = (map: Map<string, Note[]>, key: string, note: Note) => map.set(key, [...(map.get(key) ?? []), note]);
    const floats = (kind: NoteAnchor["kind"]) => style.placement !== "below" && (kind === "chord" || kind === "word" || kind === "line" || kind === "section");
    for (const note of visible) {
      const passes = notePasses(chart, note.anchor);
      if (passes.length === 0) top.push(note);
      for (const passId of passes) {
        const anchor = note.anchor;
        if (floats(anchor.kind)) floating.push({ note, passId });
        if (anchor.kind === "section") {
          push(section, passId, note);
          sections.add(passId);
        }
        else if (anchor.kind === "afterPass") push(after, passId, note);
        else if (anchor.kind !== "song") {
          push(lines, `${passId}|${anchor.lineId}`, note);
          if (anchor.kind === "chord") chords.set(passId, (chords.get(passId) ?? new Set()).add(anchor.chordId));
          if (anchor.kind === "line") markedLines.add(`${passId}|${anchor.lineId}`);
          if (anchor.kind === "word") {
            const text = chart.passes.find((pass) => pass.id === passId)?.lines.find((line) => line.id === anchor.lineId)?.text ?? "";
            const start = wordStart(text, anchor.at);
            const rest = text.slice(start).search(/\s/);
            const key = `${passId}|${anchor.lineId}`;
            words.set(key, [...(words.get(key) ?? []), [start, rest < 0 ? text.length : start + rest]]);
          }
        }
      }
    }
    return { top, section, after, lines, chords, words, markedLines, sections, floating };
  }, [state.notes, state.me, show, chart, style.placement]);

  const chipLabel = (note: Note) => (note.anchor.kind === "chord" || note.anchor.kind === "word" ? labelOf(note.anchor).replace(/^\S+\s/, "") : undefined);
  // Beside or in the margin, those notes are the overlay's; below, under what they're on.
  const floating = style.placement !== "below";
  const notFloating = (notes: Note[]) => (floating ? notes.filter((note) => !(note.anchor.kind === "chord" || note.anchor.kind === "word" || note.anchor.kind === "line" || note.anchor.kind === "section")) : notes);
  const overlayNotes = useMemo<OverlayNote[]>(
    () =>
      style.placement === "below"
        ? []
        : placed.floating.map(({ note, passId }) => ({
            id: `${passId}:${note.id}`,
            passId,
            anchor: note.anchor,
            node: <NoteChip note={note} onOpen={setThreadId} isNew={isNew(note)} look={style.look} size={style.size} color={style.color} />,
          })),
    [placed, style, isNew],
  );
  const layer: ChartNotesLayer = {
    section: (pass) => <Chips notes={notFloating(placed.section.get(pass.id) ?? [])} onOpen={setThreadId} isNew={isNew} style={style} />,
    afterPass: (pass) => <Chips notes={placed.after.get(pass.id) ?? []} onOpen={setThreadId} isNew={isNew} style={style} />,
    line: (pass, lineId) => <Chips notes={notFloating(placed.lines.get(`${pass.id}|${lineId}`) ?? [])} labelOf={chipLabel} onOpen={setThreadId} isNew={isNew} style={style} />,
    markColor: noteColorValue(style.color),
    ...(style.placement !== "below" && {
      overlay: (
        <NotesOverlay
          notes={overlayNotes}
          placement={style.placement}
          color={noteColorValue(style.color)}
          onLayout={setLayout}
        />
      ),
      lineRoom: (pass: RenderedPass, lineId: string) => layout.room[`${pass.id}|${lineId}`] ?? 0,
      reserveRight: layout.margin ? layout.margin + MARGIN_GAP : 0,
    }),
    ...(marks && {
      marks: (pass: RenderedPass): PassMarks => ({
        chords: placed.chords.get(pass.id) ?? EMPTY,
        section: placed.sections.has(pass.id),
        line: (lineId) => placed.markedLines.has(`${pass.id}|${lineId}`),
        words: (lineId) => placed.words.get(`${pass.id}|${lineId}`) ?? NO_RANGES,
      }),
    }),
    // A word: where it starts, so the note reads "On “grace”".
    onAdd: state.loaded
      ? (anchor) => {
          if (anchor.kind === "word") {
            const text = document?.sections.flatMap((one) => one.lines).find((line) => line.id === anchor.lineId)?.text ?? "";
            setAdding({ ...anchor, at: wordStart(text, anchor.at) });
          } else setAdding(anchor);
        }
      : undefined,
  };

  // A thread or the list open: someone else's changes come in at once (a reply at the thread's end), never held.
  const { incoming, showIncoming } = state;
  useEffect(() => {
    if (incoming && (threadId || listOpen)) showIncoming();
  }, [incoming, threadId, listOpen]);

  const thread = threadId ? (state.notes.find((note) => note.id === threadId) ?? null) : null;
  const dialogs = (
    <>
      {thread ? <ThreadDialog note={thread} state={state} context={context} label={labelOf(thread.anchor)} onClose={() => setThreadId(null)} /> : null}
      {adding ? <AddNoteDialog anchor={adding} chart={chart} state={state} context={context} label={labelOf(adding)} onClose={() => setAdding(null)} /> : null}
      <NotesSheet
        open={listOpen}
        onOpenChange={setListOpen}
        notes={state.notes}
        kept={state.kept}
        labelOf={labelOf}
        onOpen={(noteId) => {
          setListOpen(false);
          setThreadId(noteId);
        }}
        onAdd={
          state.loaded
            ? () => {
                setListOpen(false);
                setAdding({ kind: "song" });
              }
            : undefined
        }
      />
    </>
  );

  return {
    layer,
    /** The song's own notes (and those whose place this chart doesn't have), for above the chart. */
    top:
      placed.top.length > 0 ? (
        <div data-testid="song-notes-top">
          <Chips notes={placed.top} labelOf={(note) => (note.anchor.kind === "song" ? undefined : labelOf(note.anchor))} onOpen={setThreadId} isNew={isNew} style={style} />
        </div>
      ) : null,
    dialogs,
    /** The notes button for the page's header: every note, and adding one to the song. */
    button: <NotesButton count={state.notes.length} onClick={() => setListOpen(true)} />,
    /** Opens the list of every note (from a menu). */
    openList: () => setListOpen(true),
    /** Someone else's changes, held so nothing moves under the reader (Live): a quiet button to show them. */
    incoming: state.incoming ? <IncomingNotes onShow={state.showIncoming} /> : null,
  };
}

const EMPTY: ReadonlySet<string> = new Set();
const NO_RANGES: readonly (readonly [number, number])[] = [];

function IncomingNotes({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onShow}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-3 text-xs font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100"
      data-testid="notes-incoming"
    >
      <MessageSquare className="size-3.5" aria-hidden />
      {t("songNotes.changed")}
      <span className="font-semibold underline underline-offset-2">{t("songNotes.show")}</span>
    </button>
  );
}

function NotesButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" onClick={onClick} data-testid="notes-button" aria-label={t("songNotes.all")}>
      <MessageSquare />
      {count > 0 ? t("songNotes.button", { count }) : t("songNotes.title")}
    </Button>
  );
}

/** Every note one can see on the song (issue #104's "show all"), resolved ones too, whatever the Display settings show. */
function NotesSheet({
  open,
  onOpenChange,
  notes,
  kept,
  labelOf,
  onOpen,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: Note[];
  kept: boolean;
  labelOf: (anchor: NoteAnchor) => string;
  onOpen: (noteId: string) => void;
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md" data-testid="notes-sheet">
        <SheetHeader>
          <SheetTitle>{t("songNotes.all")}</SheetTitle>
          <SheetDescription>{t("songNotes.allHint")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {onAdd ? (
            <Button onClick={onAdd} className="self-start" data-testid="notes-add">
              <MessageSquarePlus />
              {t("songNotes.add")}
            </Button>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("songNotes.hint")}</p>
          {kept ? <p className="text-xs text-muted-foreground">{t("songNotes.keptOffline")}</p> : null}
          {notes.length === 0 ? <p className="text-sm text-muted-foreground">{t("songNotes.none")}</p> : null}
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => onOpen(note.id)}
                  className={cn("flex w-full flex-col gap-1 rounded-lg border p-3 text-left hover:bg-muted", note.resolved && "opacity-60")}
                  data-note-id={note.id}
                >
                  <span className="text-xs font-medium text-muted-foreground">{labelOf(note.anchor)}</span>
                  <span className="text-sm whitespace-pre-wrap">{note.content}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <PersonAvatar name={note.author.displayName} avatarUrl={note.author.avatarUrl} size={16} />
                    {t("songNotes.by", { name: note.author.displayName, place: placeLabel(note, t) })}
                    {note.replies.length > 0 ? <span>· {t("songNotes.replies", { count: note.replies.length })}</span> : null}
                    {note.resolved ? <span>· {t("songNotes.resolved")}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Where a note is saved, in words ("Morning Band", "Just me"). */
function placeLabel(note: Pick<SongNote, "place" | "placeName" | "placeId">, t: (key: string) => string): string {
  if (note.place === "ME") return note.placeId ? t("songNotes.places.ME_SET") : t("songNotes.places.ME");
  if (note.place === "SONG") return t("songNotes.places.SONG");
  return note.placeName ?? "";
}

/** A note and its replies: read, reply, and - its author or a moderator - edit, resolve, delete. */
function ThreadDialog({ note, state, context, label, onClose }: { note: Note; state: SongNotesState; context: NotesContext; label: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState<{ id: string | null; text: string } | null>(null);
  // Its author may move it somewhere else as they edit it (issue #262): who sees it changes with it.
  const moves = note.author.id === state.me && !note.pending;
  const places = useMemo(() => currentPlace(note, placeOptions(state.places, context.setlistId), context.setlistId), [note, state.places, context.setlistId]);
  const [placeKey, setPlaceKey] = useState(places.key);
  const saveEdit = (text: string) => {
    const moved = moves && placeKey !== places.key ? places.options.find((option) => option.key === placeKey) : undefined;
    return state.update(note.id, { content: text, ...(moved && notePlace(context, moved.choice, moved.onlyInSet)) });
  };
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });

  const act = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const offline = state.kept || note.pending;
  // Live (issue #27): "Ana is replying…" here, and the others told while one types a reply.
  usePresence(note.songVersionId, "replying", reply.trim() !== "" && !offline, note.id);
  const replying = useSongPresence(note.songVersionId, state.me).filter((person) => person.noteId === note.id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto sm:max-w-lg" data-testid="note-thread">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PersonAvatar name={note.author.displayName} avatarUrl={note.author.avatarUrl} size={24} />
            {note.author.displayName}
          </DialogTitle>
          <DialogDescription>
            {label} · {placeLabel(note, t)} · {when(note.createdAt)}
          </DialogDescription>
        </DialogHeader>
        {note.moved ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MoveUp className="size-3.5" aria-hidden />
            {t("songNotes.moved")}
          </p>
        ) : null}
        {editing?.id === note.id ? (
          <EditBox
            text={editing.text}
            onChange={(text) => setEditing({ id: note.id, text })}
            onCancel={() => setEditing(null)}
            onSave={() => void act(() => saveEdit(editing.text), () => setEditing(null))}
            busy={busy}
          >
            {moves ? <PlacePicker options={places.options} value={placeKey} onChange={setPlaceKey} testId="note-edit-places" /> : null}
          </EditBox>
        ) : (
          <p className={cn("text-sm whitespace-pre-wrap", note.resolved && "text-muted-foreground")} data-testid="note-content">
            {note.content}
          </p>
        )}
        {note.canEdit && !offline && editing?.id !== note.id ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPlaceKey(places.key);
                setEditing({ id: note.id, text: note.content });
              }}
              data-testid="note-edit"
            >
              <Pencil />
              {t("songNotes.edit")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => state.update(note.id, { resolved: !note.resolved }))} data-testid="note-resolve">
              {note.resolved ? <RotateCcw /> : <CheckCheck />}
              {note.resolved ? t("songNotes.reopen") : t("songNotes.resolve")}
            </Button>
            <span data-testid="note-delete">
              <ConfirmButton
                label={
                  <>
                    <Trash2 />
                    {t("songNotes.delete")}
                  </>
                }
                confirmLabel={t("songNotes.deleteNote")}
                busyLabel={t("songNotes.deleteNote")}
                cancelLabel={t("songNotes.cancel")}
                busy={busy}
                onConfirm={() => act(() => state.remove(note.id), onClose)}
              />
            </span>
          </div>
        ) : null}

        {note.replies.length > 0 ? (
          <ul className="flex flex-col gap-3 border-t pt-3" data-testid="note-replies">
            {note.replies.map((one) => (
              <li key={one.id} className="flex gap-2">
                <PersonAvatar name={one.author.displayName} avatarUrl={one.author.avatarUrl} size={20} className="mt-0.5" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{one.author.displayName}</span> · {when(one.createdAt)}
                  </span>
                  {editing?.id === one.id ? (
                    <EditBox
                      text={editing.text}
                      onChange={(text) => setEditing({ id: one.id, text })}
                      onCancel={() => setEditing(null)}
                      onSave={() => void act(() => state.updateReply(note.id, one.id, editing.text), () => setEditing(null))}
                      busy={busy}
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{one.content}</p>
                  )}
                  {one.canEdit && !offline && editing?.id !== one.id ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: one.id, text: one.content })}>
                        {t("songNotes.edit")}
                      </Button>
                      <ConfirmButton
                        label={t("songNotes.delete")}
                        confirmLabel={t("songNotes.deleteReply")}
                        busyLabel={t("songNotes.deleteReply")}
                        cancelLabel={t("songNotes.cancel")}
                        busy={busy}
                        onConfirm={() => act(() => state.removeReply(note.id, one.id))}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <PresenceChip people={replying} doing="replying" />
        {note.canReply && !offline ? (
          <form
            className="flex flex-col gap-2 border-t pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim()) void act(() => state.reply(note.id, reply.trim()), () => setReply(""));
            }}
          >
            <Textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={t("songNotes.replyPlaceholder")} rows={2} aria-label={t("songNotes.reply")} data-testid="note-reply-input" />
            <Button type="submit" size="sm" className="self-end" disabled={busy || !reply.trim()} data-testid="note-reply-send">
              {t("songNotes.send")}
            </Button>
          </form>
        ) : null}
        {offline ? <p className="text-xs text-muted-foreground">{note.pending ? t("songNotes.pending") : t("songNotes.keptOffline")}</p> : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditBox({ text, onChange, onCancel, onSave, busy, children }: { text: string; onChange: (text: string) => void; onCancel: () => void; onSave: () => void; busy: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={text} onChange={(event) => onChange(event.target.value)} rows={3} autoFocus data-testid="note-edit-input" />
      {children}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("songNotes.cancel")}
        </Button>
        <Button size="sm" onClick={onSave} disabled={busy || !text.trim()} data-testid="note-edit-save">
          {t("songNotes.saveEdit")}
        </Button>
      </div>
    </div>
  );
}

/** A place to save in, as the dialog offers it: the API's, and "just me, in this set" when the song is opened in one. */
interface PlaceOption {
  key: string;
  choice: NotePlaceChoice;
  onlyInSet: boolean;
}

/** Where a note may be saved, as the dialogs offer it: the API's choices, and "just me, in this set" when the song is opened in one. */
function placeOptions(places: NotePlaceChoice[], setlistId: string | null | undefined): PlaceOption[] {
  const list: PlaceOption[] = [];
  for (const choice of places) {
    list.push({ key: `${choice.place}:${choice.id ?? ""}`, choice, onlyInSet: false });
    if (choice.place === "ME" && setlistId) list.push({ key: "ME:set", choice, onlyInSet: true });
  }
  return list;
}

/** "Save in": where a note goes, each choice with who will see it. */
function PlacePicker({ options, value, onChange, testId }: { options: PlaceOption[]; value: string; onChange: (key: string) => void; testId: string }) {
  const { t } = useTranslation();
  const optionName = (option: PlaceOption) =>
    option.onlyInSet ? t("songNotes.places.ME_SET") : option.choice.place === "ME" ? t("songNotes.places.ME") : option.choice.place === "SONG" ? t("songNotes.places.SONG") : (option.choice.name ?? "");
  const optionWho = (option: PlaceOption) => t(`songNotes.who.${option.onlyInSet ? "ME_SET" : option.choice.place}`);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t("songNotes.saveIn")}</legend>
      <div role="radiogroup" aria-label={t("songNotes.saveIn")} className="flex flex-col overflow-hidden rounded-lg border" data-testid={testId}>
        {options.map((option, i) => {
          const on = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(option.key)}
              className={cn("flex min-h-12 items-center gap-3 px-3 py-1.5 text-left", i > 0 && "border-t", on ? "bg-muted" : "hover:bg-muted/50")}
              data-place={option.key}
            >
              <span className={cn("size-4 shrink-0 rounded-full border-2", on ? "border-[5px] border-primary" : "border-muted-foreground/50")} aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{optionName(option)}</span>
                <span className="text-xs text-muted-foreground">{optionWho(option)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The choice a note is saved in now, among `options`; added to them when it isn't one (a team one has left, say: kept as it is). */
function currentPlace(note: SongNote, options: PlaceOption[], setlistId: string | null | undefined): { key: string; options: PlaceOption[] } {
  const key = note.place === "ME" ? (note.placeId ? (note.placeId === setlistId ? "ME:set" : `ME:in:${note.placeId}`) : "ME:") : `${note.place}:${note.placeId ?? ""}`;
  if (options.some((option) => option.key === key)) return { key, options };
  const own: PlaceOption = { key, choice: { place: note.place, id: note.place === "ME" ? null : note.placeId, name: note.placeName }, onlyInSet: note.place === "ME" && !!note.placeId };
  return { key, options: [own, ...options] };
}

/** Writing a note: what it says, where it's saved (who sees it), and - inside a section sung more than once - on this pass or every one. */
function AddNoteDialog({
  anchor,
  chart,
  state,
  context,
  label,
  onClose,
}: {
  anchor: NoteAnchor;
  chart: RenderedChart;
  state: SongNotesState;
  context: NotesContext;
  label: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => placeOptions(state.places, context.setlistId), [state.places, context.setlistId]);
  const [placeKey, setPlaceKey] = useState(options[0]?.key ?? "ME:");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Inside a section sung more than once: this time (by default) or every time.
  const sectionId = anchor.kind === "song" || anchor.kind === "afterPass" ? null : anchor.sectionId;
  const repeated = sectionId !== null && chart.passes.filter((pass) => pass.section.id === sectionId).length > 1;
  const [everyPass, setEveryPass] = useState(false);

  const place = options.find((option) => option.key === placeKey) ?? options[0];
  const save = async () => {
    if (!place || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const pinned: NoteAnchor = anchor.kind !== "song" && anchor.kind !== "afterPass" && everyPass ? (({ passId: _, ...rest }) => rest)(anchor) : anchor;
      await state.add(noteBody(context, place.choice, content.trim(), pinned, place.onlyInSet));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };


  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 overflow-y-auto sm:max-w-md" data-testid="add-note">
        <DialogHeader>
          <DialogTitle>{t("songNotes.addTitle")}</DialogTitle>
          <DialogDescription data-testid="add-note-target">{label}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={t("songNotes.placeholder")}
          rows={3}
          autoFocus
          aria-label={t("songNotes.placeholder")}
          className="text-base"
          data-testid="add-note-input"
        />
        {repeated ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t("songNotes.showIt")}</legend>
            <div className="flex gap-2" role="radiogroup">
              {[false, true].map((every) => (
                <Button key={String(every)} type="button" size="sm" variant={everyPass === every ? "default" : "outline"} role="radio" aria-checked={everyPass === every} onClick={() => setEveryPass(every)}>
                  {every ? t("songNotes.everyPass") : t("songNotes.thisPass")}
                </Button>
              ))}
            </div>
          </fieldset>
        ) : null}
        <PlacePicker options={options} value={place?.key ?? ""} onChange={setPlaceKey} testId="add-note-places" />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("songNotes.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !content.trim()} data-testid="add-note-save">
            {t("songNotes.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
