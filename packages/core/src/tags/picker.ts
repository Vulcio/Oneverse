import { resolveTranslation } from "../i18n/translate.js";
import type { LocaleValue } from "../constants/index.js";
import { foldTagName, tagNames, type MatchableTag } from "./match.js";
import { SEED_TAG_CATEGORIES, TAG_GROUPS } from "./vocabulary.js";

export interface PickableTag extends MatchableTag {
  translations: unknown;
  sortOrder: number;
  group: string | null;
  category: { slug: string };
}

export interface TagPickerGroup<T> {
  /** "theme:salvation", "season"… */
  key: string;
  /** "Theme · Salvation", "Season"… in the locale. */
  label: string;
  tags: T[];
}

const categoryOrder = (slug: string) => {
  const index = SEED_TAG_CATEGORIES.findIndex((category) => category.slug === slug);
  return index === -1 ? SEED_TAG_CATEGORIES.length : index;
};

/**
 * Tags as a picker lists them (issue #37): by category, themes by group,
 * each in the list's own order. Retired tags are left out, except those in
 * `keep` (the ones a song already has).
 */
export function tagPickerGroups<T extends PickableTag>(tags: readonly T[], locale: LocaleValue, keep: readonly string[] = []): TagPickerGroup<T>[] {
  const groups = new Map<string, TagPickerGroup<T> & { order: [number, number] }>();
  for (const tag of tags) {
    if (tag.retired && !keep.includes(tag.id)) continue;
    const category = SEED_TAG_CATEGORIES.find((one) => one.slug === tag.category.slug);
    const categoryLabel = category ? (locale === "fr" ? category.fr : category.label) : tag.category.slug;
    const groupIndex = tag.group ? TAG_GROUPS.findIndex((group) => group.slug === tag.group) : -1;
    const group = groupIndex === -1 ? null : TAG_GROUPS[groupIndex];
    const key = group ? `${tag.category.slug}:${group.slug}` : tag.category.slug;
    if (!groups.has(key)) {
      const label = group ? `${categoryLabel} · ${locale === "fr" ? group.fr : group.en}` : categoryLabel;
      groups.set(key, { key, label, tags: [], order: [categoryOrder(tag.category.slug), groupIndex === -1 ? TAG_GROUPS.length : groupIndex] });
    }
    groups.get(key)!.tags.push(tag);
  }
  return [...groups.values()]
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
    .map(({ key, label, tags: inGroup }) => ({ key, label, tags: inGroup.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)) }));
}

/** Whether typing `query` in a picker finds this tag: by any of its names or aliases, in any language. */
export function tagMatchesQuery(tag: Pick<MatchableTag, "slug" | "label" | "translations" | "aliases">, query: string): boolean {
  const wanted = foldTagName(query);
  return !wanted || tagNames(tag).some((name) => foldTagName(name).includes(wanted));
}

/** A tag's name in the locale. */
export const tagLabel = (tag: Pick<MatchableTag, "label" | "translations">, locale: LocaleValue): string => resolveTranslation(tag.label, tag.translations, locale);
