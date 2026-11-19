import { foldForSearch } from "../search-text/index.js";
import type { TagAliases } from "./vocabulary.js";

/** A tag as matching needs it: what the database row holds. */
export interface MatchableTag {
  id: string;
  slug: string;
  label: string;
  translations?: unknown;
  aliases?: unknown;
  retired?: boolean;
}

/** A tag name as it's compared: case, accents and punctuation left out ("R&B" is "r b"). */
export function foldTagName(name: string): string {
  return foldForSearch(name)
    .replace(/['’‘ʼ`´]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const stringsOf = (value: unknown): string[] =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.values(value).flatMap((one) => (typeof one === "string" ? [one] : Array.isArray(one) ? one.filter((word) => typeof word === "string") : []))
    : [];

/** Every name a tag answers to, in any language: its label, its slug, its translations and its aliases. */
export function tagNames(tag: Pick<MatchableTag, "slug" | "label" | "translations" | "aliases">): string[] {
  return [tag.label, tag.slug.replace(/-/g, " "), ...stringsOf(tag.translations), ...stringsOf(tag.aliases as TagAliases | null)];
}

/**
 * Finds tags by name (issue #37): "grâce", "Grace" and "gracious" are all the
 * Grace tag. Retired tags are left out, so an old name leads to the tag that
 * replaced it when that one lists it as an alias. When two tags share a name,
 * the first in `tags` wins: pass them in picker order.
 */
export function tagMatcher(tags: readonly MatchableTag[]): (name: string) => string | undefined {
  const byName = new Map<string, string>();
  const live = tags.filter((tag) => !tag.retired);
  // Labels and translations first, aliases after, so a tag's own name always beats another's alias.
  for (const tag of live) {
    for (const name of [tag.label, tag.slug.replace(/-/g, " "), ...stringsOf(tag.translations)]) {
      const key = foldTagName(name);
      if (key && !byName.has(key)) byName.set(key, tag.id);
    }
  }
  for (const tag of live) {
    for (const name of stringsOf(tag.aliases)) {
      const key = foldTagName(name);
      if (key && !byName.has(key)) byName.set(key, tag.id);
    }
  }
  return (name) => byName.get(foldTagName(name));
}

/** The ids of the tags these names match, each once, in the names' order. */
export function matchTagIds(tags: readonly MatchableTag[], names: readonly string[]): string[] {
  const match = tagMatcher(tags);
  return [...new Set(names.map(match).filter((id): id is string => !!id))];
}
