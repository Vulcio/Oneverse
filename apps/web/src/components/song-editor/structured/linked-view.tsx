import {
  followChords,
  layoutChordLine,
  passEdited,
  prettyChord,
  transposeChord,
  transposeKey,
  wordDiff,
  type LineV2,
  type SectionInstance,
  type SectionType,
  type SectionV2,
  sectionName,
} from "@oneverse/core";
import { NodeViewWrapper, useEditorState, type ReactNodeViewProps } from "@tiptap/react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Link2, Lock, LockOpen, Minus, MoreHorizontal, Plus, RotateCcw, Trash2, Unlink2 } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { cn } from "@oneverse/ui/lib/utils";
import { editorToSections, sectionNumberIn } from "./document";
import { BlockTools, ToolButton } from "./block-tools";
import { deleteLinked, moveBlock } from "./extensions";
import { SectionInserter } from "./section-inserter";
import { useSongOrderActions } from "./song-order-context";

/**
 * A linked copy of a section in the editor (issue #205): where the song
 * sings it again. Locked, it shows the section as this pass sings it,
 * following every change to the section. Its own changes are differences
 * from the section, so it stays linked: moved up or down (transposed),
 * lines left out, words removed (greyed out) or replaced (highlighted),
 * chords changed or left out - edited with "Edit this copy". "Make unique"
 * turns it into a section of its own.
 */
export function LinkedView({ node, editor, getPos }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const actions = useSongOrderActions();
  const passId = node.attrs.passId as string;
  const sectionId = node.attrs.sectionId as string;
  // The section it follows, as the editor has it now.
  const sectionJson = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      let found: SectionV2 | null = null;
      current?.state.doc.forEach((child) => {
        if (!found && child.type.name === "section" && child.attrs.id === sectionId) {
          found = editorToSections(current.state.schema.topNodeType.create(null, [child]))[0] ?? null;
        }
      });
      return JSON.stringify(found);
    },
  });
  const section = sectionJson ? (JSON.parse(sectionJson) as SectionV2 | null) : null;
  const [editing, setEditing] = useState(false);
  const pass: SectionInstance = actions?.pass(passId) ?? { id: passId, sectionId };
  const at = () => getPos() ?? -1;
  const index = editor.state.doc.resolve(Math.max(0, at())).index(0);
  const count = editor.state.doc.childCount;
  const update = (change: Partial<SectionInstance>) => actions?.updatePass(passId, change);
  // Named as the section it sings, by the one rule (issue #344): "Chorus", "Verse 2".
  const number = useEditorState({ editor, selector: ({ editor: current }) => (current ? sectionNumberIn(current.state.doc, sectionId) : null) });
  const name = section ? (sectionName(section, number, (type) => t(`chart.sections.${type as SectionType}`)) ?? t("chart.sections.other")) : "";
  const steps = pass.transpose ?? 0;
  // Its own words, lines or chords: marked *. Only moved up or down shows as its own badge (issue #252).
  const changed = passEdited(pass);
  const open = editing || (actions?.copyOpen(passId) ?? false);
  const songKey = actions?.songKey ?? "";
  const summary = [
    steps ? t(steps > 0 ? "linkedCopy.up_n" : "linkedCopy.down_n", { count: Math.abs(steps) }) + (songKey && transposeKey(songKey, steps) ? ` · ${t("linkedCopy.inKey", { key: prettyChord(transposeKey(songKey, steps)!) })}` : "") : null,
    pass.chords?.length ? t("linkedCopy.ownChords", { count: pass.chords.length }) : null,
    pass.hiddenLines?.length ? t("linkedCopy.linesOut", { count: pass.hiddenLines.length }) : null,
    pass.lyrics?.length ? t("linkedCopy.ownWords") : null,
  ].filter(Boolean);

  if (!section) {
    return (
      <NodeViewWrapper className="sv-linked rounded-lg border border-dashed p-3 font-sans text-xs text-muted-foreground" data-linked-pass={passId}>
        {t("linkedCopy.gone")}
        <button type="button" className="ml-2 underline" onClick={() => deleteLinked(editor.view, at())}>
          {t("linkedCopy.remove")}
        </button>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      // In its section's colour (issue #250): a dashed edge, the same faint wash.
      className={cn(
        "sv-linked group/linked relative rounded-[0.625rem] border border-dashed px-3 py-2 font-sans",
        editing ? "border-primary/60 bg-primary/5" : "border-[var(--section-line)] bg-[var(--section-tint)]",
      )}
      data-section-color={section.type}
      data-linked-pass={passId}
      data-linked-to={sectionId}
      data-editing={editing ? "" : undefined}
      data-testid="linked-copy"
    >
      <div className="@container/block mb-1.5 flex flex-wrap items-center gap-1.5 select-none" contentEditable={false}>
        <Link2 className="size-3.5 text-[var(--section-ink)]" aria-hidden />
        <span className="text-xs font-semibold tracking-wide uppercase">{pass.label || name}</span>
        <span className="text-xs text-muted-foreground">{t("linkedCopy.linkedTo", { section: name })}</span>
        {/* What this copy does, in a word: it stands for the copy when it's folded. */}
        <span className="text-xs text-[var(--section-ink)]" data-testid="linked-summary">
          {summary.length ? summary.join(" · ") : t("linkedCopy.asSung")}
        </span>
        {changed ? (
          <span className="font-semibold text-amber-600 dark:text-amber-400" title={t("songOrder.changed")} aria-label={t("songOrder.changed")} data-pass-changed="">
            *
          </span>
        ) : null}
        <BlockTools
          editor={editor}
          at={at}
          tools={
            // Another copy of the section, with this one's changes.
            <ToolButton className="hidden @xl/block:flex" label={t("structuredEditor.duplicateLinked")} onClick={() => actions?.duplicatePass(passId, at())} testId="block-duplicate-linked">
              <Copy />
            </ToolButton>
          }
          leading={
            <>
              {open ? (
                <>
              {/* The whole copy up or down, by itself. */}
              <span className="mr-1 flex items-center rounded-md border bg-background" role="group" aria-label={t("linkedCopy.transpose")}>
                <button type="button" className="flex size-7 items-center justify-center hover:bg-muted pointer-coarse:size-11 [&_svg]:size-3.5" onClick={() => update({ transpose: steps - 1 || null })} disabled={steps <= -11} aria-label={t("linkedCopy.down")} title={t("linkedCopy.down")} data-testid="linked-transpose-down">
                  <Minus />
                </button>
                <span className="min-w-8 text-center text-xs tabular-nums" data-testid="linked-transpose">
                  {steps > 0 ? `+${steps}` : steps < 0 ? `−${-steps}` : "±0"}
                </span>
                <button type="button" className="flex size-7 items-center justify-center hover:bg-muted pointer-coarse:size-11 [&_svg]:size-3.5" onClick={() => update({ transpose: steps + 1 || null })} disabled={steps >= 11} aria-label={t("linkedCopy.up")} title={t("linkedCopy.up")} data-testid="linked-transpose-up">
                  <Plus />
                </button>
              </span>
              <button
                type="button"
                onClick={() => setEditing(!editing)}
                aria-pressed={editing}
                className={cn("mr-1 flex h-7 items-center gap-1 rounded-md border px-2 text-xs pointer-coarse:h-11 [&_svg]:size-3.5", editing ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
                data-testid="linked-edit"
              >
                {editing ? <LockOpen /> : <Lock />}
                {editing ? t("linkedCopy.done") : t("linkedCopy.edit")}
              </button>
                </>
              ) : null}
              {/* Last before its tools: it keeps its place whether the copy is open or not. */}
              {editing ? null : (
                <button
                  type="button"
                  onClick={() => actions?.setCopyOpen(passId, !open)}
                  aria-expanded={open}
                  className="mr-1 flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-11 [&_svg]:size-3.5"
                  data-testid="linked-toggle"
                >
                  {open ? t("linkedCopy.hide") : t("linkedCopy.show")}
                  {open ? <ChevronUp /> : <ChevronDown />}
                </button>
              )}
            </>
          }
        >
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11" aria-label={t("linkedCopy.menu", { section: name })} />}>
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => actions?.duplicatePass(passId, at())} data-testid="linked-duplicate">
                <Copy />
                {t("structuredEditor.duplicateLinked")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onClick={() => moveBlock(editor.view, at(), -1)}>
                <ArrowUp />
                {t("structuredEditor.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onClick={() => moveBlock(editor.view, at(), 1)}>
                <ArrowDown />
                {t("structuredEditor.moveDown")}
              </DropdownMenuItem>
              {changed ? (
                <DropdownMenuItem onClick={() => update({ transpose: null, chords: undefined, hiddenLines: undefined, lyrics: undefined })} data-testid="linked-as-written">
                  <RotateCcw />
                  {t("linkedCopy.asWritten")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => actions?.makeUnique(passId, at())} data-testid="linked-make-unique">
                <Unlink2 />
                {t("linkedCopy.makeUnique")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteLinked(editor.view, at())}>
                <Trash2 />
                {t("linkedCopy.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </BlockTools>
      </div>
      {open ? (
        <div className={cn("flex flex-col gap-1", !editing && "pointer-events-none text-foreground/70")} contentEditable={false}>
          {section.lines.map((line) => (
            <CopyLine key={line.id} line={line} pass={pass} steps={steps} songKey={actions?.songKey ?? ""} editing={editing} onChange={update} />
          ))}
        </div>
      ) : null}
      {editing ? <p className="mt-1.5 text-xs text-muted-foreground">{t("linkedCopy.hint")}</p> : null}
      <SectionInserter editor={editor} at={() => at() + node.nodeSize} edge="bottom" testId="section-insert" />
    </NodeViewWrapper>
  );
}

/**
 * One line of a linked copy: as the copy sings it, its differences shown -
 * a line left out struck through, words removed greyed out, words added
 * highlighted, chords of its own underlined. Editing: its words, left out
 * or not, and each chord changed or left out.
 */
function CopyLine({
  line,
  pass,
  steps,
  songKey,
  editing,
  onChange,
}: {
  line: LineV2;
  pass: SectionInstance;
  steps: number;
  songKey: string;
  editing: boolean;
  onChange: (change: Partial<SectionInstance>) => void;
}) {
  const { t } = useTranslation();
  const hidden = (pass.hiddenLines ?? []).includes(line.id);
  const words = (pass.lyrics ?? []).find((change) => change.lineId === line.id)?.text;
  const changes = new Map((pass.chords ?? []).map((change) => [change.chordId, change.raw]));
  const spelling = songKey && steps ? (transposeKey(songKey, steps) ?? songKey) : songKey || null;
  const shown = (raw: string) => prettyChord(steps ? transposeChord(raw, steps, spelling) : raw);
  if (line.kind === "note") return <p className="text-xs text-muted-foreground italic">{line.text}</p>;

  // The words with what's removed kept in, greyed out: chords placed over the words they're on.
  const text = words ?? line.text;
  const segments = words === undefined ? [{ kind: "same" as const, text }] : wordDiff(line.text, words);
  const display = segments.map((segment) => segment.text).join("");
  const kinds: ("same" | "removed" | "added")[] = segments.flatMap((segment) => Array.from({ length: segment.text.length }, () => segment.kind));
  // A position in the copy's words, in the text shown (removed words included).
  const toDisplay = (at: number) => {
    let seen = 0;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === "removed") continue;
      if (seen === at) return i;
      seen++;
    }
    return display.length;
  };
  const chords = followChords(line.text, text, line.chords)
    .filter((chord) => changes.get(chord.id) !== null || editing)
    .map((chord) => {
      const own = changes.get(chord.id);
      return { id: chord.id, at: toDisplay(chord.at), label: own === null ? `(${shown(chord.raw)})` : shown(own ?? chord.raw), changed: own !== undefined };
    });
  const own = new Set(chords.filter((chord) => chord.changed).map((chord) => chord.id));
  let offset = 0;
  const cells = layoutChordLine(display, chords).map((word) =>
    word.map((cell) => {
      const start = offset;
      offset += cell.text.length;
      return { ...cell, start };
    }),
  );
  const styled = (from: number, text: string) => {
    const runs: { kind: string; text: string }[] = [];
    for (let i = 0; i < text.length; i++) {
      const kind = kinds[from + i] ?? "same";
      if (runs.at(-1)?.kind === kind) runs.at(-1)!.text += text[i];
      else runs.push({ kind, text: text[i]! });
    }
    return runs.map((run, i) => (
      <span
        key={i}
        className={cn(run.kind === "removed" && "text-muted-foreground/60 line-through", run.kind === "added" && "rounded-sm bg-amber-300/40 dark:bg-amber-500/30")}
        data-word={run.kind === "same" ? undefined : run.kind}
      >
        {run.text}
      </span>
    ));
  };

  const preview = (
    <p className={cn("font-mono text-sm leading-snug", hidden && "text-muted-foreground/60 line-through")} data-copy-line={line.id} data-hidden={hidden ? "" : undefined}>
      {cells.map((word, w) => (
        <Fragment key={w}>
          {w > 0 ? "​" : null}
          <span className="inline-flex whitespace-pre align-bottom">
            {word.map((cell, c) => (
              // The cell as wide as its chords (and a space) or its text, whichever is wider - measured, not counted: a ♭ is wider than a letter.
              <span key={c} className="inline-flex flex-col justify-end" data-copy-cell="">
                {cell.chords.length > 0 ? (
                  <span className="pr-[1ch] font-bold text-primary">
                    {cell.chords.map((chord, k) => (
                      <Fragment key={chord.id ?? k}>
                        {k > 0 ? " " : null}
                        <span className={cn(chord.id && own.has(chord.id) && "underline decoration-amber-500 decoration-2", chord.label.startsWith("(") && "text-muted-foreground/60 line-through")}>
                          {chord.label.replace(/^\((.*)\)$/, "$1")}
                        </span>
                      </Fragment>
                    ))}
                  </span>
                ) : (
                  <span> </span>
                )}
                <span className="flex">
                  {/* Chords after the last letter: a blank under them, so they stay on the chords' row. */}
                  <span>{cell.text ? styled(cell.start, cell.text) : display ? " " : null}</span>
                  {/* In the gap a wider chord leaves inside a word; no width of its own. */}
                  {cell.midWord ? (
                    <span aria-hidden className="w-0 grow overflow-hidden text-center text-muted-foreground">
                      -
                    </span>
                  ) : null}
                </span>
              </span>
            ))}
          </span>
        </Fragment>
      ))}
      {display.length === 0 && cells.length === 0 ? " " : null}
    </p>
  );
  if (!editing) return preview;

  const setWords = (next: string) => {
    const rest = (pass.lyrics ?? []).filter((change) => change.lineId !== line.id);
    onChange({ lyrics: next === line.text ? (rest.length > 0 ? rest : undefined) : [...rest, { lineId: line.id, text: next }] });
  };
  const toggleLine = () => {
    const rest = (pass.hiddenLines ?? []).filter((id) => id !== line.id);
    onChange({ hiddenLines: hidden ? (rest.length > 0 ? rest : undefined) : [...rest, line.id] });
  };
  const setChord = (chordId: string, raw: string | null | undefined) => {
    const rest = (pass.chords ?? []).filter((change) => change.chordId !== chordId);
    onChange({ chords: raw === undefined ? (rest.length > 0 ? rest : undefined) : [...rest, { chordId, raw }] });
  };
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-background p-1.5">
      {preview}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={text}
          disabled={hidden}
          onChange={(event) => setWords(event.target.value)}
          aria-label={t("linkedCopy.words")}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-xs outline-none focus-visible:border-ring disabled:opacity-50"
          data-testid={`linked-words-${line.id}`}
        />
        <button
          type="button"
          onClick={toggleLine}
          aria-pressed={hidden}
          className="flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted [&_svg]:size-3.5"
          data-testid={`linked-line-${line.id}`}
        >
          {hidden ? <Eye /> : <EyeOff />}
          {hidden ? t("linkedCopy.keepLine") : t("linkedCopy.leaveOutLine")}
        </button>
      </div>
      {line.chords.length > 0 && !hidden ? (
        <div className="flex flex-wrap items-center gap-1">
          {line.chords.map((chord) => {
            const change = changes.get(chord.id);
            const left = change === null;
            return (
              <span key={chord.id} className="flex items-center rounded-md border">
                <input
                  value={left ? "" : (change ?? "")}
                  placeholder={chord.raw}
                  disabled={left}
                  maxLength={32}
                  onChange={(event) => setChord(chord.id, event.target.value.trim() ? event.target.value : undefined)}
                  aria-label={t("songOrder.chordOnPass", { chord: chord.raw })}
                  className={cn("h-7 w-16 rounded-l-md bg-transparent px-1.5 font-mono text-xs font-bold outline-none placeholder:font-normal", change ? "text-amber-700 dark:text-amber-400" : "text-primary", left && "line-through")}
                  data-testid={`linked-chord-${chord.id}`}
                />
                <button
                  type="button"
                  onClick={() => setChord(chord.id, left ? undefined : null)}
                  aria-pressed={left}
                  aria-label={left ? t("songOrder.showChord", { chord: chord.raw }) : t("songOrder.hideChord", { chord: chord.raw })}
                  title={left ? t("songOrder.showChord", { chord: chord.raw }) : t("songOrder.hideChord", { chord: chord.raw })}
                  className="flex h-7 items-center border-l px-1 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                  data-testid={`linked-chord-hide-${chord.id}`}
                >
                  {left ? <EyeOff /> : <Eye />}
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
