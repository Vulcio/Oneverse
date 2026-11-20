import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SEED_TAG_CATEGORIES,
  SEED_TUNING_PRESETS,
  TAG_VOCABULARY,
  type VocabularyTag,
  parseArrangementDocumentV2,
  parseMidiItemTriggers,
  parseSongDocumentV2,
  slugify,
} from "@oneverse/core";
import { Prisma } from "@prisma/client";
import { prisma } from "./index.js";

// Fixtures live under seeds/, one level up from this file (both in src/
// during dev-via-tsx and in dist/ after build - the two directories sit
// at the same depth relative to the package root either way).
function loadFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../seeds/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function seedTagCategories(log: (line: string) => void) {
  for (const [sortOrder, category] of SEED_TAG_CATEGORIES.entries()) {
    const translations = { fr: category.fr };
    await prisma.tagCategory.upsert({
      where: { slug: category.slug },
      update: { label: category.label, translations, sortOrder },
      create: { slug: category.slug, label: category.label, translations, sortOrder, isGlobal: true },
    });
  }
  log(`Seeded ${SEED_TAG_CATEGORIES.length} tag categories.`);
}

// Moods and instrumentation: a modest starting set. Themes, seasons,
// occasions and genres are the built-in list in @oneverse/core
// (TAG_VOCABULARY, issue #37). `en` is the canonical label (and slug
// source); `fr` seeds Tag.translations.
const SEED_TAGS: Record<string, Array<{ en: string; fr: string }>> = {
  mood: [
    { en: "Joyful", fr: "Joyeux" },
    { en: "Reflective", fr: "Méditatif" },
    { en: "Triumphant", fr: "Triomphant" },
    { en: "Peaceful", fr: "Paisible" },
    { en: "Intense", fr: "Intense" },
    { en: "Tender", fr: "Tendre" },
  ],
  instrumentation: [
    { en: "Guitar-led", fr: "Guitare principale" },
    { en: "Piano-led", fr: "Piano principal" },
    { en: "Full Band", fr: "Groupe complet" },
    { en: "A Cappella", fr: "A cappella" },
    { en: "Orchestral", fr: "Orchestral" },
    { en: "Acoustic Only", fr: "Acoustique uniquement" },
  ],
};

function tagSlug(label: string): string {
  return slugify(label.replace(/&/g, "and"));
}

async function seedTags(log: (line: string) => void) {
  let count = 0;
  for (const category of SEED_TAG_CATEGORIES) {
    const vocabulary = TAG_VOCABULARY[category.slug];
    const entries: readonly VocabularyTag[] = vocabulary ?? (SEED_TAGS[category.slug] ?? []).map(({ en, fr }) => ({ slug: tagSlug(en), en, fr }));
    if (entries.length === 0) continue;
    const { id: categoryId } = await prisma.tagCategory.findUniqueOrThrow({ where: { slug: category.slug } });
    for (const [index, entry] of entries.entries()) {
      const fields = {
        label: entry.en,
        translations: { fr: entry.fr },
        sortOrder: index,
        // The built-in list owns where its tags sit and what they answer to.
        ...(vocabulary && { categoryId, group: entry.group ?? null, aliases: entry.aliases ?? Prisma.DbNull, retired: entry.retired ?? false }),
      };
      const existing = await prisma.tag.findUnique({ where: { slug: entry.slug }, select: { scope: true } });
      if (existing && existing.scope !== "GLOBAL") continue;
      await prisma.tag.upsert({
        where: { slug: entry.slug },
        update: fields,
        create: { categoryId, slug: entry.slug, scope: "GLOBAL", isApproved: true, ...fields },
      });
      count++;
    }
  }
  log(`Seeded ${count} tags.`);
}

async function seedTuningPresets(log: (line: string) => void) {
  for (const [index, preset] of SEED_TUNING_PRESETS.entries()) {
    await prisma.tuningPreset.upsert({
      where: { slug: preset.slug },
      update: {
        name: preset.name,
        instrument: preset.instrument,
        notes: [...preset.notes],
        isDefault: preset.isDefault,
      },
      create: {
        slug: preset.slug,
        name: preset.name,
        instrument: preset.instrument,
        notes: [...preset.notes],
        isStandard: true,
        isDefault: preset.isDefault,
        sortOrder: index,
      },
    });
  }
  log(`Seeded ${SEED_TUNING_PRESETS.length} tuning presets.`);
}

async function seedDemoContent(log: (line: string) => void) {
  const author = await prisma.user.upsert({
    where: { email: "demo-author@songverse.one" },
    update: {},
    create: {
      email: "demo-author@songverse.one",
      displayName: "A. Songwriter",
      emailVerified: true,
    },
  });

  const arranger = await prisma.user.upsert({
    where: { email: "demo-arranger@songverse.one" },
    update: {},
    create: {
      email: "demo-arranger@songverse.one",
      displayName: "B. Arranger",
      emailVerified: true,
    },
  });

  const team = await prisma.team.upsert({
    where: { slug: "demo-worship-team" },
    update: {},
    create: {
      name: "Demo Worship Team",
      slug: "demo-worship-team",
      description: "Seed team for local development and Phase 1 smoke tests.",
      memberships: {
        create: [
          { userId: author.id, role: "ADMIN" },
          { userId: arranger.id, role: "MEMBER" },
        ],
      },
    },
  });

  const work = await prisma.work.create({ data: {} });

  const songDocument = parseSongDocumentV2(loadFixture("morning-light-song.json"));

  const songVersion = await prisma.songVersion.create({
    data: {
      workId: work.id,
      ownerScope: "TEAM",
      ownerTeamId: team.id,
      publicationState: "DRAFT",
      title: "Morning Light",
      alternateTitle: "Lumière du Matin",
      language: "en",
      trustLabel: "Original composition — verified",
      copyright: "© 2024 Songverse Demo",
      copyrightYear: 2024,
      publisher: "Songverse Publishing",
      ccli: null,
      documentJson: songDocument as object,
      capo: null,
      relationshipType: "ORIGINAL",
      contributors: {
        create: [
          { userId: author.id, roles: ["AUTHOR", "COMPOSER", "LYRICIST"], displayOrder: 0 },
          { userId: arranger.id, roles: ["ARRANGER"], displayOrder: 1 },
        ],
      },
    },
  });

  await prisma.work.update({
    where: { id: work.id },
    data: { preferredOriginalVersionId: songVersion.id },
  });

  const arrangementDocument = parseArrangementDocumentV2(loadFixture("morning-light-arrangement.json"));
  arrangementDocument.songVersionId = songVersion.id;

  const standardTuning = await prisma.tuningPreset.findUniqueOrThrow({ where: { slug: "standard_guitar" } });

  const arrangement = await prisma.arrangement.create({
    data: {
      songVersionId: songVersion.id,
      ownerScope: "TEAM",
      ownerTeamId: team.id,
      name: "Full Band (Standard Tuning)",
      description: "Standard-tuning full band arrangement with a key change into the final chorus.",
      documentJson: arrangementDocument as object,
      guitarTuningPresetId: standardTuning.id,
    },
  });

  const midiTriggersRaw = loadFixture("morning-light-midi.json");
  const midiTriggers = parseMidiItemTriggers(midiTriggersRaw);

  await prisma.userArrangementMidi.upsert({
    where: { userId_arrangementId: { userId: arranger.id, arrangementId: arrangement.id } },
    update: { itemTriggersJson: midiTriggers as object },
    create: {
      userId: arranger.id,
      arrangementId: arrangement.id,
      enabled: true,
      itemTriggersJson: midiTriggers as object,
    },
  });

  log("Seeded demo team, work, song version, arrangement, and MIDI config for 'Morning Light'.");
}

/**
 * Runs the full seed in-process against the shared `prisma` client -
 * callable both from the CLI script (seeds/seed.ts, via `pnpm db seed`)
 * and from the running API (the admin panel's "Run seed" action), without
 * shelling out to a subprocess in the latter case. Every step is an
 * upsert, so re-running this is always safe.
 */
export async function runSeed(log: (line: string) => void = console.log): Promise<string[]> {
  const lines: string[] = [];
  const collect = (line: string) => {
    lines.push(line);
    log(line);
  };
  await seedTagCategories(collect);
  await seedTags(collect);
  await seedTuningPresets(collect);
  await seedDemoContent(collect);
  return lines;
}
