import { generateId, ID_PREFIXES, passChanged, transposeKey, type SectionInstance, type SectionV2 } from "@songverse/core";
import { ArrowLeft, ArrowRight, Copy, KeyRound, Link2, ListRestart, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { cn } from "@songverse/ui/lib/utils";

const KEY_STEPS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6];

/**
 * The order the song is sung in (docs/song-document-v2.md, "Flow"): each
 * pass through a section, in order, with its own label, key change and
 * note. Sections are stored once; singing one again is another pass here.
 */
export function SongOrder({
  sections,
  flow,
  onChange,
  songKey,
}: {
  sections: SectionV2[];
  flow: SectionInstance[];
  onChange: (flow: SectionInstance[]) => void;
  songKey: string;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const byId = new Map(sections.map((section) => [section.id, section]));
  const nameOf = (section: SectionV2) => section.label || t(`chart.sections.${section.type}`);
  const passes = flow.filter((item) => byId.has(item.sectionId));
  const plain = passes.length === sections.length && passes.every((item, i) => item.sectionId === sections[i]!.id && !item.label && !item.keyChange && !item.note && !passChanged(item));
  const unsung = sections.filter((section) => !passes.some((item) => item.sectionId === section.id));

  // The key in effect before each pass, for naming a key change.
  const keysBefore: (string | null)[] = [];
  let current: string | null = songKey || null;
  for (const item of passes) {
    keysBefore.push(current);
    if (item.keyChange) current = item.keyChange.key;
  }

  const update = (next: SectionInstance[]) => onChange(next);
  const index = passes.findIndex((item) => item.id === selected);
  const pass = index >= 0 ? passes[index]! : null;

  function add(sectionId: string) {
    const item = { id: generateId(ID_PREFIXES.flowItem), sectionId };
    update([...passes, item]);
    setSelected(item.id);
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= passes.length || from === to) return;
    const next = [...passes];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    update(next);
  }
  function edit(change: Partial<SectionInstance>) {
    if (!pass) return;
    update(passes.map((item) => (item.id === pass.id ? { ...item, ...change } : item)));
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="song-order">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("songOrder.title")}</h3>
        {!plain ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs"
            onClick={() => {
              update(sections.map((section) => ({ id: generateId(ID_PREFIXES.flowItem), sectionId: section.id })));
              setSelected(null);
            }}
          >
            <ListRestart />
            {t("songOrder.reset")}
          </Button>
        ) : null}
      </div>
      <ol className="flex flex-wrap items-center gap-1.5" aria-label={t("songOrder.title")}>
        {passes.map((item, i) => {
          const section = byId.get(item.sectionId)!;
          // A section sung again: a linked copy of it (issue #205).
          const linked = passes.findIndex((one) => one.sectionId === item.sectionId) < i;
          return (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => {
                setDragging(i);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(event) => dragging !== null && event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== null) move(dragging, i);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <button
                type="button"
                aria-pressed={item.id === selected}
                data-pass-section={section.type}
                onClick={() => setSelected(item.id === selected ? null : item.id)}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap hover:bg-muted",
                  item.id === selected && "border-primary bg-primary/10",
                  dragging === i && "opacity-40",
                )}
              >
                <span className="text-muted-foreground tabular-nums">{i + 1}</span>
                {linked ? <Link2 className="size-3 text-primary" aria-label={t("linkedCopy.linked")} /> : null}
                <span className="font-medium">{item.label || nameOf(section)}</span>
                {item.keyChange ? (
                  <span className="rounded bg-primary/10 px-1 font-mono text-[10px] text-primary">→{item.keyChange.key}</span>
                ) : null}
                {item.note ? <MessageSquare className="size-3 text-muted-foreground" aria-label={t("songOrder.hasNote")} /> : null}
                {/* Its own chords, lines or transposition (issue #205). */}
                {passChanged(item) ? (
                  <span className="font-semibold text-amber-600 dark:text-amber-400" title={t("songOrder.changed")} aria-label={t("songOrder.changed")} data-pass-changed="">
                    *
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        <li>
          <NativeSelect
            compact
            aria-label={t("songOrder.add")}
            value=""
            onChange={(event) => event.target.value && add(event.target.value)}
            className="h-7 w-auto"
          >
            <option value="">{t("songOrder.addOption")}</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {nameOf(section)}
              </option>
            ))}
          </NativeSelect>
        </li>
      </ol>
      {unsung.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("songOrder.unsung", { sections: unsung.map(nameOf).join(", ") })}
        </p>
      ) : null}

      {pass ? (
        <div className="flex flex-col gap-2 border-t pt-2" data-testid="song-order-pass">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">{t("songOrder.pass", { n: index + 1, section: nameOf(byId.get(pass.sectionId)!) })}</span>
            <div className="ml-auto flex items-center">
              <IconButton label={t("songOrder.earlier")} disabled={index === 0} onClick={() => move(index, index - 1)}>
                <ArrowLeft />
              </IconButton>
              <IconButton label={t("songOrder.later")} disabled={index === passes.length - 1} onClick={() => move(index, index + 1)}>
                <ArrowRight />
              </IconButton>
              <IconButton
                label={t("songOrder.again")}
                onClick={() => {
                  const copy = { id: generateId(ID_PREFIXES.flowItem), sectionId: pass.sectionId };
                  update([...passes.slice(0, index + 1), copy, ...passes.slice(index + 1)]);
                  setSelected(copy.id);
                }}
              >
                <Copy />
              </IconButton>
              <IconButton
                label={t("songOrder.remove")}
                onClick={() => {
                  update(passes.filter((item) => item.id !== pass.id));
                  setSelected(null);
                }}
              >
                <Trash2 className="text-destructive" />
              </IconButton>
              <IconButton label={t("songOrder.close")} onClick={() => setSelected(null)}>
                <X />
              </IconButton>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              aria-label={t("songOrder.label")}
              placeholder={t("songOrder.labelPlaceholder", { section: nameOf(byId.get(pass.sectionId)!) })}
              value={pass.label ?? ""}
              maxLength={100}
              onChange={(event) => edit({ label: event.target.value || null })}
              className="h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" aria-hidden />
              <NativeSelect
                compact
                aria-label={t("songOrder.keyChange")}
                value={pass.keyChange?.steps ?? 0}
                onChange={(event) => {
                  const steps = Number(event.target.value);
                  const before = keysBefore[index];
                  edit({
                    keyChange: steps
                      ? { steps, key: (before && transposeKey(before, steps)) || `${steps > 0 ? "+" : ""}${steps}` }
                      : null,
                  });
                }}
              >
                <option value={0}>{t("songOrder.sameKey")}</option>
                {KEY_STEPS.map((steps) => {
                  const before = keysBefore[index];
                  const key = before ? transposeKey(before, steps) : null;
                  return (
                    <option key={steps} value={steps}>
                      {`${steps > 0 ? "+" : ""}${steps}${key ? ` → ${key}` : ""}`}
                    </option>
                  );
                })}
              </NativeSelect>
            </label>
          </div>
          <input
            aria-label={t("songOrder.note")}
            placeholder={t("songOrder.notePlaceholder")}
            value={pass.note ?? ""}
            maxLength={500}
            onChange={(event) => edit({ note: event.target.value || null })}
            className="h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
          />
        </div>
      ) : (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Plus className="size-3" aria-hidden />
          {t("songOrder.hint")}
        </p>
      )}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="size-7" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
