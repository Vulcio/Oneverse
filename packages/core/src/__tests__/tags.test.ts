import { describe, expect, it } from "vite-plus/test";
import { foldTagName, matchTagIds, tagMatcher, tagNames } from "../tags/match.js";
import { tagMatchesQuery, tagPickerGroups } from "../tags/picker.js";
import { SEED_TAG_CATEGORIES, TAG_GROUPS, TAG_VOCABULARY } from "../tags/vocabulary.js";

const all = Object.entries(TAG_VOCABULARY).flatMap(([category, tags]) => (tags ?? []).map((tag) => ({ ...tag, category })));

describe("the built-in tag list (issue #37)", () => {
  it("has each slug once, made of lowercase words", () => {
    const slugs = all.map((tag) => tag.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("only uses its own categories, and every theme sits in a known group", () => {
    const categories = new Set<string>(SEED_TAG_CATEGORIES.map((category) => category.slug));
    for (const tag of all) expect(categories.has(tag.category)).toBe(true);
    const groups = new Set(TAG_GROUPS.map((group) => group.slug));
    for (const tag of all) {
      if (tag.category === "theme") expect(groups.has(tag.group!), tag.slug).toBe(true);
      else expect(tag.group, tag.slug).toBeUndefined();
    }
  });

  it("gives every name, translation and alias to one tag within a category", () => {
    const clashes: string[] = [];
    for (const [category, tags] of Object.entries(TAG_VOCABULARY)) {
      const owner = new Map<string, string>();
      for (const tag of (tags ?? []).filter((one) => !one.retired)) {
        const names = new Set(tagNames({ slug: tag.slug, label: tag.en, translations: { fr: tag.fr }, aliases: tag.aliases }).map(foldTagName));
        for (const name of names) {
          const first = owner.get(name);
          if (first && first !== tag.slug) clashes.push(`${category}: "${name}" is ${first}'s and ${tag.slug}'s`);
          else owner.set(name, tag.slug);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("names every tag in English and French", () => {
    for (const tag of all) {
      expect(tag.en.trim()).not.toBe("");
      expect(tag.fr.trim()).not.toBe("");
    }
  });
});

describe("matching tags by name", () => {
  const tags = [
    { id: "grace", slug: "grace", label: "Grace", translations: { fr: "Grâce" }, aliases: { en: ["gracious"], fr: ["faveur"] } },
    { id: "rnb", slug: "rnb-and-soul", label: "R&B & soul", translations: { fr: "R&B et soul" }, aliases: { en: ["R&B", "soul"] } },
    { id: "folk", slug: "folk", label: "Folk & acoustic", translations: { fr: "Folk et acoustique" }, aliases: { en: ["acoustic"] } },
    { id: "acoustic", slug: "acoustic", label: "Acoustic", translations: { fr: "Acoustique" }, retired: true },
    { id: "joy", slug: "joy", label: "Joy", translations: { fr: "Joie" }, aliases: { en: ["grace"] } },
  ];

  it("finds a tag by its label, slug, translation or alias, ignoring case, accents and punctuation", () => {
    const match = tagMatcher(tags);
    expect(match("GRÂCE")).toBe("grace");
    expect(match("gracious")).toBe("grace");
    expect(match("r&b")).toBe("rnb");
    expect(match("R & B")).toBe("rnb");
    expect(match("rnb and soul")).toBe("rnb");
    expect(match("hymn")).toBeUndefined();
  });

  it("leads a retired tag's name to the tag that lists it", () => {
    expect(tagMatcher(tags)("Acoustique")).toBeUndefined();
    expect(tagMatcher(tags)("acoustic")).toBe("folk");
  });

  it("prefers a tag's own name over another tag's alias", () => {
    expect(tagMatcher(tags)("grace")).toBe("grace");
  });

  it("lists each matching tag once, in the names' order", () => {
    expect(matchTagIds(tags, ["Joie", "grâce", "Grace", "unknown"])).toEqual(["joy", "grace"]);
  });
});

describe("the tag picker", () => {
  const tag = (id: string, category: string, sortOrder: number, extra: Partial<{ group: string; retired: boolean; aliases: unknown; fr: string }> = {}) => ({
    id,
    slug: id,
    label: id[0]!.toUpperCase() + id.slice(1),
    translations: extra.fr ? { fr: extra.fr } : null,
    aliases: extra.aliases ?? null,
    sortOrder,
    group: extra.group ?? null,
    retired: extra.retired ?? false,
    category: { slug: category },
  });
  const tags = [
    tag("rock", "style", 1),
    tag("grace", "theme", 1, { group: "salvation", fr: "Grâce", aliases: { en: ["gracious"] } }),
    tag("acoustic", "style", 9, { retired: true }),
    tag("christmas", "season", 0, { fr: "Noël" }),
    tag("love", "theme", 0, { group: "love" }),
    tag("mercy", "theme", 0, { group: "salvation" }),
  ];

  it("lists tags by category, themes by group, in the list's order, without retired ones", () => {
    expect(tagPickerGroups(tags, "en").map((group) => [group.label, group.tags.map((one) => one.id)])).toEqual([
      ["Theme · Love & relationships", ["love"]],
      ["Theme · Salvation", ["mercy", "grace"]],
      ["Season", ["christmas"]],
      ["Genre", ["rock"]],
    ]);
    expect(tagPickerGroups(tags, "fr")[1]!.label).toBe("Thème · Salut");
  });

  it("keeps a retired tag a song already has", () => {
    expect(tagPickerGroups(tags, "en", ["acoustic"]).at(-1)!.tags.map((one) => one.id)).toEqual(["rock", "acoustic"]);
  });

  it("finds a tag by any of its names, in any language", () => {
    const grace = tags[1]!;
    expect(tagMatchesQuery(grace, "grâ")).toBe(true);
    expect(tagMatchesQuery(grace, "GRACIOUS")).toBe(true);
    expect(tagMatchesQuery(grace, "joy")).toBe(false);
    expect(tagMatchesQuery(grace, " ")).toBe(true);
  });
});
