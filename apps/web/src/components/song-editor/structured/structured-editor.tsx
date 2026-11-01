import {
  flowItemId,
  uniquePass,
  detectImportFormat,
  diatonicChords,
  parseChord,
  reconcileSections,
  sameChord,
  sectionsFromText,
  sectionsToChordPro,
  simplifyChord,
  transposeChord,
  transposeKey,
  type SectionInstance,
  type SectionV2,
} from "@oneverse/core";
import { getSchema } from "@tiptap/core";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { Placeholder } from "@tiptap/extensions";
import { UndoRedo } from "@tiptap/extensions";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { ChevronLeft, ChevronRight, FileUp, Minus, Plus, Redo2, StickyNote, SeparatorVertical, Trash2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DisplayPanel } from "#/components/display-panel";
import { chartOfSections, SongChart } from "@oneverse/screen/components/song-chart";
import { useDisplaySettings } from "#/lib/display-settings";
import { Button } from "@oneverse/ui/components/button";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";
import { cn } from "@oneverse/ui/lib/utils";
import { CAPO_OPTIONS, KEY_OPTIONS, TIME_SIGNATURE_OPTIONS } from "../song-form";
import { editorToSections, editorToSong, sameOrder, sameSections, sectionsToEditorJSON, songToEditorJSON } from "./document";
import { startChordDrag } from "./drag";
import { ChordBar } from "./chord-bar";
import { BarPopover, BarsMenu, NewBarLine } from "./bar-tools";
import { SectionInserter } from "./section-inserter";
import { SongOrder } from "./song-order";
import { SongOrderActionsContext, type SongOrderActions } from "./song-order-context";
import { passDetails, SHARED_LOCAL, useSharedSong, type SavedSong, type SharedSong } from "./shared-song";
import {
  deleteChord,
  insertChord,
  nudgeChord,
  REPLACE_META,
  duplicateSection,
  remeasureChords,
  withFreshIds,
  replaceDocument,
  setDocumentBeats,
  setDocumentKey,
  duplicateLinked,
  replaceLinked,
  selectedChord,
  setChordSymbol,
  songEditorExtensions,
  toggleNoteLine,
  touchScreen,
  transposeChords,
  type ChordViewEvents,
} from "./extensions";

export type EditorMode = "visual" | "text" | "preview";
const MODES: EditorMode[] = ["visual", "text", "preview"];

/** What the toolbar edits beside the key (issue #248), as Song info's form holds them. */
export interface SongFacts {
  tempo: string;
  timeSignature: string;
  capo: string;
}

type EditorProps = {
  sections: SectionV2[];
  onChange: (sections: SectionV2[]) => void;
  flow: SectionInstance[];
  onFlowChange: (flow: SectionInstance[]) => void;
  songKey: string;
  onSongKeyChange: (key: string) => void;
  facts: SongFacts;
  onFactChange: (field: keyof SongFacts, value: string) => void;
  /** Opens "Replace from a file or paste…" (issue #254). */
  onReplaceChart?: () => void;
  readOnly: boolean;
};

/** Typing in the song together (issue #27): what the editor needs to join the others, where Admin turned it on. */
export interface SharedEditing {
  songVersionId: string;
  /** Who this is, on their caret. */
  me: { name: string; color: string };
  /** The song as saved now: what the room starts from, and the revision to join with. */
  loadSaved: () => Promise<SavedSong>;
  /** The room is at a newer revision than the page's: load the song (for saving). */
  onNewer: (revision: number) => void;
  /** The song changed outside the room: what nobody saved is dropped, load it again. */
  onReset: () => void;
  /** In a room with others, or not (saves, Discard and saves heard work differently in one). */
  onRoomChange: (inRoom: boolean) => void;
}

/** The editor's schema, for the shared document's start (made before the editor). */
const editorSchema = getSchema(songEditorExtensions({ onChordPointerDown: () => {}, onBarPointerDown: () => {}, onEditChord: () => {} }));

/** A bar's beats from a time signature as Song info has it ("6/8"): its top number, 4 without one. */
const beatsOf = (timeSignature: string) => Number(/^(\d+)\//.exec(timeSignature.trim())?.[1]) || 4;

/**
 * The song editor's Editor tab: the chart edited as it looks - chords above
 * the lyrics, dragged or nudged onto any character, lyrics typed around
 * them - with a text mode for tricky fixes and a preview. Edits the
 * sections' IDs never change (docs/song-document-v2.md, "Editor rules").
 * With `shared`, typed in together with whoever else has it open (issue #27).
 */
export function StructuredEditor({ shared, ...props }: EditorProps & { shared?: SharedEditing }) {
  const { t } = useTranslation();
  const state = useSharedSong({
    songVersionId: shared?.songVersionId ?? null,
    enabled: !!shared && !props.readOnly,
    schema: editorSchema,
    me: shared?.me ?? { name: "", color: "" },
    loadSaved: () => shared!.loadSaved(),
    onNewer: (revision) => shared?.onNewer(revision),
    onReset: () => shared?.onReset(),
  });
  const onRoomChange = useRef(shared?.onRoomChange);
  onRoomChange.current = shared?.onRoomChange;
  const inRoom = state.status === "ready";
  useEffect(() => {
    onRoomChange.current?.(inRoom);
  }, [inRoom]);
  if (state.status === "joining") {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground" role="status" data-testid="editor-joining">
        {t("structuredEditor.joining")}
      </p>
    );
  }
  return <EditorBody key={state.status === "ready" ? `room-${state.generation}` : "alone"} {...props} room={state.status === "ready" ? state.room : null} me={shared?.me} />;
}

function EditorBody({
  sections,
  onChange,
  flow,
  onFlowChange,
  songKey,
  onSongKeyChange,
  facts,
  onFactChange,
  onReplaceChart,
  readOnly,
  room,
  me,
}: EditorProps & { room: SharedSong | null; me?: { name: string; color: string } }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<EditorMode>(readOnly ? "preview" : "visual");
  const [editTick, setEditTick] = useState(0);
  // The song's order, current, for the linked copies (issue #205): read and changed here.
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const onFlowChangeRef = useRef(onFlowChange);
  onFlowChangeRef.current = onFlowChange;
  const setFlow = (next: SectionInstance[]) => {
    flowRef.current = next;
    emittedFlow.current = next;
    if (room) writePasses(room, next);
    onFlowChangeRef.current(next);
  };
  // In a room (issue #27), a pass's details are the room's: a pass someone else added comes with theirs.
  // A pasted chart's passes (issue #31), kept for the update its paste makes.
  const pastedPasses = useRef<SectionInstance[]>([]);
  const previousFlow = () => [...(room ? roomFlow(room) : flowRef.current), ...pastedPasses.current];
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The pass the user moved the cursor into (not a reload's), chosen in the song order (issue #251).
  const onCursorPass = useRef<(passId: string) => void>(() => {});
  const onSongKeyChangeRef = useRef(onSongKeyChange);
  onSongKeyChangeRef.current = onSongKeyChange;
  // The key as the song has it, for the document (changed from the picker or Song info).
  const keyRef = useRef(songKey);
  keyRef.current = songKey;
  // The sections and order the editor last reported: anything else arriving is an outside change to load.
  const emitted = useRef(sections);
  const emittedFlow = useRef(flow);

  // The beats' labels in the language shown, read when the dots are drawn.
  const tRef = useRef(t);
  tRef.current = t;
  const events = useRef<ChordViewEvents>({ onChordPointerDown: () => {}, onBarPointerDown: () => {}, onEditChord: () => {} });
  const extensions = useMemo(
    () => [
      ...songEditorExtensions({
        onChordPointerDown: (event, pos) => events.current.onChordPointerDown(event, pos),
        onBarPointerDown: (event, pos) => events.current.onBarPointerDown(event, pos),
        onEditChord: () => events.current.onEditChord(),
        onPastePasses: (passes) => {
          pastedPasses.current = passes;
        },
        beatLabel: (beat, placed) => tRef.current(placed ? "structuredEditor.bars.beatPlaced" : "structuredEditor.bars.beat", { n: beat }),
      }),
      // Together (issue #27): the chart is the room's document; undo takes back one's own changes only; the others' carets show.
      ...(room
        ? [
            Collaboration.configure({ document: room.doc, field: "chart", yUndoOptions: { undoManager: room.undoManager } }),
            CollaborationCaret.configure({ provider: room.provider, user: me ?? { name: "", color: "#888" } }),
          ]
        : [UndoRedo]),
      Placeholder.configure({ placeholder: t("structuredEditor.placeholder"), includeChildren: true, showOnlyCurrent: false }),
    ],
    [],
  );
  const editor = useEditor({
    extensions,
    // In the order it's sung, linked copies and all (issue #205). In a room, the room's document.
    ...(!room && { content: { ...songToEditorJSON(sections, flow), attrs: { key: songKey || null, beats: beatsOf(facts.timeSignature) } } }),
    editable: !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { "aria-label": t("structuredEditor.label"), spellcheck: "false", "data-testid": "structured-editor" } },
    onSelectionUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta(REPLACE_META)) return;
      const passId = passAt(current.state);
      if (passId) onCursorPass.current(passId);
    },
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta(REPLACE_META)) return;
      // A transposition (or its undo) moves the key with the chords.
      const key = (current.state.doc.attrs.key as string | null) ?? "";
      if (key !== keyRef.current) onSongKeyChangeRef.current(key);
      const next = editorToSong(current.state.doc, previousFlow());
      pastedPasses.current = [];
      if (room) remember(next.sections, next.flow);
      emitted.current = next.sections;
      onChangeRef.current(next.sections);
      setFlow(next.flow);
    },
  });

  events.current = {
    onChordPointerDown: (event, pos) => {
      if (!editor) return;
      const raw = (editor.state.doc.nodeAt(pos)?.attrs.raw as string | undefined) ?? "";
      startChordDrag(editor.view, event, { kind: "move", pos, raw }, () => {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
        // With a finger: chosen, its tools in the chord bar, and the keyboard put away so it covers nothing.
        if (event.pointerType === "touch") (editor.view.dom as HTMLElement).blur();
        else editor.view.focus();
      });
    },
    onBarPointerDown: (event, pos) => {
      if (!editor) return;
      startChordDrag(editor.view, event, { kind: "moveBar", pos }, () => {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
        if (event.pointerType === "touch") (editor.view.dom as HTMLElement).blur();
        else editor.view.focus();
      });
    },
    onEditChord: () => setEditTick((tick) => tick + 1),
  };

  // A bar's beats, for the chords in bar lines' bars (issue #238).
  useEffect(() => {
    if (editor) setDocumentBeats(editor.view, beatsOf(facts.timeSignature));
  }, [editor, facts.timeSignature]);

  useEffect(() => {
    if (editor) setDocumentKey(editor.view, songKey || null);
    // The key changed here (the picker, a transposition): the others' too.
    if (room && ((room.song.get("key") as string | null) ?? "") !== songKey) room.doc.transact(() => room.song.set("key", songKey || null), SHARED_LOCAL);
  }, [editor, songKey]);

  // In a room: the key and the passes' details as the others change them (or undo takes them back).
  useEffect(() => {
    if (!room || !editor) return;
    const keyChanged = () => {
      const key = (room.song.get("key") as string | null) ?? "";
      if (key !== keyRef.current) onSongKeyChangeRef.current(key);
    };
    const passesChanged = () => {
      const next = editorToSong(editor.state.doc, roomFlow(room)).flow;
      if (JSON.stringify(next) === JSON.stringify(flowRef.current)) return;
      remember(editorToSections(editor.state.doc), next);
      flowRef.current = next;
      emittedFlow.current = next;
      onFlowChangeRef.current(next);
    };
    keyChanged();
    room.song.observe(keyChanged);
    room.passes.observe(passesChanged);
    return () => {
      room.song.unobserve(keyChanged);
      room.passes.unobserve(passesChanged);
    };
  }, [room, editor]);
  // The song order's details changed from its bar: the others' too.
  useEffect(() => {
    if (room) writePasses(room, flow);
  }, [room, flow]);

  // In a room, the props the editor was made with are the room's to replace: only a change made since is loaded.
  const propsSeen = useRef({ sections, flow });
  // In a room, what the editor reported lately: the page can render one of them after the others' typing moved on (it's not a change from outside).
  const recent = useRef<string[]>([]);
  function remember(next: SectionV2[], nextFlow: SectionInstance[]) {
    recent.current = [...recent.current.slice(-30), chartKey(next, nextFlow)];
  }
  // Load the song when it changes from outside (Song Info's text, Discard, a save, text mode, the song order bar).
  useEffect(() => {
    const seen = propsSeen.current;
    propsSeen.current = { sections, flow };
    if (room && ((seen.sections === sections && seen.flow === flow) || recent.current.includes(chartKey(sections, flow)))) return;
    if (!editor || (sameSections(sections, emitted.current) && sameOrder(flow, emittedFlow.current))) return;
    emitted.current = sections;
    emittedFlow.current = flow;
    replaceDocument(editor.view, editor.schema.nodeFromJSON(songToEditorJSON(sections, flow)), mode === "text");
  }, [editor, sections, flow]);

  // The linked copies unfolded (issue #252).
  const [openCopies, setOpenCopies] = useState<ReadonlySet<string>>(new Set());
  const setCopyOpen = (passId: string, open: boolean) =>
    setOpenCopies((current) => {
      const next = new Set(current);
      if (open) next.add(passId);
      else next.delete(passId);
      return next;
    });

  // What the linked copies read and change (issue #205).
  const orderActions = useMemo<SongOrderActions>(
    () => ({
      pass: (passId) => flow.find((item) => item.id === passId),
      updatePass: (passId, change) => setFlow(flowRef.current.map((item) => (item.id === passId ? { ...item, ...change } : item))),
      makeUnique: (passId, pos) => {
        const pass = flowRef.current.find((item) => item.id === passId);
        if (!editor || !pass) return;
        const section = editorToSections(editor.state.doc).find((one) => one.id === pass.sectionId);
        if (!section) return;
        const json = sectionsToEditorJSON([uniquePass(section, pass, songKey || null)]).content![0]!;
        // Its changes are written into the new section: the pass no longer carries them.
        setFlow(flowRef.current.map((item) => (item.id === passId ? { ...item, transpose: null, chords: undefined, hiddenLines: undefined, lyrics: undefined } : item)));
        replaceLinked(editor.view, pos, editor.schema.nodeFromJSON(json));
      },
      duplicatePass: (passId, pos) => {
        const pass = flowRef.current.find((item) => item.id === passId);
        if (!editor || !pass) return;
        // Inserting it adds its pass to the order (onUpdate); then it takes the copy's changes.
        const newId = duplicateLinked(editor.view, pos);
        if (!newId) return;
        setFlow(flowRef.current.map((item) => (item.id === newId ? { ...pass, id: newId } : item)));
        setCopyOpen(newId, true);
      },
      songKey,
      copyOpen: (passId) => openCopies.has(passId),
      setCopyOpen,
    }),
    [flow, editor, songKey, openCopies],
  );

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // The pass being edited in the chart is the one chosen in the song order, and the other way round (issue #251).
  const [selectedPass, setSelectedPass] = useState<string | null>(null);
  onCursorPass.current = (passId) => setSelectedPass(passId);
  const blockOf = (passId: string): { pos: number; node: PMNode } | null => {
    let found: { pos: number; node: PMNode } | null = null;
    editor?.state.doc.forEach((node, pos) => {
      if (!found && (node.attrs.passId ?? (node.attrs.id ? flowItemId(node.attrs.id as string) : null)) === passId) found = { pos, node };
    });
    return found;
  };
  function choosePass(passId: string | null) {
    setSelectedPass(passId);
    const block = passId ? blockOf(passId) : null;
    // Brought into view, the cursor left where it is.
    if (editor && block) (editor.view.nodeDOM(block.pos) as HTMLElement | null)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  /** A pass's section duplicated as a section of its own, right after the pass: a linked copy's changes written in. */
  function duplicateUnique(passId: string) {
    const block = blockOf(passId);
    if (!editor || !block) return;
    if (block.node.type.name === "section") {
      duplicateSection(editor.view, block.pos);
      return;
    }
    const pass = flowRef.current.find((item) => item.id === passId);
    const section = editorToSections(editor.state.doc).find((one) => one.id === block.node.attrs.sectionId);
    if (!pass || !section) return;
    const json = sectionsToEditorJSON([uniquePass(section, pass, songKey || null)]).content![0]!;
    const node = withFreshIds(editor.schema.nodeFromJSON({ ...json, attrs: { ...json.attrs, passId: null } }));
    editor.view.dispatch(editor.state.tr.insert(block.pos + block.node.nodeSize, node).scrollIntoView());
  }

  // Others in the room (issue #27): text mode only reads, so their typing isn't overwritten by a text edited from before it.
  const [othersHere, setOthersHere] = useState(0);
  useEffect(() => {
    if (!room) return;
    const count = () => setOthersHere([...room.awareness.getStates().keys()].filter((id) => id !== room.doc.clientID).length);
    count();
    room.awareness.on("change", count);
    return () => room.awareness.off("change", count);
  }, [room]);

  // The chart's own lettering, as Edit's Display settings have it (issue #249): the chords' room measured again with it.
  const display = useDisplaySettings("EDIT");
  useEffect(() => {
    if (editor) remeasureChords(editor.view);
  }, [editor, display.font]);

  if (readOnly) {
    return <EditPreview chart={chartOfSections(sections, flow, songKey || null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <Toolbar editor={editor} mode={mode} onModeChange={setMode} songKey={songKey} onSongKeyChange={onSongKeyChange} facts={facts} onFactChange={onFactChange} onReplaceChart={onReplaceChart} />
      {/* In every mode, so switching modes moves nothing (issue #248). */}
      {sections.length > 0 ? (
        <SongOrder sections={sections} flow={flow} onChange={onFlowChange} songKey={songKey} selected={selectedPass} onSelect={choosePass} onDuplicateUnique={duplicateUnique} />
      ) : null}
      {/* With room (issue #177), the chart as it will read beside the editor. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          // The chords at the right of the chart with a mouse (issue #253); on a touch screen, in the bar along the bottom instead.
          mode === "visual" && "@7xl:grid-cols-2 lg:pointer-fine:grid-cols-[minmax(0,1fr)_14rem] @7xl:pointer-fine:grid-cols-[minmax(0,1fr)_14rem_minmax(0,1fr)]",
          mode === "text" && "@7xl:grid-cols-2",
        )}
      >
        {/* Room under the chart for the chord bar, where there is one. */}
        <div className={cn("relative min-w-0 pb-28 lg:pointer-fine:pb-0", mode !== "visual" && "hidden")} data-editor-container="" data-font={display.font}>
          <SongOrderActionsContext.Provider value={orderActions}>
            <EditorContent editor={editor} className="sv-editor" />
          </SongOrderActionsContext.Provider>
          {/* A section at the end; between two, the "+" in the gap (issue #250). */}
          {editor ? <SectionInserter editor={editor} at={() => endOfOrder(editor)} testId="section-insert-end" /> : null}
          {editor ? <ChordPopover editor={editor} songKey={songKey} editTick={editTick} /> : null}
          {editor ? <BarPopover editor={editor} /> : null}
          <p className="mt-4 text-xs text-muted-foreground">{t("structuredEditor.hints")}</p>
        </div>
        {mode === "visual" && editor ? <Palette editor={editor} songKey={songKey} sections={sections} /> : null}
        {mode === "visual" && editor ? <ChordBar editor={editor} songKey={songKey} used={chordsUsed(sections)} /> : null}
        {mode === "text" ? <TextMode sections={sections} onChange={(next) => onChangeRef.current(next)} locked={othersHere > 0} /> : null}
        {mode === "preview" ? <EditPreview chart={chartOfSections(sections, flow, songKey || null)} withPanel /> : null}
        {mode !== "preview" ? (
          <aside className="hidden min-w-0 flex-col gap-2 border-l pl-6 @7xl:flex" aria-label={t("structuredEditor.modes.preview")} data-testid="editor-side-preview">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("structuredEditor.modes.preview")}</p>
            <EditPreview chart={chartOfSections(sections, flow, songKey || null)} withPanel />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/** The pass of the block the cursor is in. A section added since the song was loaded has its pass named after it (as editorToSong names it). */
function passAt(state: EditorState): string | null {
  const { $from } = state.selection;
  const block = $from.depth > 0 ? $from.node(1) : state.doc.nodeAt(state.selection.from);
  if (!block) return null;
  return (block.attrs.passId as string | null) ?? (block.type.name === "section" && block.attrs.id ? flowItemId(block.attrs.id as string) : null);
}

/** Where a section added at the end goes: after the song's order, before the sections taken out of it. */
function endOfOrder(editor: Editor): number {
  let at = editor.state.doc.content.size;
  let found = false;
  editor.state.doc.forEach((node, offset) => {
    if (!found && node.type.name === "section" && node.attrs.sung === false) {
      at = offset;
      found = true;
    }
  });
  return at;
}

/**
 * The chart as it will read, through Edit's display settings (issue #209):
 * the text, spacing and columns the Display panel sets for Edit mode.
 */
function EditPreview({ chart, withPanel = false }: { chart: ReturnType<typeof chartOfSections>; withPanel?: boolean }) {
  const { t } = useTranslation();
  const display = useDisplaySettings("EDIT");
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {withPanel ? <DisplayPanel mode="EDIT" settings={display} className="self-end" /> : null}
      <div style={{ zoom: display.textSize }}>
        <SongChart
          chart={chart}
          emptyText={t("songEditor.previewEmpty")}
          columns={display.columns}
          font={display.font}
          spacing={display.spacing}
          hideChords={display.hideChords}
          colors={display.chordColors}
        />
      </div>
    </div>
  );
}

/**
 * The editor's one toolbar (issue #248), kept in view under the song's
 * header. Nothing in it moves or changes size as it's used - the key, the
 * numbers and every button keep their place - so a button pressed again
 * and again stays under the finger: tools that don't apply to a mode are
 * disabled there, not taken away.
 */
function Toolbar({
  editor,
  mode,
  onModeChange,
  songKey,
  onSongKeyChange,
  facts,
  onFactChange,
  onReplaceChart,
}: {
  editor: Editor | null;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  songKey: string;
  onSongKeyChange: (key: string) => void;
  facts: SongFacts;
  onFactChange: (field: keyof SongFacts, value: string) => void;
  onReplaceChart?: () => void;
}) {
  const { t } = useTranslation();
  const can = useEditorState({
    editor,
    selector: ({ editor: current }) => ({ undo: !!current?.can().undo(), redo: !!current?.can().redo() }),
  }) ?? { undo: false, redo: false };

  function transpose(steps: number) {
    if (!editor) return;
    const key = songKey ? (transposeKey(songKey, steps) ?? songKey) : null;
    // The key goes with the chords, in one step: undo puts both back.
    transposeChords(editor.view, (raw) => transposeChord(raw, steps, key), key);
  }

  const visual = mode === "visual";
  const tempo = facts.tempo.trim();
  const tempoInvalid = !!tempo && (!/^\d+$/.test(tempo) || Number(tempo) < 20 || Number(tempo) > 400);
  return (
    <div
      role="toolbar"
      aria-label={t("structuredEditor.tools")}
      data-testid="editor-toolbar"
      // Under the song's header, which is sticky from md up (its height in --song-header-h).
      // One row that scrolls sideways on a phone, so the chart keeps the screen; it wraps with room.
      className="bleed-x sticky top-14 z-20 flex flex-nowrap items-center gap-x-3 gap-y-2 overflow-x-auto border-b md:flex-wrap md:overflow-visible bg-background/95 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:top-[calc(3.5rem+var(--song-header-h,0px))]"
    >
      <div role="radiogroup" aria-label={t("structuredEditor.mode")} className="inline-flex shrink-0 rounded-md bg-muted p-0.5">
        {MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            onClick={() => onModeChange(option)}
            className={cn(
              "h-7 rounded-sm px-3 text-xs font-medium pointer-coarse:h-10 pointer-coarse:px-4 pointer-coarse:text-sm",
              mode === option ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`structuredEditor.modes.${option}`)}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center">
        <ToolButton label={t("structuredEditor.undo")} disabled={!visual || !can.undo} onClick={() => (touchScreen() ? editor?.commands.undo() : editor?.chain().focus().undo().run())} testId="editor-undo">
          <Undo2 />
        </ToolButton>
        <ToolButton label={t("structuredEditor.redo")} disabled={!visual || !can.redo} onClick={() => (touchScreen() ? editor?.commands.redo() : editor?.chain().focus().redo().run())} testId="editor-redo">
          <Redo2 />
        </ToolButton>
        <ToolButton label={t("structuredEditor.noteLine")} disabled={!visual} onClick={() => editor && toggleNoteLine(editor.view)}>
          <StickyNote />
        </ToolButton>
        <BarsMenu editor={editor} disabled={!visual}>
          <SeparatorVertical />
        </BarsMenu>
        {onReplaceChart ? (
          <ToolButton label={t("structuredEditor.replace")} onClick={onReplaceChart} testId="editor-replace">
            <FileUp />
          </ToolButton>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-1.5 md:flex-wrap">
        <Fact label={t("structuredEditor.key")}>
          <NativeSelect compact aria-label={t("structuredEditor.key")} value={songKey} onChange={(event) => onSongKeyChange(event.target.value)} className={factControl("w-[4.5rem]")} data-testid="editor-key">
            <option value="">–</option>
            {[...KEY_OPTIONS.major, ...KEY_OPTIONS.minor].map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </NativeSelect>
        </Fact>
        <div className="flex items-center rounded-md border shadow-xs" role="group" aria-label={t("structuredEditor.transpose")}>
          <ToolButton label={t("structuredEditor.transposeDown")} disabled={!visual} onClick={() => transpose(-1)} testId="editor-transpose-down">
            <Minus />
          </ToolButton>
          <span className="w-[4.75rem] text-center text-xs text-muted-foreground select-none">{t("structuredEditor.transpose")}</span>
          <ToolButton label={t("structuredEditor.transposeUp")} disabled={!visual} onClick={() => transpose(1)} testId="editor-transpose-up">
            <Plus />
          </ToolButton>
        </div>
        <Fact label={t("structuredEditor.tempo")}>
          <input
            inputMode="numeric"
            aria-label={t("structuredEditor.tempoLabel")}
            aria-invalid={tempoInvalid || undefined}
            value={facts.tempo}
            placeholder="–"
            maxLength={3}
            onChange={(event) => onFactChange("tempo", event.target.value)}
            className={factControl("w-[3.25rem] px-2 text-center tabular-nums aria-invalid:border-destructive")}
            data-testid="editor-tempo"
          />
        </Fact>
        <Fact label={t("structuredEditor.time")}>
          <NativeSelect compact aria-label={t("structuredEditor.timeLabel")} value={facts.timeSignature} onChange={(event) => onFactChange("timeSignature", event.target.value)} className={factControl("w-[4.5rem]")} data-testid="editor-time">
            <option value="">–</option>
            {facts.timeSignature && !TIME_SIGNATURE_OPTIONS.includes(facts.timeSignature) ? <option value={facts.timeSignature}>{facts.timeSignature}</option> : null}
            {TIME_SIGNATURE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </Fact>
        <Fact label={t("structuredEditor.capo")}>
          <NativeSelect compact aria-label={t("structuredEditor.capoLabel")} value={facts.capo} onChange={(event) => onFactChange("capo", event.target.value)} className={factControl("w-[4rem]")} data-testid="editor-capo">
            <option value="">–</option>
            {CAPO_OPTIONS.map((fret) => (
              <option key={fret} value={fret}>
                {fret}
              </option>
            ))}
          </NativeSelect>
        </Fact>
      </div>
    </div>
  );
}

/** A control's width and height in the toolbar: fixed, so its value never changes its size; larger for touch. */
const factControl = (width: string) =>
  cn("h-8 rounded-md border border-input bg-transparent text-xs shadow-xs outline-none focus-visible:border-ring pointer-coarse:h-11 pointer-coarse:text-sm", width);

/** One of the song's facts in the toolbar: its name, then its control. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground select-none" aria-hidden>
        {label}
      </span>
      {children}
    </span>
  );
}

function ToolButton({ label, onClick, disabled, testId, children }: { label: string; onClick: () => void; disabled?: boolean; testId?: string; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-8 pointer-coarse:size-11" aria-label={label} title={label} disabled={disabled} onClick={onClick} data-testid={testId}>
      {children}
    </Button>
  );
}

/** A chord to add: click for the cursor (or to replace the selected chord), drag onto a lyric. */
function PaletteChord({ editor, raw, degree }: { editor: Editor; raw: string; degree?: string }) {
  const apply = () => {
    const selected = selectedChord(editor.state);
    if (selected) setChordSymbol(editor.view, selected.pos, raw);
    else insertChord(editor.view, raw);
  };
  return (
    <button
      type="button"
      className="flex shrink-0 touch-pan-x items-baseline gap-1 rounded-md border px-2 py-1 font-mono text-sm font-bold text-primary hover:bg-primary/10"
      data-palette-chord={raw}
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => startChordDrag(editor.view, event.nativeEvent, { kind: "new", raw }, apply, event.currentTarget)}
      // Keyboard activation (a pointer press is handled above).
      onClick={(event) => event.detail === 0 && apply()}
    >
      {raw}
      {degree ? <span className="font-sans text-[10px] font-normal text-muted-foreground">{degree}</span> : null}
    </button>
  );
}

/** The chords the song uses, each once, in the order they first come. */
function chordsUsed(sections: SectionV2[]): string[] {
  return [...new Set(sections.flatMap((section) => section.lines.flatMap((line) => line.chords.map((chord) => chord.raw))))];
}

function Palette({ editor, songKey, sections }: { editor: Editor; songKey: string; sections: SectionV2[] }) {
  const { t } = useTranslation();
  const [other, setOther] = useState("");
  const inKey = diatonicChords(songKey);
  const used = chordsUsed(sections);

  function addOther() {
    if (!other.trim()) return;
    const selected = selectedChord(editor.state);
    if (selected) setChordSymbol(editor.view, selected.pos, other);
    else insertChord(editor.view, other);
    setOther("");
  }

  const heading = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";
  const row = "flex flex-wrap gap-1.5";
  return (
    // Kept in view at the right while the chart scrolls, under the header and the toolbar (issue #253).
    <aside
      className="hidden min-w-0 flex-col gap-4 rounded-lg border p-3 lg:sticky lg:top-[calc(7.5rem+var(--song-header-h,0px))] lg:self-start lg:pointer-fine:flex"
      aria-label={t("structuredEditor.palette")}
      data-testid="chord-panel"
    >
      <div className="flex flex-col gap-1.5">
        <h3 className={heading}>{songKey && inKey.length > 0 ? t("structuredEditor.inKey", { key: songKey }) : t("structuredEditor.chords")}</h3>
        {inKey.length > 0 ? (
          <div className={row}>
            {inKey.map((chord) => (
              <PaletteChord key={chord.degree} editor={editor} raw={chord.chord} degree={chord.degree} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("structuredEditor.setKeyHint")}</p>
        )}
        {used.length > 0 ? (
          <>
            <h4 className="mt-1 text-xs text-muted-foreground">{t("structuredEditor.inSong")}</h4>
            <div className={row}>
              {used.map((raw) => (
                <PaletteChord key={raw} editor={editor} raw={raw} />
              ))}
            </div>
          </>
        ) : null}
        <div className="mt-1 flex gap-1.5">
          <input
            value={other}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addOther();
              }
            }}
            placeholder={t("structuredEditor.otherChord")}
            aria-label={t("structuredEditor.otherChord")}
            maxLength={64}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2 font-mono text-sm outline-none focus-visible:border-ring"
          />
          <Button type="button" size="sm" variant="outline" onClick={addOther} disabled={!other.trim()}>
            {t("structuredEditor.addChord")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("structuredEditor.chordHint")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className={heading}>{t("structuredEditor.bars.title")}</h3>
        <div className={row}>
          <NewBarLine editor={editor} />
        </div>
        <p className="text-xs text-muted-foreground">{t("structuredEditor.bars.paletteHint")}</p>
      </div>
    </aside>
  );
}

const VARIATIONS = ["", "m", "7", "maj7", "m7", "sus2", "sus4", "add9"];

/** The selected chord's details, just under it: its symbol, the key's chords, variations, move and delete. */
function ChordPopover({ editor, songKey, editTick }: { editor: Editor; songKey: string; editTick: number }) {
  const { t } = useTranslation();
  const chord = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const selected = current ? selectedChord(current.state) : null;
      return selected ? { pos: selected.pos, raw: selected.node.attrs.raw as string, id: selected.node.attrs.id as string } : null;
    },
    equalityFn: (a, b) => a?.pos === b?.pos && a?.raw === b?.raw && a?.id === b?.id,
  });
  const [draft, setDraft] = useState("");
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(chord?.raw ?? ""), [chord?.id, chord?.raw]);
  useEffect(() => {
    if (editTick > 0) input.current?.select();
  }, [editTick]);

  useLayoutEffect(() => {
    if (!chord) return;
    const measure = () => {
      const chip = (editor.view.nodeDOM(chord.pos) as HTMLElement | null)?.querySelector(".sv-chord-chip");
      const container = box.current?.parentElement;
      if (!chip || !container) return;
      const [c, r] = [container.getBoundingClientRect(), chip.getBoundingClientRect()];
      const width = box.current?.offsetWidth ?? 288;
      setPlace({ top: r.bottom - c.top + 26, left: Math.max(0, Math.min(r.left - c.left, c.width - width)) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [editor, chord?.pos, chord?.raw]);

  if (!chord) return null;
  const view = editor.view;
  const apply = (raw: string) => setChordSymbol(view, chord.pos, raw);
  const inKey = diatonicChords(songKey);
  const triad = simplifyChord(chord.raw, { dropExtensions: true, dropBass: true });
  const degree = inKey.find((option) => sameChord(option.chord, triad))?.degree;
  const root = /^\(?([A-G][#b]?)/.exec(chord.raw)?.[1];
  const variations = root ? VARIATIONS.map((suffix) => root + suffix).filter((raw) => raw !== chord.raw) : [];
  const valid = !!parseChord(draft);

  const chip = (raw: string, sub?: string) => (
    <button
      key={raw}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => apply(raw)}
      className={cn(
        "flex items-baseline gap-1 rounded border px-1.5 py-0.5 font-mono text-xs font-bold hover:bg-primary/10",
        sameChord(raw, chord.raw) ? "border-primary bg-primary/10 text-primary" : "text-foreground",
      )}
    >
      {raw}
      {sub ? <span className="font-sans text-[10px] font-normal text-muted-foreground">{sub}</span> : null}
    </button>
  );

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={t("structuredEditor.chordDetails", { chord: chord.raw })}
      data-testid="chord-popover"
      // On a touch screen the chord bar has these tools instead: nothing covers the chart (issue #253).
      className="absolute z-20 flex w-72 max-w-full flex-col gap-2.5 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg pointer-coarse:hidden"
      style={place ? { top: place.top, left: place.left } : { visibility: "hidden" }}
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <div className="flex items-center gap-2">
        <input
          ref={input}
          value={draft}
          aria-label={t("structuredEditor.chordSymbol")}
          maxLength={64}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft.trim() && apply(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (draft.trim()) apply(draft);
              view.focus();
            } else if (event.key === "Escape") {
              setDraft(chord.raw);
              view.focus();
            }
          }}
          className={cn(
            "h-8 w-24 min-w-0 rounded-md border bg-transparent px-2 font-mono text-sm font-bold outline-none focus-visible:border-ring",
            !valid && draft.trim() && "border-amber-500",
          )}
        />
        {degree ? <span className="text-xs text-muted-foreground">{t("structuredEditor.degree", { degree, key: songKey })}</span> : null}
        <div className="ml-auto flex items-center">
          <ToolButton label={t("structuredEditor.moveLeft")} onClick={() => nudgeChord(view, chord.pos, -1)}>
            <ChevronLeft />
          </ToolButton>
          <ToolButton label={t("structuredEditor.moveRight")} onClick={() => nudgeChord(view, chord.pos, 1)}>
            <ChevronRight />
          </ToolButton>
          <ToolButton label={t("structuredEditor.deleteChord")} onClick={() => deleteChord(view, chord.pos)}>
            <Trash2 className="text-destructive" />
          </ToolButton>
        </div>
      </div>
      {!valid && draft.trim() ? <p className="text-xs text-amber-600">{t("structuredEditor.unknownChord")}</p> : null}
      {inKey.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("structuredEditor.inKey", { key: songKey })}</span>
          <div className="flex flex-wrap gap-1">{inKey.map((option) => chip(option.chord, option.degree))}</div>
        </div>
      ) : null}
      {variations.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("structuredEditor.variations")}</span>
          <div className="flex flex-wrap gap-1">{variations.map((raw) => chip(raw))}</div>
        </div>
      ) : null}
    </div>
  );
}

/** The chart as ChordPro text; each change is read back with the IDs kept (reconcileSections). */
function TextMode({ sections, onChange, locked = false }: { sections: SectionV2[]; onChange: (sections: SectionV2[]) => void; locked?: boolean }) {
  const { t } = useTranslation();
  if (locked) {
    // As the others type it, to read; Visual mode to change it.
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <Textarea value={sectionsToChordPro(sections)} readOnly rows={24} spellCheck={false} aria-label={t("structuredEditor.textLabel")} data-testid="structured-editor-text" className="min-h-60 font-mono text-sm" />
        <p className="text-xs text-muted-foreground" role="status" data-testid="text-mode-locked">
          {t("structuredEditor.textLocked")}
        </p>
      </div>
    );
  }
  return <TextModeEditable sections={sections} onChange={onChange} />;
}

function TextModeEditable({ sections, onChange }: { sections: SectionV2[]; onChange: (sections: SectionV2[]) => void }) {
  const { t } = useTranslation();
  // What the text started from: every change is matched against it, so IDs survive a round of edits.
  const base = useRef(sections);
  const [text, setText] = useState(() => sectionsToChordPro(sections));
  const [problem, setProblem] = useState(false);

  function change(next: string) {
    setText(next);
    try {
      onChange(reconcileSections(base.current, sectionsFromText(next, detectImportFormat(next))));
      setProblem(false);
    } catch {
      setProblem(true);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Textarea
        value={text}
        onChange={(event) => change(event.target.value)}
        rows={24}
        spellCheck={false}
        aria-label={t("structuredEditor.textLabel")}
        data-testid="structured-editor-text"
        className="min-h-60 font-mono text-sm"
      />
      <p className={cn("text-xs", problem ? "text-destructive" : "text-muted-foreground")} role={problem ? "alert" : undefined}>
        {problem ? t("structuredEditor.textProblem") : t("structuredEditor.textHint")}
      </p>
    </div>
  );
}

/** The passes as the room has their details (issue #27): what editorToSong keeps for each. */
function roomFlow(room: SharedSong): SectionInstance[] {
  return [...room.passes.entries()].map(([id, details]) => ({ ...(details as object), id, sectionId: "" }) as SectionInstance);
}

/** Each pass's details written into the room where they differ from what it has (one's own change, undone with one's typing). */
function writePasses(room: SharedSong, flow: SectionInstance[]) {
  const changed = flow.filter((pass) => JSON.stringify(passDetails(pass)) !== JSON.stringify(room.passes.get(pass.id) ?? {}));
  if (changed.length === 0) return;
  room.doc.transact(() => {
    for (const pass of changed) room.passes.set(pass.id, passDetails(pass));
  }, SHARED_LOCAL);
}

/** The chart and its order, as one string to compare (issue #27). */
function chartKey(sections: SectionV2[], flow: SectionInstance[]): string {
  return JSON.stringify([sections.map((section) => [section.id, section.type, section.label ?? null, section.lines.map((line) => [line.id, line.text, line.chords.map((chord) => [chord.id, chord.at, chord.raw])])]), flow.map((item) => [item.id, item.sectionId])]);
}
