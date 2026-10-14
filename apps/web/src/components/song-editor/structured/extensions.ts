import {
  detectImportFormat,
  generateId,
  ID_PREFIXES,
  parseChord,
  sectionsFromText,
  type SectionType,
} from "@songverse/core";
import { Extension, InputRule, Node } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import { joinBackward, joinForward } from "@tiptap/pm/commands";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { sectionsToEditorJSON } from "./document";
import { SectionView } from "./section-view";
import { LinkedView } from "./linked-view";

/**
 * The structured song editor's schema and behaviour (docs/song-document-v2.md,
 * "Editor rules"): sections of lines, chords as inline items pinned before a
 * character, lyric edits that never lose a chord, and IDs that stay put.
 */

/** Transactions that replace the whole document (loading, text mode): no chord keeping. */
export const REPLACE_META = "songverse:replace";
/** Chord IDs a transaction removes on purpose (Delete chord, Delete section). */
export const REMOVE_CHORDS_META = "songverse:removeChords";
/** The drop target shown while a chord is dragged: a position, or null. */
export const DROP_TARGET_META = "songverse:dropTarget";

export interface ChordViewEvents {
  /** A pointer went down on a chord's chip: the drag (or click) starts there. */
  onChordPointerDown: (event: PointerEvent, pos: number) => void;
  /** Enter on a selected chord: edit its symbol. */
  onEditChord: () => void;
}

// --- nodes

// The song in the order it's sung (issue #205): sections, and linked copies of them where they're sung again.
// Its key is the document's too, so undoing a transposition brings the key back with the chords (issue #248).
const SongDoc = Node.create({
  name: "doc",
  topNode: true,
  content: "section (section | linked)*",
  addAttributes() {
    return { key: { default: null, rendered: false } };
  },
});

const Text = Node.create({ name: "text", group: "inline" });

const idAttribute = { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-id"), renderHTML: (attrs: { id?: string | null }) => ({ "data-id": attrs.id }) };

const SectionNode = Node.create({
  name: "section",
  content: "line+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      id: idAttribute,
      type: {
        default: "verse",
        parseHTML: (el) => el.getAttribute("data-type") ?? "verse",
        renderHTML: (attrs) => ({ "data-type": attrs.type }),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-label") || null,
        renderHTML: (attrs) => (attrs.label ? { "data-label": attrs.label } : {}),
      },
      showLabel: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-show-label") !== "false",
        renderHTML: (attrs) => (attrs.showLabel === false ? { "data-show-label": "false" } : {}),
      },
      // Kept as they are through an edit; not edited here yet.
      rhythm: { default: null, rendered: false },
      groove: { default: null, rendered: false },
      // Its first pass in the song's order, and whether it's sung at all (issue #205).
      passId: { default: null, rendered: false },
      sung: { default: true, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "section[data-sv-section]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["section", { "data-sv-section": "", ...HTMLAttributes }, 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(SectionView, {
      stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.("[data-sv-section-header]"),
    });
  },
});

/**
 * A linked copy (issue #205): another pass of a section, where the song
 * sings it again. Its words follow the section; what it changes for itself
 * (transposed, lines left out, its own words and chords) is the pass's, in
 * the song's order. Edited from its own panel, not as text.
 */
const LinkedNode = Node.create({
  name: "linked",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      passId: { default: null, parseHTML: (el) => el.getAttribute("data-pass-id"), renderHTML: (attrs) => ({ "data-pass-id": attrs.passId }) },
      sectionId: { default: null, parseHTML: (el) => el.getAttribute("data-linked-to"), renderHTML: (attrs) => ({ "data-linked-to": attrs.sectionId }) },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-sv-linked]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-sv-linked": "", ...HTMLAttributes }];
  },
  addNodeView() {
    // Its own controls take their own events; the editor leaves them alone.
    return ReactNodeViewRenderer(LinkedView, { stopEvent: () => true, ignoreMutation: () => true });
  },
});

const LineNode = Node.create({
  name: "line",
  content: "inline*",
  addAttributes() {
    return {
      id: idAttribute,
      kind: {
        default: "lyric",
        parseHTML: (el) => (el.getAttribute("data-kind") === "note" ? "note" : "lyric"),
        renderHTML: (attrs) => (attrs.kind === "note" ? { "data-kind": "note", class: "sv-note" } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "p[data-sv-line]" }, { tag: "p", priority: 10 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["p", { "data-sv-line": "", ...HTMLAttributes }, 0];
  },
});

/** A chord: its chip drawn above the character that follows it. */
class ChordView implements NodeView {
  dom: HTMLElement;
  private chip: HTMLElement;

  constructor(
    private node: PMNode,
    getPos: () => number | undefined,
    events: ChordViewEvents,
  ) {
    this.dom = document.createElement("span");
    this.dom.className = "sv-chord";
    this.dom.contentEditable = "false";
    this.chip = document.createElement("span");
    this.chip.className = "sv-chord-chip";
    this.dom.append(this.chip);
    this.render();
    this.chip.addEventListener("pointerdown", (event) => {
      const pos = getPos();
      if (pos !== undefined) events.onChordPointerDown(event, pos);
    });
  }

  private render() {
    const raw = this.node.attrs.raw as string;
    this.chip.textContent = raw;
    this.dom.dataset.svChord = raw;
    this.dom.dataset.id = this.node.attrs.id as string;
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("sv-chord-selected");
  }

  deselectNode() {
    this.dom.classList.remove("sv-chord-selected");
  }

  // Pointer and mouse events on the chip are the drag's; PM leaves them alone.
  stopEvent(event: Event) {
    return /^(pointer|mouse|touch|click|contextmenu)/.test(event.type);
  }

  ignoreMutation() {
    return true;
  }
}

function chordNode(events: ChordViewEvents) {
  return Node.create({
    name: "chord",
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return {
        id: idAttribute,
        raw: {
          default: "",
          parseHTML: (el) => el.getAttribute("data-sv-chord") ?? el.textContent ?? "",
          renderHTML: (attrs) => ({ "data-sv-chord": attrs.raw }),
        },
      };
    },
    parseHTML() {
      return [{ tag: "span[data-sv-chord]" }];
    },
    renderHTML({ node, HTMLAttributes }) {
      return ["span", HTMLAttributes, node.attrs.raw as string];
    },
    renderText({ node }) {
      return `[${node.attrs.raw as string}]`;
    },
    extendNodeSchema() {
      // Copied as text, a chord is written the ChordPro way.
      return { leafText: (node: PMNode) => `[${node.attrs.raw as string}]` };
    },
    addNodeView() {
      return ({ node, getPos }) => new ChordView(node, getPos, events);
    },
    addInputRules() {
      // "[G]" typed in the lyrics becomes a chord (anything that isn't a chord, like "[x2]", stays text).
      return [
        new InputRule({
          find: /\[([^[\]\s]{1,64})\]$/,
          handler: ({ state, range, match }) => {
            if (!parseChord(match[1]!)) return null;
            if (state.doc.resolve(range.from).parent.attrs.kind === "note") return null;
            state.tr.replaceWith(range.from, range.to, this.type.create({ id: generateId(ID_PREFIXES.chord), raw: match[1] }));
          },
        }),
      ];
    },
  });
}

// --- helpers

const isChord = (node: PMNode | null | undefined) => node?.type.name === "chord";

/** Every chord in the document, in order, with its position and its line's. */
function chordsIn(doc: PMNode) {
  const chords: { node: PMNode; pos: number; line: PMNode; linePos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "line") return node.type.name === "section";
    node.forEach((child, offset) => {
      if (isChord(child)) chords.push({ node: child, pos: pos + 1 + offset, line: node, linePos: pos });
    });
    return false;
  });
  return chords;
}

function composedMapping(transactions: readonly Transaction[]): Mapping {
  const mapping = new Mapping();
  for (const tr of transactions) mapping.appendMapping(tr.mapping);
  return mapping;
}

/** Whether any of the line's characters are still there after `mapping`. */
function lineTextSurvives(line: PMNode, linePos: number, mapping: Mapping): boolean {
  let survives = false;
  line.forEach((child, offset) => {
    if (survives || !child.isText) return;
    const start = linePos + 1 + offset;
    for (let i = 0; i < child.nodeSize && !survives; i++) {
      if (!mapping.mapResult(start + i, 1).deletedAfter) survives = true;
    }
  });
  return survives;
}

const PREFIXES: Record<string, string> = { section: ID_PREFIXES.section, line: ID_PREFIXES.line, chord: ID_PREFIXES.chord };

/** A copy of `node` with fresh IDs throughout (duplicating a section). */
export function withFreshIds(node: PMNode): PMNode {
  const json = node.toJSON() as { type: string; attrs?: Record<string, unknown>; content?: unknown[] };
  const refresh = (item: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (item.attrs && PREFIXES[item.type]) item.attrs.id = generateId(PREFIXES[item.type] as never);
    item.content?.forEach((child) => refresh(child as typeof item));
  };
  refresh(json);
  // A copy is a section of its own: no pass of the original's.
  if (json.attrs && "passId" in json.attrs) json.attrs.passId = null;
  return node.type.schema.nodeFromJSON(json);
}

// --- plugins

/**
 * Deleting text never deletes its chords: a chord whose line is still there
 * (or whose line joined another) comes back where the deletion happened, in
 * its original order. Chords go only when their whole line does, or when
 * removed on purpose (REMOVE_CHORDS_META).
 */
function chordKeeper() {
  return new Plugin({
    key: new PluginKey("songverseChordKeeper"),
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some((tr) => tr.getMeta(REPLACE_META) || isHistoryTransaction(tr))) return null;
      const removedOnPurpose = new Set(transactions.flatMap((tr) => (tr.getMeta(REMOVE_CHORDS_META) as string[] | undefined) ?? []));
      const now = new Set(chordsIn(newState.doc).map((chord) => chord.node.attrs.id as string));
      const missing = chordsIn(oldState.doc).filter((chord) => !now.has(chord.node.attrs.id) && !removedOnPurpose.has(chord.node.attrs.id));
      if (missing.length === 0) return null;

      const mapping = composedMapping(transactions);
      const lineIds = new Set<string>();
      newState.doc.descendants((node) => {
        if (node.type.name === "line") lineIds.add(node.attrs.id as string);
        return node.type.name !== "line";
      });
      const inLine = (pos: number) => newState.doc.resolve(pos).parent.type.name === "line";
      const back = new Map<number, PMNode[]>();
      for (const chord of missing) {
        if (!lineIds.has(chord.line.attrs.id) && !lineTextSurvives(chord.line, chord.linePos, mapping)) continue;
        let target = mapping.map(chord.pos, -1);
        if (!inLine(target)) target = mapping.map(chord.pos, 1);
        if (!inLine(target)) continue;
        back.set(target, [...(back.get(target) ?? []), chord.node]);
      }
      if (back.size === 0) return null;
      const tr = newState.tr;
      for (const [pos, nodes] of [...back].sort((a, b) => b[0] - a[0])) tr.insert(pos, nodes);
      return tr;
    },
  });
}

/**
 * Every section, line and chord keeps a unique ID. A copy (Enter splitting a
 * line, a pasted chord) gets a new one; the original - the node the old ID's
 * position maps to - keeps its own.
 */
function uniqueIds() {
  return new Plugin({
    key: new PluginKey("songverseUniqueIds"),
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const oldPositions = new Map<string, number>();
      oldState.doc.descendants((node, pos) => {
        if (PREFIXES[node.type.name] && node.attrs.id) oldPositions.set(node.attrs.id as string, pos);
      });
      const byId = new Map<string, { pos: number; node: PMNode }[]>();
      const blank: { pos: number; node: PMNode }[] = [];
      newState.doc.descendants((node, pos) => {
        if (!PREFIXES[node.type.name]) return;
        const id = node.attrs.id as string | null;
        if (!id) blank.push({ pos, node });
        else byId.set(id, [...(byId.get(id) ?? []), { pos, node }]);
      });
      const mapping = composedMapping(transactions);
      const renew: { pos: number; node: PMNode }[] = [...blank];
      for (const [id, entries] of byId) {
        if (entries.length < 2) continue;
        const old = oldPositions.get(id);
        const kept = old === undefined ? 0 : Math.max(0, entries.findIndex((entry) => entry.pos === mapping.map(old)));
        renew.push(...entries.filter((_, index) => index !== kept));
      }
      // A pass is one block: a section or linked copy pasted twice gets a pass of its own.
      const passes = new Map<string, number[]>();
      newState.doc.forEach((node, pos) => {
        const passId = node.attrs.passId as string | null | undefined;
        if (passId) passes.set(passId, [...(passes.get(passId) ?? []), pos]);
      });
      const oldPasses = new Map<string, number>();
      oldState.doc.forEach((node, pos) => {
        if (node.attrs.passId) oldPasses.set(node.attrs.passId as string, pos);
      });
      const renewPasses: number[] = [];
      for (const [passId, positions] of passes) {
        if (positions.length < 2) continue;
        const old = oldPasses.get(passId);
        const kept = old === undefined ? 0 : Math.max(0, positions.indexOf(mapping.map(old)));
        renewPasses.push(...positions.filter((_, index) => index !== kept));
      }
      if (renew.length === 0 && renewPasses.length === 0) return null;
      const tr = newState.tr;
      for (const { pos, node } of renew) tr.setNodeAttribute(pos, "id", generateId(PREFIXES[node.type.name] as never));
      for (const pos of renewPasses) tr.setNodeAttribute(pos, "passId", generateId(ID_PREFIXES.flowItem));
      return tr.setMeta("addToHistory", false);
    },
  });
}

/** A text's width in the editor's lettering (its chords bold), in pixels. */
export type TextMeasure = (text: string, bold: boolean) => number;

/** Measures text as the editor draws it (issue #249): whatever its font, proportional or not. */
function textMeasure(dom: HTMLElement): TextMeasure | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const style = getComputedStyle(dom);
  const fonts = { regular: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, bold: `${style.fontStyle} 700 ${style.fontSize} ${style.fontFamily}` };
  const cache = new Map<string, number>();
  return (text, bold) => {
    const key = `${bold ? 1 : 0}${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      context.font = bold ? fonts.bold : fonts.regular;
      width = context.measureText(text).width;
      cache.set(key, width);
    }
    return width;
  };
}

const RELAYOUT_META = "songverse:relayout";
const remeasurers = new WeakMap<EditorView, () => void>();
/** Measures the chords' room again: the editor's lettering changed (the Display panel's font, say). */
export function remeasureChords(view: EditorView) {
  remeasurers.get(view)?.();
}

/**
 * Room for chords close together, as the chart draws them: when a chord is
 * wider than the text before the next one, a gap is added before that next
 * chord (with a hyphen when it splits a word), so each stays over its own
 * character. See layoutChordLine in @songverse/core. Widths are measured in
 * the editor's own lettering (issue #249); before it can measure, in `ch`.
 */
function spacingDecorations(doc: PMNode, measure: TextMeasure | null): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((line, linePos) => {
    if (line.type.name !== "line") return line.type.name === "section";
    const items: { chord?: PMNode; text?: string; pos: number }[] = [];
    line.forEach((child, offset) => items.push({ ...(isChord(child) ? { chord: child } : { text: child.text ?? "" }), pos: linePos + 1 + offset }));
    for (let i = 0; i < items.length; i++) {
      const chord = items[i]!.chord;
      if (!chord) continue;
      let between = "";
      let j = i + 1;
      for (; j < items.length && !items[j]!.chord; j++) between += items[j]!.text;
      const next = items[j];
      if (!next) continue;
      const raw = chord.attrs.raw as string;
      // A space's room after the chord, as the chart leaves.
      const missing = measure ? Math.ceil(measure(`${raw} `, true) - measure(between, false)) : raw.length + 1 - between.length;
      if (missing <= 0) continue;
      const width = measure ? `${missing}px` : `${missing}ch`;
      const after = items[j + 1]?.text?.[0];
      const hyphen = /\S$/.test(between) && !!after && /\S/.test(after);
      decorations.push(
        Decoration.widget(
          next.pos,
          () => {
            const gap = document.createElement("span");
            gap.className = "sv-chord-gap";
            gap.style.width = width;
            if (hyphen) gap.textContent = "-";
            return gap;
          },
          { side: -1, key: `gap:${width}:${hyphen}`, ignoreSelection: true },
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const spacingKey = new PluginKey<DecorationSet>("songverseChordSpacing");
function chordSpacing() {
  let measure: TextMeasure | null = null;
  return new Plugin<DecorationSet>({
    key: spacingKey,
    state: {
      init: (_, state) => spacingDecorations(state.doc, measure),
      apply: (tr, previous) => (tr.docChanged || tr.getMeta(RELAYOUT_META) ? spacingDecorations(tr.doc, measure) : previous),
    },
    props: { decorations: (state) => spacingKey.getState(state) },
    view(view) {
      let live = true;
      // Measured once the editor is in the page, and again once its fonts have loaded.
      const remeasure = () => {
        if (!live || !view.dom.isConnected) return;
        measure = textMeasure(view.dom);
        view.dispatch(view.state.tr.setMeta(RELAYOUT_META, true).setMeta("addToHistory", false));
      };
      remeasurers.set(view, remeasure);
      requestAnimationFrame(remeasure);
      void document.fonts?.ready.then(remeasure);
      return {
        destroy() {
          live = false;
          remeasurers.delete(view);
        },
      };
    },
  });
}

const dropKey = new PluginKey<number | null>("songverseDropTarget");
/** Where a dragged chord would land: a caret, and the character it would sit over. */
function dropTarget() {
  return new Plugin<number | null>({
    key: dropKey,
    state: {
      init: () => null,
      apply: (tr, previous) => {
        const meta = tr.getMeta(DROP_TARGET_META) as number | null | undefined;
        if (meta !== undefined) return meta;
        return previous === null ? null : tr.mapping.map(previous);
      },
    },
    props: {
      decorations(state) {
        const target = dropKey.getState(state);
        if (target === null || target === undefined) return null;
        const decorations = [
          Decoration.widget(target, () => {
            const caret = document.createElement("span");
            caret.className = "sv-drop-caret";
            return caret;
          }),
        ];
        const next = nextCharacter(state.doc.resolve(target));
        if (next) decorations.push(Decoration.inline(next.from, next.to, { class: "sv-drop-target" }));
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/** The character after `$pos` in its line (past any chords), as a document range. */
function nextCharacter($pos: ResolvedPos): { from: number; to: number } | null {
  let pos = $pos.pos;
  const end = $pos.end();
  while (pos < end) {
    const node = $pos.doc.nodeAt(pos);
    if (!node) return null;
    if (node.isText) {
      const code = node.text!.charCodeAt(0);
      return { from: pos, to: pos + (code >= 0xd800 && code <= 0xdbff ? 2 : 1) };
    }
    pos += node.nodeSize;
  }
  return null;
}

/** The character before `$pos` in its line (past any chords). */
function previousCharacter($pos: ResolvedPos): { from: number; to: number } | null {
  let pos = $pos.pos;
  const start = $pos.start();
  while (pos > start) {
    const $at = $pos.doc.resolve(pos);
    const node = $at.nodeBefore;
    if (!node) return null;
    if (node.isText) {
      const code = node.text!.charCodeAt(node.text!.length - 1);
      return { from: pos - (code >= 0xdc00 && code <= 0xdfff ? 2 : 1), to: pos };
    }
    pos -= node.nodeSize;
  }
  return null;
}

// --- commands on chords

export function selectedChord(state: EditorState): { pos: number; node: PMNode } | null {
  const selection = state.selection;
  return selection instanceof NodeSelection && isChord(selection.node) ? { pos: selection.from, node: selection.node } : null;
}

/** Moves the chord at `pos` to `target` (a position in any line), keeping it selected. */
export function moveChord(view: EditorView, pos: number, target: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!isChord(node) || target === pos || target === pos + 1) return false;
  const $target = view.state.doc.resolve(target);
  if ($target.parent.type.name !== "line" || $target.parent.attrs.kind === "note") return false;
  const tr = view.state.tr.delete(pos, pos + 1);
  const to = tr.mapping.map(target);
  tr.insert(to, node!);
  tr.setSelection(NodeSelection.create(tr.doc, to)).scrollIntoView();
  view.dispatch(tr);
  return true;
}

/** Moves the chord at `pos` one character left or right along its line. */
export function nudgeChord(view: EditorView, pos: number, direction: -1 | 1): boolean {
  const $pos = view.state.doc.resolve(direction === 1 ? pos + 1 : pos);
  const character = direction === 1 ? nextCharacter($pos) : previousCharacter($pos);
  if (!character) return false;
  return moveChord(view, pos, direction === 1 ? character.to : character.from);
}

export function deleteChord(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos);
  if (!isChord(node)) return;
  const tr = view.state.tr.delete(pos, pos + 1).setMeta(REMOVE_CHORDS_META, [node!.attrs.id]);
  tr.setSelection(TextSelection.create(tr.doc, pos));
  view.dispatch(tr);
  view.focus();
}

export function setChordSymbol(view: EditorView, pos: number, raw: string) {
  const node = view.state.doc.nodeAt(pos);
  const symbol = raw.trim().slice(0, 64);
  if (!isChord(node) || !symbol || symbol === node!.attrs.raw) return;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, raw: symbol });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
}

/** Adds a chord at `at` (default: the cursor), selected so it can be moved or changed straight away. */
export function insertChord(view: EditorView, raw: string, at?: number): boolean {
  const { state } = view;
  const pos = at ?? state.selection.from;
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.name !== "line" || $pos.parent.attrs.kind === "note") return false;
  const node = state.schema.nodes.chord!.create({ id: generateId(ID_PREFIXES.chord), raw: raw.trim() });
  const tr = state.tr.insert(pos, node);
  tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  return true;
}

/** Replaces the whole document (loading, text mode) without chord keeping. */
export function replaceDocument(view: EditorView, doc: PMNode, addToHistory: boolean) {
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta(REPLACE_META, true);
  if (!addToHistory) tr.setMeta("addToHistory", false);
  view.dispatch(tr);
}

// --- commands on sections

/** The section around the selection: its position and node. */
export function currentSection(state: EditorState): { pos: number; node: PMNode } | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "section") return { pos: $from.before(depth), node: $from.node(depth) };
  }
  const node = state.doc.nodeAt(state.selection.from);
  return node?.type.name === "section" ? { pos: state.selection.from, node } : null;
}

/** A new, empty section after the current one (or at the end), with the cursor in it. */
export function addSection(view: EditorView, type: SectionType) {
  const current = currentSection(view.state);
  insertSection(view, type, current ? current.pos + current.node.nodeSize : view.state.doc.content.size);
}

/** A new, empty section at `at` (between two sections), with the cursor in it. */
export function insertSection(view: EditorView, type: SectionType, at: number) {
  const { state } = view;
  const json = sectionsToEditorJSON([]).content![0]!;
  json.attrs = { ...json.attrs, type };
  const node = state.schema.nodeFromJSON(json);
  const tr = state.tr.insert(at, node);
  tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
}

/** Where a section dropped at height `y` (on screen) goes: before the first section whose middle is below it, or at the end; and the height to show that at. */
export function sectionDropAt(view: EditorView, y: number): { pos: number; top: number } {
  let pos = 0;
  let top: number | null = null;
  let end = view.dom.getBoundingClientRect().bottom;
  view.state.doc.forEach((node, offset) => {
    if (top !== null) return;
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    if (!dom?.getBoundingClientRect) return;
    const rect = dom.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) top = rect.top;
    else {
      pos = offset + node.nodeSize;
      end = rect.bottom;
    }
  });
  return { pos, top: top ?? end };
}

export function deleteSection(view: EditorView, pos: number) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (node?.type.name !== "section") return;
  const ids = chordsIn(state.doc)
    .filter((chord) => chord.pos > pos && chord.pos < pos + node.nodeSize)
    .map((chord) => chord.node.attrs.id as string);
  const tr = state.tr.setMeta(REMOVE_CHORDS_META, ids);
  if (state.doc.childCount === 1) {
    tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(sectionsToEditorJSON([]).content![0]!));
  } else {
    tr.delete(pos, pos + node.nodeSize);
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
  view.dispatch(tr);
}

export function duplicateSection(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== "section") return;
  const at = pos + node.nodeSize;
  const tr = view.state.tr.insert(at, withFreshIds(node));
  tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView();
  view.dispatch(tr);
}

export function moveSection(view: EditorView, pos: number, direction: -1 | 1) {
  const { state } = view;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index(0);
  const node = state.doc.child(index);
  const neighbour = index + direction;
  if (neighbour < 0 || neighbour >= state.doc.childCount) return;
  const other = state.doc.child(neighbour);
  const tr = state.tr;
  if (direction === -1) {
    const start = pos - other.nodeSize;
    tr.replaceWith(start, pos + node.nodeSize, [node, other]);
  } else {
    tr.replaceWith(pos, pos + node.nodeSize + other.nodeSize, [other, node]);
  }
  view.dispatch(tr.scrollIntoView());
}

/** Every chord rewritten by `change` (transposing the song) - one undoable step. */
/** Every chord changed by `change`, and the song's key set to `key` with them (one step to undo). */
export function transposeChords(view: EditorView, change: (raw: string) => string, key?: string | null) {
  const tr = view.state.tr;
  for (const chord of chordsIn(view.state.doc)) {
    const raw = change(chord.node.attrs.raw as string);
    if (raw !== chord.node.attrs.raw) tr.setNodeMarkup(chord.pos, undefined, { ...chord.node.attrs, raw });
  }
  if (key !== undefined && key !== view.state.doc.attrs.key) tr.setDocAttribute("key", key);
  if (tr.docChanged) view.dispatch(tr);
}

/** The song's key as the document has it, set from outside (the key picker, Song info): not a step to undo. */
export function setDocumentKey(view: EditorView, key: string | null) {
  if (view.state.doc.attrs.key === key) return;
  view.dispatch(view.state.tr.setDocAttribute("key", key).setMeta("addToHistory", false).setMeta(REPLACE_META, true));
}

/** Toggles the lines in the selection between lyrics and a note for the band (a line with chords stays lyrics). */
export function toggleNoteLine(view: EditorView) {
  const { state } = view;
  const tr = state.tr;
  const lines: { pos: number; node: PMNode }[] = [];
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name === "line") lines.push({ pos, node });
    return node.type.name !== "line";
  });
  const toNote = lines.some((line) => line.node.attrs.kind !== "note");
  for (const line of lines) {
    let hasChords = false;
    line.node.forEach((child) => (hasChords ||= isChord(child)));
    if (toNote && hasChords) continue;
    tr.setNodeAttribute(line.pos, "kind", toNote ? "note" : "lyric");
  }
  if (tr.docChanged) view.dispatch(tr);
}

// --- keys and paste

function handleKeyDown(view: EditorView, event: KeyboardEvent, events: ChordViewEvents): boolean {
  const { state } = view;
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  const chord = selectedChord(state);
  if (chord) {
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && plain && !event.shiftKey) {
      nudgeChord(view, chord.pos, event.key === "ArrowLeft" ? -1 : 1);
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      deleteChord(view, chord.pos);
      return true;
    }
    if (event.key === "Escape") {
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, chord.pos + 1)));
      return true;
    }
    if (event.key === "Enter" && plain) {
      events.onEditChord();
      return true;
    }
    return false;
  }

  // Backspace/Delete next to a chord removes the character beyond it, never the chord.
  const selection = state.selection;
  if (!selection.empty || !plain || selection.$from.parent.type.name !== "line") return false;
  if (event.key === "Backspace" && isChord(selection.$from.nodeBefore)) {
    const character = previousCharacter(selection.$from);
    if (character) {
      view.dispatch(state.tr.delete(character.from, character.to));
      return true;
    }
    // Nothing before the chords: join with the line above, as at the start of any line.
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, selection.$from.start())));
    return joinBackward(view.state, view.dispatch, view);
  }
  if (event.key === "Delete" && isChord(selection.$from.nodeAfter)) {
    const character = nextCharacter(selection.$from);
    if (character) {
      view.dispatch(state.tr.delete(character.from, character.to));
      return true;
    }
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, selection.$from.end())));
    return joinForward(view.state, view.dispatch, view);
  }
  return false;
}

/**
 * Pasting a chart (ChordPro, chords over lyrics, lyrics with headings)
 * turns it into lines and chords at the cursor - new sections when it has
 * several. Plain words, and copies from this editor, paste as usual.
 */
function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const html = event.clipboardData?.getData("text/html") ?? "";
  if (html.includes("data-sv-line") || html.includes("data-sv-chord")) return false;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!text.trim()) return false;
  const format = detectImportFormat(text);
  const multiline = text.trim().includes("\n");
  if (format === "RAW_TEXT" && !multiline) return false;
  let sections;
  try {
    sections = sectionsFromText(text, format);
  } catch {
    return false;
  }
  if (sections.length === 0) return false;
  const { state } = view;
  const parsed = state.schema.nodeFromJSON(sectionsToEditorJSON(sections));
  const current = currentSection(state);
  const tr = state.tr;
  const headed = sections.length > 1 || /^\s*(\{|\[?(verse|chorus|bridge|intro|outro|pre-?chorus|tag|refrain|couplet|pont)\b)/im.test(text);

  if (!headed || !current) {
    // Lines at the cursor: the first joins the line it's pasted into, the last carries on with the rest of it.
    const lines: PMNode[] = [];
    parsed.forEach((section) => section.forEach((line) => lines.push(line)));
    tr.replaceSelection(new Slice(Fragment.from(lines), 1, 1));
  } else {
    const empty = current.node.textContent.trim() === "" && chordsIn(current.node).length === 0;
    const $from = state.selection.$from;
    const atStart = $from.pos === current.pos + 2;
    const atEnd = $from.pos === current.pos + current.node.nodeSize - 2;
    if (empty) tr.replaceWith(current.pos, current.pos + current.node.nodeSize, parsed.content);
    else if (atStart) tr.insert(current.pos, parsed.content);
    else if (atEnd) tr.insert(current.pos + current.node.nodeSize, parsed.content);
    else tr.replaceSelection(new Slice(parsed.content, 0, 0));
  }
  view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
  return true;
}

/** The whole editor: pass the chord events the React side handles. */
export function songEditorExtensions(events: ChordViewEvents) {
  const behaviour = Extension.create({
    name: "songverseEditing",
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        chordKeeper(),
        uniqueIds(),
        chordSpacing(),
        dropTarget(),
        new Plugin({
          key: new PluginKey("songverseKeys"),
          props: {
            handleKeyDown: (view, event) => handleKeyDown(view, event, events),
            handlePaste: (view, event) => handlePaste(view, event),
          },
        }),
      ];
    },
  });
  return [SongDoc, Text, SectionNode, LinkedNode, LineNode, chordNode(events), behaviour];
}

export function setDropTarget(view: EditorView, target: number | null) {
  if (dropKey.getState(view.state) === target) return;
  view.dispatch(view.state.tr.setMeta(DROP_TARGET_META, target).setMeta("addToHistory", false));
}

// --- linked copies (issue #205)

/** A linked copy of the section at `pos` (or of the section a copy there follows), right after it, as another pass in the song's order. */
export function duplicateLinked(view: EditorView, pos: number): string | null {
  const node = view.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "section" && node.type.name !== "linked")) return null;
  const passId = generateId(ID_PREFIXES.flowItem);
  // A copy of a copy follows the section too, not the copy.
  const copy = view.state.schema.nodes.linked!.create({ passId, sectionId: node.type.name === "linked" ? node.attrs.sectionId : node.attrs.id });
  view.dispatch(view.state.tr.insert(pos + node.nodeSize, copy).scrollIntoView());
  return passId;
}

/** The linked copy at `pos` replaced by `section` (its changes written in), keeping its pass: made unique. */
export function replaceLinked(view: EditorView, pos: number, section: PMNode) {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "linked") return;
  const withPass = view.state.schema.nodes.section!.create({ ...section.attrs, passId: node.attrs.passId, sung: true }, section.content);
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, withPass).scrollIntoView());
}

/** A section taken out of the song's order (to the end, under "Not in the song order"), or put back (before those). */
export function setSung(view: EditorView, pos: number, sung: boolean) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== "section") return;
  let tr = state.tr.delete(pos, pos + node.nodeSize);
  // Its linked copies go with it when it's no longer sung.
  if (!sung) {
    const copies: number[] = [];
    tr.doc.forEach((child, at) => {
      if (child.type.name === "linked" && child.attrs.sectionId === node.attrs.id) copies.push(at);
    });
    for (const at of copies.reverse()) tr = tr.delete(at, at + tr.doc.nodeAt(at)!.nodeSize);
  }
  let at = tr.doc.content.size;
  if (sung) {
    tr.doc.forEach((child, offset) => {
      if (child.type.name === "section" && child.attrs.sung === false && at === tr.doc.content.size) at = offset;
    });
  }
  tr = tr.insert(at, node.type.create({ ...node.attrs, sung }, node.content));
  view.dispatch(tr.scrollIntoView());
}

/** The linked copy at `pos` removed: the section sung once less. */
export function deleteLinked(view: EditorView, pos: number) {
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name === "linked") view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
}

/** A block (section or linked copy) moved one place up or down, among the sung ones. */
export function moveBlock(view: EditorView, pos: number, direction: -1 | 1) {
  const { state } = view;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const $pos = state.doc.resolve(pos);
  const index = $pos.index(0);
  const other = state.doc.maybeChild(index + direction);
  if (!other) return;
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  const target = direction < 0 ? pos - other.nodeSize : pos + other.nodeSize;
  tr.insert(target, node);
  view.dispatch(tr.scrollIntoView());
}
