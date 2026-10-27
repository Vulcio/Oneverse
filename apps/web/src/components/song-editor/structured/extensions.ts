import {
  beatPlaceRange,
  detectImportFormat,
  generateId,
  ID_PREFIXES,
  parseChord,
  placeRhythmBeat,
  sectionsFromText,
  suggestedBarLines,
  type SectionType,
} from "@oneverse/core";
import { Extension, InputRule, Node } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import { joinBackward, joinForward } from "@tiptap/pm/commands";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { cn } from "@oneverse/ui/lib/utils";
import { lineFromNode, linePosition, sectionBeatPlaces, sectionFromNode, sectionsToEditorJSON } from "./document";
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

/** A screen used with a finger (issue #253): there, nothing focuses the chart by itself - that would bring the keyboard up over the page. */
export const touchScreen = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/** Focuses the chart after a change, except on a touch screen (where its keyboard would cover the page). */
export function focusUnlessTouch(view: EditorView) {
  if (!touchScreen()) view.focus();
}

export interface ChordViewEvents {
  /** A pointer went down on a chord's chip: the drag (or click) starts there. */
  onChordPointerDown: (event: PointerEvent, pos: number) => void;
  /** A pointer went down on a bar line (issue #238): the drag (or click) starts there. */
  onBarPointerDown: (event: PointerEvent, pos: number) => void;
  /** Enter on a selected chord: edit its symbol. */
  onEditChord: () => void;
  /** What a beat's dot under the words says to a screen reader and on hover (issue #238); its number alone without. */
  beatLabel?: (beat: number, placed: boolean) => string;
}

// --- nodes

// The song in the order it's sung (issue #205): sections, and linked copies of them where they're sung again.
// Its key is the document's too, so undoing a transposition brings the key back with the chords (issue #248).
const SongDoc = Node.create({
  name: "doc",
  topNode: true,
  content: "section (section | linked)*",
  addAttributes() {
    // `beats`: a bar's beats (the time signature's top number), for placing chords in bar lines' bars (issue #238).
    return { key: { default: null, rendered: false }, beats: { default: 4, rendered: false } };
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
      // The rhythm as loaded: kept as it is while its bar lines (issue #238) stay where they were.
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
    // A tap on a chord selects it, without iOS focusing the chart (and bringing the keyboard up) as the tap ends.
    this.chip.addEventListener("touchend", (event) => event.preventDefault(), { passive: false });
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

/**
 * A bar line (issue #238): where a bar starts in the lyrics, between two
 * characters, as a lead sheet marks it - a thin rule through the chord row
 * and the words, with a knob under them to drag it by (a finger holds it a
 * moment first, as a chord), and "×2" when bars with no words of their own
 * follow it. A press without a drag selects it.
 */
class BarView implements NodeView {
  dom: HTMLElement;
  private count: HTMLElement;

  constructor(
    private node: PMNode,
    getPos: () => number | undefined,
    events: ChordViewEvents,
  ) {
    this.dom = document.createElement("span");
    this.dom.className = "sv-bar";
    this.dom.contentEditable = "false";
    this.dom.dataset.svBar = "";
    const knob = document.createElement("span");
    knob.className = "sv-bar-knob";
    this.count = document.createElement("span");
    this.count.className = "sv-bar-count";
    this.dom.append(knob, this.count);
    this.render();
    this.dom.addEventListener("pointerdown", (event) => {
      const pos = getPos();
      if (pos !== undefined) events.onBarPointerDown(event, pos);
    });
    this.dom.addEventListener("touchend", (event) => event.preventDefault(), { passive: false });
  }

  private render() {
    const bars = (this.node.attrs.bars as number) ?? 1;
    this.dom.dataset.bars = String(bars);
    this.count.textContent = bars > 1 ? `×${bars}` : "";
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.classList.add("sv-bar-selected");
  }

  deselectNode() {
    this.dom.classList.remove("sv-bar-selected");
  }

  stopEvent(event: Event) {
    return /^(pointer|mouse|touch|click|contextmenu)/.test(event.type);
  }

  ignoreMutation() {
    return true;
  }
}

function barNode(events: ChordViewEvents) {
  return Node.create({
    name: "barLine",
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return {
        bars: {
          default: 1,
          parseHTML: (el) => Math.max(1, Number(el.getAttribute("data-bars")) || 1),
          renderHTML: (attrs) => ({ "data-bars": attrs.bars }),
        },
        // Its bars' cues as the rhythm had them ("hold"), kept.
        cues: { default: null, rendered: false },
      };
    },
    parseHTML() {
      return [{ tag: "span[data-sv-bar]" }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["span", { "data-sv-bar": "", ...HTMLAttributes }, "|"];
    },
    renderText() {
      return "|";
    },
    extendNodeSchema() {
      return { leafText: () => "|" };
    },
    addNodeView() {
      return ({ node, getPos }) => new BarView(node, getPos, events);
    },
  });
}

// --- helpers

const isChord = (node: PMNode | null | undefined) => node?.type.name === "chord";
const isBar = (node: PMNode | null | undefined) => node?.type.name === "barLine";

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

/**
 * A change that came from someone typing in the song too (issue #27), or an
 * undo of the shared document: their editor already kept its chords and IDs,
 * so it's taken as it is - fixing it here as well would fix it twice.
 */
function fromElsewhere(tr: Transaction): boolean {
  return !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
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
      if (transactions.some((tr) => tr.getMeta(REPLACE_META) || isHistoryTransaction(tr) || fromElsewhere(tr))) return null;
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
      if (!transactions.some((tr) => tr.docChanged) || transactions.every(fromElsewhere)) return null;
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
 * character. See layoutChordLine in @oneverse/core. Widths are measured in
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

/** Moves the chord (or bar line) at `pos` to `target` (a position in any line), keeping it selected. */
export function moveChord(view: EditorView, pos: number, target: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!(isChord(node) || isBar(node)) || target === pos || target === pos + 1) return false;
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
  focusUnlessTouch(view);
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
  focusUnlessTouch(view);
  return true;
}

// --- commands on bar lines (issue #238)

export function selectedBar(state: EditorState): { pos: number; node: PMNode } | null {
  const selection = state.selection;
  return selection instanceof NodeSelection && isBar(selection.node) ? { pos: selection.from, node: selection.node } : null;
}

/** Moves the bar line at `pos` a letter left or right (before the chords on that letter); on a line of chords alone, past a chord. */
export function nudgeBar(view: EditorView, pos: number, direction: -1 | 1): boolean {
  const { doc } = view.state;
  const $pos = doc.resolve(direction === 1 ? pos + 1 : pos);
  // A line with words: a letter at a time, before the chords on the letter it lands at.
  if ($pos.parent.textContent.length > 0) {
    const character = direction === 1 ? nextCharacter($pos) : previousCharacter($pos);
    if (!character) return false;
    if (direction === 1) return moveChord(view, pos, character.to);
    let target = character.from;
    for (let before = doc.resolve(target).nodeBefore; before && (isChord(before) || isBar(before)); before = doc.resolve(target).nodeBefore) target -= before.nodeSize;
    return moveChord(view, pos, target);
  }
  // A line of chords alone: over the next chord.
  const beside = direction === 1 ? $pos.nodeAfter : $pos.nodeBefore;
  if (!beside || !(isChord(beside) || isBar(beside))) return false;
  return moveChord(view, pos, direction === 1 ? pos + 1 + beside.nodeSize : pos - beside.nodeSize);
}

export function deleteBar(view: EditorView, pos: number) {
  if (!isBar(view.state.doc.nodeAt(pos))) return;
  const tr = view.state.tr.delete(pos, pos + 1);
  tr.setSelection(TextSelection.create(tr.doc, pos));
  view.dispatch(tr);
  focusUnlessTouch(view);
}

/** How many bars start at the bar line at `pos`: 1, or more for bars with no words after it (1 to 16). */
export function setBarCount(view: EditorView, pos: number, bars: number) {
  const node = view.state.doc.nodeAt(pos);
  const count = Math.min(16, Math.max(1, Math.round(bars)));
  if (!isBar(node) || node!.attrs.bars === count) return;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node!.attrs, bars: count, cues: null });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  view.dispatch(tr);
}

/** Adds a bar line at `at` (default: the cursor), selected. */
export function insertBarLine(view: EditorView, at?: number): boolean {
  const { state } = view;
  const pos = at ?? state.selection.from;
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.name !== "line" || $pos.parent.attrs.kind === "note") return false;
  const tr = state.tr.insert(pos, state.schema.nodes.barLine!.create({ bars: 1 }));
  tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView();
  view.dispatch(tr);
  focusUnlessTouch(view);
  return true;
}

/** The sections (one, at `sectionPos`, or all) and their bar lines' positions. */
function sectionsIn(doc: PMNode, sectionPos: number | null): { pos: number; node: PMNode }[] {
  const found: { pos: number; node: PMNode }[] = [];
  doc.forEach((node, pos) => {
    if (node.type.name === "section" && (sectionPos === null || pos === sectionPos)) found.push({ pos, node });
  });
  return found;
}

function barsIn(node: PMNode, from: number): number[] {
  const positions: number[] = [];
  node.descendants((child, pos) => {
    if (isBar(child)) positions.push(from + 1 + pos);
  });
  return positions;
}

/** Whether a section (at `sectionPos`, or any) has bar lines. */
export function hasBarLines(doc: PMNode, sectionPos: number | null = null): boolean {
  return sectionsIn(doc, sectionPos).some((section) => barsIn(section.node, section.pos).length > 0);
}

/** Removes the bar lines of a section (at `sectionPos`) or of the whole song: its bars filled in from the chart again. One step to undo. */
export function clearBarLines(view: EditorView, sectionPos: number | null = null) {
  const tr = view.state.tr;
  const positions = sectionsIn(view.state.doc, sectionPos).flatMap((section) => barsIn(section.node, section.pos));
  for (const pos of positions.sort((a, b) => b - a)) tr.delete(pos, pos + 1);
  if (tr.docChanged) view.dispatch(tr);
}

/**
 * Bar lines where the chart's own bars are (a bar line before each chord,
 * a sung line two bars at least) in a section (at `sectionPos`) or the
 * whole song, in place of any there - a start to move them from. One step
 * to undo.
 */
export function fillBarLines(view: EditorView, sectionPos: number | null = null) {
  const sections = sectionsIn(view.state.doc, sectionPos);
  const tr = view.state.tr;
  for (const pos of sections.flatMap((section) => barsIn(section.node, section.pos)).sort((a, b) => b - a)) tr.delete(pos, pos + 1);
  const inserts: { pos: number; bars: number }[] = [];
  tr.doc.forEach((section, sectionAt) => {
    if (section.type.name !== "section" || !sections.some((one) => one.node.attrs.id === section.attrs.id)) return;
    const lines = new Map<string, { node: PMNode; pos: number }>();
    section.forEach((line, offset) => lines.set(line.attrs.id as string, { node: line, pos: sectionAt + 1 + offset }));
    const marks = suggestedBarLines({ lines: [...lines.values()].map((line) => lineFromNode(line.node)) });
    for (const [lineId, list] of Object.entries(marks)) {
      const line = lines.get(lineId);
      if (line) for (const mark of list) inserts.push({ pos: linePosition(line.node, line.pos, mark.at, mark.chordsBefore), bars: mark.bars });
    }
  });
  for (const insert of inserts.sort((a, b) => b.pos - a.pos)) tr.insert(insert.pos, view.state.schema.nodes.barLine!.create({ bars: insert.bars }));
  if (tr.docChanged) view.dispatch(tr);
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

/** A bar's beats (the time signature's top number) as the document has it, set from Song info: not a step to undo. */
export function setDocumentBeats(view: EditorView, beats: number) {
  if (view.state.doc.attrs.beats === beats) return;
  view.dispatch(view.state.tr.setDocAttribute("beats", beats).setMeta("addToHistory", false).setMeta(REPLACE_META, true));
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
    line.node.forEach((child) => (hasChords ||= isChord(child) || isBar(child)));
    if (toNote && hasChords) continue;
    tr.setNodeAttribute(line.pos, "kind", toNote ? "note" : "lyric");
  }
  if (tr.docChanged) view.dispatch(tr);
}

// --- keys and paste

function handleKeyDown(view: EditorView, event: KeyboardEvent, events: ChordViewEvents): boolean {
  const { state } = view;
  const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
  const bar = selectedBar(state);
  if (bar) {
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && plain && !event.shiftKey) {
      nudgeBar(view, bar.pos, event.key === "ArrowLeft" ? -1 : 1);
      return true;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      deleteBar(view, bar.pos);
      return true;
    }
    if ((event.key === "+" || event.key === "=" || event.key === "-") && !event.metaKey && !event.ctrlKey) {
      setBarCount(view, bar.pos, ((bar.node.attrs.bars as number) ?? 1) + (event.key === "-" ? -1 : 1));
      return true;
    }
    if (event.key === "Escape") {
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, bar.pos + 1)));
      return true;
    }
    return false;
  }
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
        beatDots(events),
        new Plugin({
          key: new PluginKey("songverseKeys"),
          props: {
            handleKeyDown: (view, event) => handleKeyDown(view, event, events),
            handlePaste: (view, event) => handlePaste(view, event),
            // "|" typed in the lyrics is a bar line (issue #238).
            handleTextInput: (view, from, to, text) => {
              if (text !== "|") return false;
              const $from = view.state.doc.resolve(from);
              if ($from.parent.type.name !== "line" || $from.parent.attrs.kind === "note") return false;
              const tr = view.state.tr.replaceWith(from, to, view.state.schema.nodes.barLine!.create({ bars: 1 }));
              view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)).scrollIntoView());
              return true;
            },
          },
        }),
      ];
    },
  });
  return [SongDoc, Text, SectionNode, LinkedNode, LineNode, chordNode(events), barNode(events), behaviour];
}

// --- the beats in the words (issue #238)

/** A beat of a section's bar, picked to put on a letter: its section's ID, the bar (0-based), the beat (1-based). */
type PickedBeat = { sectionId: string; bar: number; beat: number };
const BEAT_META = "songverse:beat";
const beatKey = new PluginKey<{ picked: PickedBeat | null; refused: string | null }>("songverseBeats");

/** Where character `at` of a line (at `linePos`) is in the document: before it, after any chords on it. */
function characterPosition(node: PMNode, linePos: number, at: number): number | null {
  let text = 0;
  let found: number | null = null;
  node.forEach((child, offset) => {
    if (found !== null || !child.isText) return;
    const length = child.text!.length;
    if (at >= text && at < text + length) found = linePos + 1 + offset + (at - text);
    text += length;
  });
  return found;
}

/** The character a document position stands before, in a line of a section: past spaces to the next letter. */
function letterAt(doc: PMNode, pos: number): { sectionPos: number; lineId: string; at: number } | null {
  const $pos = doc.resolve(pos);
  if ($pos.parent.type.name !== "line" || $pos.depth < 2) return null;
  const section = $pos.node($pos.depth - 1);
  if (section.type.name !== "section") return null;
  let at = 0;
  $pos.parent.forEach((child, offset) => {
    if (child.isText && $pos.parentOffset > offset) at += Math.min(child.text!.length, $pos.parentOffset - offset);
  });
  // Its words alone (a chord or a bar line counts as a character in textContent).
  let text = "";
  $pos.parent.forEach((child) => {
    if (child.isText) text += child.text;
  });
  while (at < text.length && /\s/.test(text[at]!)) at++;
  if (at >= text.length) return null;
  return { sectionPos: $pos.before($pos.depth - 1), lineId: $pos.parent.attrs.id as string, at };
}

/** The letter under a point of the screen (not the gap nearest it, as a caret): the position before it. */
function letterPosAt(view: EditorView, x: number, y: number): number | null {
  const found = view.posAtCoords({ left: x, top: y });
  if (!found) return null;
  // Of the letters either side of the gap found, the one the point is over.
  const { doc } = view.state;
  for (const pos of [found.pos, found.pos - 1]) {
    if (pos < 0 || !doc.resolve(pos).parent.isTextblock || !doc.nodeAt(pos)?.isText) continue;
    const from = view.coordsAtPos(pos, 1);
    const to = view.coordsAtPos(pos + 1, -1);
    if (x >= Math.min(from.left, to.left) - 0.5 && x <= Math.max(from.left, to.left) + 0.5) return pos;
  }
  return found.pos;
}

/** Beat `beat` of a section's bar put on a letter, or placed by the grid again (null); false where it can't go. */
function placeBeat(view: EditorView, picked: PickedBeat, letter: { lineId: string; at: number } | null, sectionPos?: number): boolean {
  const { doc } = view.state;
  let at = sectionPos ?? -1;
  if (at < 0) doc.forEach((node, offset) => (node.type.name === "section" && node.attrs.id === picked.sectionId ? (at = offset) : undefined));
  const node = at >= 0 ? doc.nodeAt(at) : null;
  const beats = (doc.attrs.beats as number | undefined) ?? 4;
  const section = node ? sectionFromNode(node, beats) : null;
  const placed = section ? sectionBeatPlaces(section, beats) : null;
  if (!node || !section?.rhythm || !placed || node.attrs.id !== picked.sectionId) return false;
  if (letter && !beatPlaceRange(placed.chart, placed.bars, picked.bar, picked.beat).some((span) => span.lineId === letter.lineId && letter.at >= span.from && letter.at < span.to)) return false;
  const rhythm = placeRhythmBeat(section.rhythm, picked.bar, picked.beat, letter, beats);
  if (!rhythm) return false;
  view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, rhythm }).setMeta(BEAT_META, { picked: null }));
  return true;
}

function refuse(view: EditorView, key: string) {
  view.dispatch(view.state.tr.setMeta(BEAT_META, { refused: key }).setMeta("addToHistory", false));
  window.setTimeout(() => {
    if (!view.isDestroyed && beatKey.getState(view.state)?.refused === key) view.dispatch(view.state.tr.setMeta(BEAT_META, { refused: null }).setMeta("addToHistory", false));
  }, 700);
}

function beatDecorations(state: EditorState, events: ChordViewEvents): DecorationSet {
  const { picked, refused } = beatKey.getState(state) ?? { picked: null, refused: null };
  const beats = (state.doc.attrs.beats as number | undefined) ?? 4;
  const decorations: Decoration[] = [];
  state.doc.forEach((node, sectionPos) => {
    const section = sectionFromNode(node, beats);
    const placed = section ? sectionBeatPlaces(section, beats) : null;
    if (!section || !placed) return;
    const lines = new Map<string, { node: PMNode; pos: number }>();
    node.forEach((line, offset) => lines.set(line.attrs.id as string, { node: line, pos: sectionPos + 1 + offset }));
    placed.places.forEach((places, bar) => {
      let last: number | null = null;
      let held = 0;
      places.forEach((place, index) => {
        // Beat 1 is the bar line itself.
        if (index === 0) {
          const line = place ? lines.get(place.lineId) : undefined;
          last = line && place ? characterPosition(line.node, line.pos, place.at) : null;
          return;
        }
        const line = place ? lines.get(place.lineId) : undefined;
        const pos = line && place ? characterPosition(line.node, line.pos, place.at) : last;
        if (pos === null) return;
        last = pos;
        // Held beats one after another beside the beat before.
        held = place ? 0 : held + 1;
        const offset = held;
        const beat = index + 1;
        const key = `${section.id}:${bar}:${beat}`;
        const isPicked = picked?.sectionId === section.id && picked.bar === bar && picked.beat === beat;
        const state = `${place ? (place.placed ? "placed" : "auto") : "held"}${isPicked ? "-picked" : ""}${refused === key ? "-refused" : ""}`;
        decorations.push(
          Decoration.widget(
            pos,
            () => {
              const dot = document.createElement("span");
              dot.className = cn("sv-beat", `sv-beat-${place ? (place.placed ? "placed" : "auto") : "held"}`, isPicked && "sv-beat-picked", refused === key && "sv-beat-refused");
              dot.contentEditable = "false";
              dot.dataset.svBeat = String(beat);
              dot.dataset.sectionId = section.id;
              dot.dataset.bar = String(bar);
              if (place?.placed) dot.dataset.placed = "";
              const label = events.beatLabel?.(beat, !!place?.placed) ?? String(beat);
              dot.title = label;
              dot.setAttribute("role", "button");
              dot.setAttribute("aria-label", label);
              const number = document.createElement("span");
              number.className = "sv-beat-dot";
              // Drawn by its CSS, not as text: the line's text stays its words.
              number.dataset.n = String(beat);
              if (offset > 0) number.style.left = `${offset * 1.4}em`;
              dot.append(number);
              return dot;
            },
            { side: index, key: `${key}:${state}:${offset}`, ignoreSelection: true },
          ),
        );
      });
    });
  });
  return DecorationSet.create(state.doc, decorations);
}

/**
 * A bar's beats under its words in the editor (issue #238), where its
 * section has bar lines: a small number under the letter each is sung on,
 * as the chord grid places them. Dragged onto another letter of its bar, or
 * tapped and then a letter, it's placed there by hand (the section's
 * `rhythm`); tapped twice, placed by the grid again.
 */
function beatDots(events: ChordViewEvents) {
  let cached: { doc: PMNode; picked: unknown; refused: unknown; set: DecorationSet } | null = null;
  // The click that ends a press on a dot: the dot is drawn again by then, so it lands on the words under it.
  let dotPressed = false;
  return new Plugin<{ picked: PickedBeat | null; refused: string | null }>({
    key: beatKey,
    state: {
      init: () => ({ picked: null, refused: null }),
      apply: (tr, previous) => {
        const meta = tr.getMeta(BEAT_META) as Partial<{ picked: PickedBeat | null; refused: string | null }> | undefined;
        return meta ? { ...previous, ...meta } : previous;
      },
    },
    props: {
      decorations(state) {
        const { picked, refused } = beatKey.getState(state)!;
        if (cached && cached.doc === state.doc && cached.picked === picked && cached.refused === refused) return cached.set;
        cached = { doc: state.doc, picked, refused, set: beatDecorations(state, events) };
        return cached.set;
      },
      // A dot's click is its press's (above).
      handleClick: (_, __, event) => !!(event.target as HTMLElement | null)?.closest?.("[data-sv-beat]"),
      handleDOMEvents: {
        // A letter tapped with a beat picked: the beat goes there. As the click comes, not as the editor reads it (a second click
        // near the dot just tapped would be its double-click).
        click(view, event) {
          if (dotPressed) {
            dotPressed = false;
            return true;
          }
          const picked = beatKey.getState(view.state)?.picked;
          if (!picked || (event.target as HTMLElement | null)?.closest?.("[data-sv-beat]")) return false;
          const pos = letterPosAt(view, event.clientX, event.clientY);
          const letter = pos === null ? null : letterAt(view.state.doc, pos);
          if (!letter || !placeBeat(view, picked, letter, letter.sectionPos)) refuse(view, `${picked.sectionId}:${picked.bar}:${picked.beat}`);
          event.preventDefault();
          return true;
        },
        // A dot's press is its own: no caret, no selection.
        mousedown(_, event) {
          if (!(event.target as HTMLElement | null)?.closest?.("[data-sv-beat]")) return false;
          event.preventDefault();
          return true;
        },
        pointerdown(view, event) {
          const dot = (event.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-sv-beat]");
          dotPressed = false;
          if (!dot || event.button !== 0 || !view.editable) return false;
          event.preventDefault();
          dotPressed = true;
          const picked: PickedBeat = { sectionId: dot.dataset.sectionId!, bar: Number(dot.dataset.bar), beat: Number(dot.dataset.svBeat) };
          const start = { x: event.clientX, y: event.clientY };
          const fontSize = parseFloat(getComputedStyle(view.dom).fontSize) || 16;
          let dragging = false;
          let target: number | null = null;
          // The dot is under the words: the letter just over the pointer.
          const targetAt = (x: number, y: number) => letterPosAt(view, x, y - fontSize);
          const move = (e: PointerEvent) => {
            if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
            dragging = true;
            target = targetAt(e.clientX, e.clientY);
            setDropTarget(view, target);
          };
          const up = (e: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            setDropTarget(view, null);
            const key = `${picked.sectionId}:${picked.bar}:${picked.beat}`;
            if (!dragging) {
              const current = beatKey.getState(view.state)?.picked;
              const same = current?.sectionId === picked.sectionId && current.bar === picked.bar && current.beat === picked.beat;
              // Tapped again: a beat placed by hand goes back to where the grid puts it; one it placed, let go.
              if (same && dot.dataset.placed !== undefined) placeBeat(view, picked, null);
              else view.dispatch(view.state.tr.setMeta(BEAT_META, { picked: same ? null : picked }).setMeta("addToHistory", false));
              return;
            }
            target = targetAt(e.clientX, e.clientY);
            const letter = target === null ? null : letterAt(view.state.doc, target);
            if (!letter || !placeBeat(view, picked, letter, letter.sectionPos)) refuse(view, key);
          };
          const cancel = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", cancel);
            setDropTarget(view, null);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", cancel);
          return true;
        },
      },
    },
  });
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

/** A linked copy of the section `sectionId` at `at` (between two blocks): the section sung again there (issue #250). */
export function insertLinked(view: EditorView, sectionId: string, at: number) {
  const copy = view.state.schema.nodes.linked!.create({ passId: generateId(ID_PREFIXES.flowItem), sectionId });
  view.dispatch(view.state.tr.insert(at, copy).scrollIntoView());
  focusUnlessTouch(view);
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
