import { BIBLE_BOOKS, bibleBook, bibleBookChapters, bibleBookName, bibleTestament, type BibleBookLocale, type ImportedBible, type YouVersionBible } from "@oneverse/core";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { ButtonGroup } from "@oneverse/ui/components/button-group";
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxGroupLabel, ComboboxInput, ComboboxItem, ComboboxList } from "@oneverse/ui/components/combobox";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@oneverse/ui/components/popover";
import { cn } from "@oneverse/ui/lib/utils";

/** A version to read: a Bible imported on the server, or one of YouVersion's. */
export interface PickerVersion {
  key: string;
  kind: "imported" | "youversion";
  id: string;
  name: string;
  abbreviation: string | null;
  /** Its books, numbered as BIBLE_BOOKS, with their chapters. */
  books: { number: number; name: string; chapters: number }[];
}

/** A language: its tag ("fr") and its name in the reader's language ("French"). */
export interface PickerLanguage {
  tag: string;
  label: string;
}

/** Languages YouVersion has many versions in, offered besides the reader's and the imported Bibles'. Any other can be typed. */
const COMMON_LANGUAGES = ["en", "fr", "es", "pt", "de", "it", "nl", "ro", "pl", "ru", "uk", "el", "ar", "he", "tr", "fa", "hi", "zh", "ja", "ko", "vi", "th", "id", "tl", "sw", "am", "yo", "ig", "ha", "ht", "mg", "ln", "sv", "no", "da", "fi", "hu", "cs"];

/** A Bible's language as a tag: "fr" for "fr-FR", "FRA" or "fre". */
const THREE_LETTER: Record<string, string> = { eng: "en", fra: "fr", fre: "fr", spa: "es", por: "pt", deu: "de", ger: "de", ita: "it", nld: "nl", dut: "nl", ron: "ro", rum: "ro", pol: "pl", rus: "ru", ukr: "uk", ell: "el", gre: "el", ara: "ar", heb: "he", zho: "zh", chi: "zh", kor: "ko", jpn: "ja", swa: "sw", hat: "ht", mlg: "mg", lin: "ln" };
export function languageTag(language: string | null): string | null {
  if (!language) return null;
  const primary = language.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return THREE_LETTER[primary] ?? (primary.length === 2 ? primary : null);
}

/** The languages to offer: the reader's first, then those of the server's Bibles, then the rest by name. */
export function pickerLanguages(uiLanguage: string, imported: ImportedBible[]): PickerLanguage[] {
  const names = new Intl.DisplayNames([uiLanguage], { type: "language" });
  const label = (tag: string) => {
    try {
      const name = names.of(tag) ?? tag;
      return name.charAt(0).toLocaleUpperCase(uiLanguage) + name.slice(1);
    } catch {
      return tag;
    }
  };
  const ui = uiLanguage.split("-")[0] ?? "en";
  const server = imported.map((bible) => languageTag(bible.language)).filter((tag): tag is string => !!tag && tag !== ui);
  const rest = COMMON_LANGUAGES.filter((tag) => tag !== ui && !server.includes(tag)).map((tag) => ({ tag, label: label(tag) }));
  rest.sort((a, b) => a.label.localeCompare(b.label, uiLanguage));
  return [{ tag: ui, label: label(ui) }, ...[...new Set(server)].map((tag) => ({ tag, label: label(tag) })), ...rest];
}

/** A version as the picker shows it: an imported Bible with its own books, or a YouVersion one with every book. */
export function importedVersion(bible: ImportedBible, locale: BibleBookLocale): PickerVersion {
  return {
    key: `imported:${bible.id}`,
    kind: "imported",
    id: bible.id,
    name: bible.name,
    abbreviation: bible.abbreviation,
    // Only books a reference can name.
    // Named in the reader's language, whatever the Bible's: the picker is theirs.
    books: bible.books.filter((book) => bibleBook(book.number)).map((book) => ({ number: book.number, name: bibleBookName(book.number, locale, book.name), chapters: book.chapters })),
  };
}
export function youVersionVersion(bible: YouVersionBible, locale: BibleBookLocale): PickerVersion {
  return {
    key: `youversion:${bible.id}`,
    kind: "youversion",
    id: String(bible.id),
    name: bible.title,
    abbreviation: bible.abbreviation,
    books: BIBLE_BOOKS.filter((book) => book.number <= 66).map((book) => ({ number: book.number, name: book.names[locale], chapters: bibleBookChapters(book.number) ?? 1 })),
  };
}

type BookOrder = "bible" | "alphabetical";
const ORDER_KEY = "oneverse.bible.bookOrder";

function storedOrder(): BookOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === "alphabetical" ? "alphabetical" : "bible";
  } catch {
    return "bible";
  }
}

/**
 * Picking a passage (issue #310): the language and the version, searched
 * (the reader's language first, any other on offer); then the book - in the
 * Bible's order, Old Testament then New, or from A to Z - its chapter from a
 * grid, and the verses. What's picked is written in the passage's field as a
 * reference ("Jean 3:16-18"), which can be typed too.
 */
export function PassagePicker({
  languages,
  language,
  onLanguage,
  versions,
  version,
  onVersion,
  reference,
  onReference,
  busy,
}: {
  languages: PickerLanguage[];
  language: string;
  onLanguage: (tag: string) => void;
  versions: PickerVersion[];
  version: PickerVersion | null;
  onVersion: (version: PickerVersion) => void;
  reference: string;
  onReference: (reference: string) => void;
  busy: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale: BibleBookLocale = i18n.language.startsWith("fr") ? "fr" : "en";
  const [order, setOrder] = useState<BookOrder>(storedOrder);
  const [bookNumber, setBookNumber] = useState<number | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [chaptersOpen, setChaptersOpen] = useState(false);

  const book = version?.books.find((one) => one.number === bookNumber) ?? null;
  const bookGroups = useMemo(() => {
    const books = version?.books ?? [];
    if (order === "alphabetical") return [{ value: "all", label: "", items: [...books].sort((a, b) => a.name.localeCompare(b.name, i18n.language)) }];
    return (["old", "new", "deuterocanon"] as const)
      .map((testament) => ({ value: testament, label: t(`biblePage.testament_${testament}`), items: books.filter((one) => bibleTestament(one.number) === testament) }))
      .filter((group) => group.items.length > 0);
  }, [version, order, i18n.language, t]);
  const versionGroups = useMemo(
    () =>
      (["imported", "youversion"] as const)
        .map((kind) => ({ value: kind, label: kind === "imported" ? t("biblePage.imported") : "YouVersion", items: versions.filter((one) => one.kind === kind) }))
        .filter((group) => group.items.length > 0),
    [versions, t],
  );

  /** The reference for what's picked, in the reader's language - the names the server reads. */
  function write(next: { book?: number | null; chapter?: number | null; from?: string; to?: string }) {
    const b = next.book !== undefined ? next.book : bookNumber;
    const c = next.chapter !== undefined ? next.chapter : chapter;
    const f = (next.from ?? from).trim();
    const l = (next.to ?? to).trim();
    if (!b) return;
    let text = bibleBookName(b, locale);
    if (c) text += ` ${c}`;
    if (c && f) text += `${locale === "fr" ? "," : ":"}${f}${l && l !== f ? `-${l}` : ""}`;
    onReference(text);
  }

  function pickOrder(next: BookOrder) {
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      // Not kept: Bible order next time.
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="passage-picker">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="bible-language">{t("biblePage.language")}</Label>
          <Combobox<PickerLanguage>
            items={languages}
            value={languages.find((one) => one.tag === language) ?? null}
            onValueChange={(picked) => picked && onLanguage(picked.tag)}
            itemToStringLabel={(one) => one.label}
            isItemEqualToValue={(a, b) => a.tag === b.tag}
            autoHighlight
          >
            <ComboboxInput id="bible-language" placeholder={t("biblePage.searchLanguage")} data-testid="bible-language" />
            <ComboboxContent>
              <ComboboxEmpty>{t("biblePage.noLanguage")}</ComboboxEmpty>
              <ComboboxList>
                {(one: PickerLanguage) => (
                  <ComboboxItem key={one.tag} value={one}>
                    {one.label}
                    <span className="text-xs text-muted-foreground">{one.tag}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bible-version">{t("biblePage.version")}</Label>
          <Combobox<PickerVersion>
            items={versionGroups}
            value={version}
            onValueChange={(picked) => {
              if (!picked) return;
              onVersion(picked);
              // The book stays where the new version has it; the chapter and verses too.
              if (bookNumber && !picked.books.some((one) => one.number === bookNumber)) setBookNumber(null);
            }}
            itemToStringLabel={(one) => (one.abbreviation ? `${one.abbreviation} - ${one.name}` : one.name)}
            isItemEqualToValue={(a, b) => a.key === b.key}
            autoHighlight
          >
            <ComboboxInput id="bible-version" placeholder={versions.length ? t("biblePage.searchVersion") : t("biblePage.noVersion")} disabled={!versions.length} data-testid="bible-version" />
            <ComboboxContent>
              <ComboboxEmpty>{t("biblePage.noVersionFound")}</ComboboxEmpty>
              <ComboboxList>
                {(group: (typeof versionGroups)[number]) => (
                  <ComboboxGroup key={group.value} items={group.items}>
                    <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel>
                    <ComboboxCollection>
                      {(one: PickerVersion) => (
                        <ComboboxItem key={one.key} value={one}>
                          {one.abbreviation ? <span className="font-medium">{one.abbreviation}</span> : null}
                          <span className="truncate">{one.name}</span>
                        </ComboboxItem>
                      )}
                    </ComboboxCollection>
                  </ComboboxGroup>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      </div>

      {version ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <div className="flex h-6 items-center justify-between gap-2">
              <Label htmlFor="bible-book">{t("biblePage.book")}</Label>
              <ButtonGroup aria-label={t("biblePage.bookOrder")}>
                <Button type="button" size="sm" className="h-6 px-2" variant={order === "bible" ? "secondary" : "ghost"} aria-pressed={order === "bible"} onClick={() => pickOrder("bible")} data-testid="bible-order-bible">
                  {t("biblePage.orderBible")}
                </Button>
                <Button type="button" size="sm" className="h-6 px-2" variant={order === "alphabetical" ? "secondary" : "ghost"} aria-pressed={order === "alphabetical"} onClick={() => pickOrder("alphabetical")} data-testid="bible-order-alphabetical">
                  {t("biblePage.orderAlphabetical")}
                </Button>
              </ButtonGroup>
            </div>
            <Combobox<PickerVersion["books"][number]>
              items={bookGroups}
              value={book}
              onValueChange={(picked) => {
                setBookNumber(picked?.number ?? null);
                setChapter(null);
                setFrom("");
                setTo("");
                if (picked) {
                  write({ book: picked.number, chapter: null, from: "", to: "" });
                  // One chapter only (Jude, Philemon): nothing to pick.
                  if (picked.chapters === 1) {
                    setChapter(1);
                    write({ book: picked.number, chapter: 1, from: "", to: "" });
                  } else setChaptersOpen(true);
                }
              }}
              itemToStringLabel={(one) => one.name}
              isItemEqualToValue={(a, b) => a.number === b.number}
              autoHighlight
            >
              <ComboboxInput id="bible-book" placeholder={t("biblePage.searchBook")} data-testid="bible-book" />
              <ComboboxContent>
                <ComboboxEmpty>{t("biblePage.noBook")}</ComboboxEmpty>
                <ComboboxList>
                  {(group: (typeof bookGroups)[number]) => (
                    <ComboboxGroup key={group.value} items={group.items}>
                      {group.label ? <ComboboxGroupLabel>{group.label}</ComboboxGroupLabel> : null}
                      <ComboboxCollection>
                        {(one: PickerVersion["books"][number]) => (
                          <ComboboxItem key={one.number} value={one}>
                            {one.name}
                          </ComboboxItem>
                        )}
                      </ComboboxCollection>
                    </ComboboxGroup>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="flex flex-col gap-2">
            <Label className="h-6">{t("biblePage.chapter")}</Label>
            <Popover open={chaptersOpen} onOpenChange={setChaptersOpen}>
              <PopoverTrigger render={<Button type="button" variant="outline" size="sm" className="h-8 min-w-24 justify-between" disabled={!book} data-testid="bible-chapter" />}>
                {chapter ?? "-"}
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto max-w-[min(92vw,24rem)] p-2">
                <div className="grid max-h-72 grid-cols-8 gap-1 overflow-y-auto" data-testid="bible-chapters">
                  {Array.from({ length: book?.chapters ?? 0 }, (_, i) => i + 1).map((number) => (
                    <Button
                      key={number}
                      type="button"
                      size="sm"
                      variant={number === chapter ? "default" : "ghost"}
                      className={cn("h-8 px-0 tabular-nums")}
                      onClick={() => {
                        setChapter(number);
                        setFrom("");
                        setTo("");
                        write({ chapter: number, from: "", to: "" });
                        setChaptersOpen(false);
                      }}
                    >
                      {number}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bible-verse-from" className="h-6">
              {t("biblePage.verses")}
            </Label>
            <div className="flex items-center gap-1">
              <Input
                id="bible-verse-from"
                inputMode="numeric"
                className="h-8 w-16"
                value={from}
                disabled={!chapter}
                placeholder="1"
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, "");
                  setFrom(value);
                  write({ from: value });
                }}
                data-testid="bible-verse-from"
              />
              <span className="text-muted-foreground">-</span>
              <Input
                inputMode="numeric"
                aria-label={t("biblePage.versesTo")}
                className="h-8 w-16"
                value={to}
                disabled={!chapter || !from}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, "");
                  setTo(value);
                  write({ to: value });
                }}
                data-testid="bible-verse-to"
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="bible-reference">{t("biblePage.passage")}</Label>
        <div className="flex gap-2">
          <Input id="bible-reference" value={reference} maxLength={200} placeholder={t("bibles.referencePlaceholder")} onChange={(event) => onReference(event.target.value)} />
          <Button type="submit" disabled={busy || !version || !reference.trim()} data-testid="bible-read">
            {t("biblePage.read")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("biblePage.passageHint")}</p>
      </div>
    </div>
  );
}
