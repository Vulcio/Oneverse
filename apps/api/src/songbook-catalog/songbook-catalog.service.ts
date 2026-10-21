import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  CATALOG_ENTRY_FIELD_KEYS,
  compareEntryCodes,
  parseCatalogFile,
  parseOriginalSongReference,
  serializeCatalogCsv,
  serializeCatalogJson,
  slugify,
  validateCatalogEntryPatch,
  validateSongbookSections,
  type CatalogEntryData,
  type CatalogEntryFieldKey,
  type CatalogEntryPatch,
  type CatalogFileProblem,
  type SongbookSection,
} from "@oneverse/core";
import { Prisma } from "@oneverse/db";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CatalogEntryInputDto } from "./dto/catalog-entry-input.dto.js";
import type { CreateCatalogDto } from "./dto/create-catalog.dto.js";
import type { UpdateCatalogDto } from "./dto/update-catalog.dto.js";

type EntryRow = Prisma.SongbookCatalogEntryGetPayload<object>;

export interface CatalogEntryOriginal {
  catalogId: string;
  catalogName: string;
  catalogAbbreviation: string | null;
  entryId: string;
  entryCode: string;
  title: string;
}

export type CatalogEntryResponse = { id: string } & CatalogEntryData & { original: CatalogEntryOriginal | null };

export interface CatalogChange {
  entryCode: string;
  kind: "create" | "update" | "delete";
  fields: CatalogEntryFieldKey[];
}

export interface ImportCatalogResult {
  format: "csv" | "json";
  dryRun: boolean;
  /** False when nothing was saved: a dry run, or replace mode with problems in the file. */
  applied: boolean;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  problems: CatalogFileProblem[];
  unknownColumns: string[];
  /** The first CHANGE_LIST_LIMIT changes, for the preview. */
  changes: CatalogChange[];
}

const CHANGE_LIST_LIMIT = 500;
const BULK_TRANSACTION = { timeout: 120_000, maxWait: 10_000 };

/**
 * Songbook catalogues: the facts (numbers, titles, credits...) about the
 * songs of published songbooks, read by everyone signed in and edited by
 * global admins. Import and export use the file format in
 * @oneverse/core's songbook-catalog-format (docs/songbook-catalog-format.md).
 */
@Injectable()
export class SongbookCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.client.songbookCatalog.findMany({ orderBy: { name: "asc" } });
  }

  async findOne(catalogId: string) {
    const catalog = await this.prisma.client.songbookCatalog.findUnique({ where: { id: catalogId } });
    if (!catalog) throw new NotFoundException("Songbook catalog not found");
    const entries = await this.prisma.client.songbookCatalogEntry.findMany({ where: { catalogId } });
    return { ...catalog, entries: await this.toResponses(catalogId, sortEntries(entries)) };
  }

  create(dto: CreateCatalogDto) {
    return this.prisma.client.songbookCatalog.create({ data: dto });
  }

  async update(catalogId: string, dto: UpdateCatalogDto) {
    await this.ensureExists(catalogId);
    const { sections, ...rest } = dto;
    return this.prisma.client.songbookCatalog.update({
      where: { id: catalogId },
      data: { ...rest, ...(sections !== undefined && { sections: validSections(sections) }) },
    });
  }

  async remove(catalogId: string): Promise<void> {
    await this.ensureExists(catalogId);
    await this.prisma.client.songbookCatalog.delete({ where: { id: catalogId } });
  }

  async addEntry(catalogId: string, dto: CatalogEntryInputDto): Promise<CatalogEntryResponse> {
    await this.ensureExists(catalogId);
    const data = validated(dto);
    if (!data.entryCode || !data.title) throw new BadRequestException("Number and Title are required");
    const existing = await this.prisma.client.songbookCatalogEntry.findUnique({
      where: { catalogId_entryCode: { catalogId, entryCode: data.entryCode } },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`There's already an entry numbered ${data.entryCode}`);
    const entry = await this.prisma.client.songbookCatalogEntry.create({ data: { ...data, entryCode: data.entryCode, title: data.title, catalogId } });
    return (await this.toResponses(catalogId, [entry]))[0]!;
  }

  /** Changes just the fields given (as edited in the table). */
  async updateEntry(catalogId: string, entryId: string, dto: CatalogEntryInputDto): Promise<CatalogEntryResponse> {
    await this.findEntry(catalogId, entryId);
    const data = validated(dto);
    try {
      const entry = await this.prisma.client.songbookCatalogEntry.update({ where: { id: entryId }, data });
      return (await this.toResponses(catalogId, [entry]))[0]!;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(`There's already an entry numbered ${data.entryCode}`);
      }
      throw error;
    }
  }

  async removeEntry(catalogId: string, entryId: string): Promise<void> {
    await this.findEntry(catalogId, entryId);
    await this.prisma.client.songbookCatalogEntry.delete({ where: { id: entryId } });
  }

  /**
   * Imports a CSV or JSON file into a catalogue: matches rows to entries
   * by number, adds new ones and updates changed ones ("merge"), and in
   * "replace" mode also removes entries not in the file. Rows with
   * problems are skipped and reported; replace mode saves nothing while
   * there are any, since a skipped row's entry would otherwise be removed.
   * `dryRun` only reports.
   */
  async importEntries(
    catalogId: string,
    input: { content: string; filename?: string; mode?: "merge" | "replace"; dryRun?: boolean },
  ): Promise<ImportCatalogResult> {
    await this.ensureExists(catalogId);
    const file = parseCatalogFile(input.content, input.filename);
    const mode = input.mode ?? "merge";
    const problems = [...file.problems];

    // Later rows with an already-seen number are problems, not silent overwrites.
    const seen = new Map<string, number>();
    const rows = file.rows.filter(({ row, data }) => {
      const first = seen.get(data.entryCode!);
      if (first !== undefined) {
        problems.push({ row, message: `Number ${data.entryCode} is already used on row ${first}` });
        return false;
      }
      seen.set(data.entryCode!, row);
      return true;
    });

    const existing = new Map(
      (await this.prisma.client.songbookCatalogEntry.findMany({ where: { catalogId } })).map((entry) => [entry.entryCode, entry]),
    );
    const creates: { row: number; data: CatalogEntryPatch }[] = [];
    const updates: { id: string; entryCode: string; data: CatalogEntryPatch; fields: CatalogEntryFieldKey[] }[] = [];
    let unchanged = 0;
    for (const { row, data } of rows) {
      const current = existing.get(data.entryCode!);
      if (!current) {
        if (!data.title) problems.push({ row, message: `Number ${data.entryCode} is new, so it needs a Title` });
        else creates.push({ row, data });
        continue;
      }
      const fields = changedFields(current, data);
      if (fields.length === 0) unchanged++;
      else updates.push({ id: current.id, entryCode: current.entryCode, data: pick(data, fields), fields });
    }
    const deletes = mode === "replace" ? [...existing.values()].filter((entry) => !seen.has(entry.entryCode)) : [];
    problems.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

    const fileIsUnusable = file.problems.some((problem) => problem.row === null) && file.rows.length === 0;
    const apply = !input.dryRun && !fileIsUnusable && !(mode === "replace" && problems.length > 0);
    if (apply) {
      await this.prisma.client.$transaction(async (tx) => {
        if (creates.length > 0) {
          await tx.songbookCatalogEntry.createMany({
            data: creates.map(({ data }) => ({ ...data, entryCode: data.entryCode!, title: data.title!, catalogId })),
          });
        }
        for (const update of updates) {
          await tx.songbookCatalogEntry.update({ where: { id: update.id }, data: update.data });
        }
        if (deletes.length > 0) {
          await tx.songbookCatalogEntry.deleteMany({ where: { id: { in: deletes.map((entry) => entry.id) } } });
        }
      }, BULK_TRANSACTION);
    }

    const changes: CatalogChange[] = [
      ...creates.map(({ data }) => ({ entryCode: data.entryCode!, kind: "create" as const, fields: [] })),
      ...updates.map(({ entryCode, fields }) => ({ entryCode, kind: "update" as const, fields })),
      ...deletes.map((entry) => ({ entryCode: entry.entryCode, kind: "delete" as const, fields: [] })),
    ].sort((a, b) => compareEntryCodes(a.entryCode, b.entryCode));

    return {
      format: file.format,
      dryRun: !!input.dryRun,
      applied: apply,
      created: creates.length,
      updated: updates.length,
      unchanged,
      deleted: deletes.length,
      problems,
      unknownColumns: file.unknownColumns,
      changes: changes.slice(0, CHANGE_LIST_LIMIT),
    };
  }

  /** A new catalogue, details and entries, from a JSON file (CSV has nowhere to carry the name). */
  async createFromFile(input: { content: string; filename?: string }) {
    const file = parseCatalogFile(input.content, input.filename);
    if (file.format !== "json") {
      throw new BadRequestException("A CSV file only holds entries. Create the catalogue first, then import the CSV into it.");
    }
    const fatal = file.problems.find((problem) => problem.row === null);
    if (fatal) throw new BadRequestException(fatal.message);
    if (!file.details?.name) throw new BadRequestException('The file has no catalogue name ("catalog": { "name": ... })');
    const { name, sections, ...details } = file.details;
    const catalog = await this.prisma.client.songbookCatalog.create({
      data: { name, ...details, ...(sections && { sections: validSections(sections) }) },
    });
    const result = await this.importEntries(catalog.id, { content: input.content, filename: input.filename });
    return { catalog, import: result };
  }

  async export(catalogId: string, format: "csv" | "json"): Promise<{ filename: string; contentType: string; body: string }> {
    const catalog = await this.prisma.client.songbookCatalog.findUnique({ where: { id: catalogId } });
    if (!catalog) throw new NotFoundException("Songbook catalog not found");
    const entries = sortEntries(await this.prisma.client.songbookCatalogEntry.findMany({ where: { catalogId } })).map(toData);
    const base = slugify(catalog.abbreviation || catalog.name) || "catalog";
    if (format === "csv") {
      return { filename: `${base}.csv`, contentType: "text/csv; charset=utf-8", body: serializeCatalogCsv(entries) };
    }
    const { name, abbreviation, publisher, isbn, description, officialUrl, language } = catalog;
    const sections = (catalog.sections as SongbookSection[] | null) ?? null;
    return {
      filename: `${base}.json`,
      contentType: "application/json; charset=utf-8",
      body: serializeCatalogJson({ name, abbreviation, publisher, isbn, description, officialUrl, language, sections }, entries),
    };
  }

  /** Adds `original`: the entry each originalSong ("JEM 245", or "245" in this catalogue) points to, if it exists. */
  private async toResponses(catalogId: string, entries: EntryRow[]): Promise<CatalogEntryResponse[]> {
    const references = new Map<string, { abbreviation: string | null; entryCode: string }>();
    for (const entry of entries) {
      const reference = entry.originalSong ? parseOriginalSongReference(entry.originalSong) : null;
      if (reference) references.set(entry.id, reference);
    }
    const originals = new Map<string, CatalogEntryOriginal>();
    if (references.size > 0) {
      const abbreviations = [...new Set([...references.values()].map((r) => r.abbreviation).filter((a): a is string => !!a))];
      const catalogs = await this.prisma.client.songbookCatalog.findMany({
        where: {
          OR: [{ id: catalogId }, ...abbreviations.map((abbreviation) => ({ abbreviation: { equals: abbreviation, mode: "insensitive" as const } }))],
        },
        select: { id: true, name: true, abbreviation: true },
      });
      const catalogFor = (abbreviation: string | null) =>
        abbreviation ? catalogs.find((c) => c.abbreviation?.toLowerCase() === abbreviation.toLowerCase()) : catalogs.find((c) => c.id === catalogId);
      const targets = [...references.values()]
        .map((reference) => ({ catalog: catalogFor(reference.abbreviation), entryCode: reference.entryCode }))
        .filter((target): target is { catalog: (typeof catalogs)[number]; entryCode: string } => !!target.catalog);
      const found =
        targets.length === 0
          ? []
          : await this.prisma.client.songbookCatalogEntry.findMany({
              where: { OR: targets.map((target) => ({ catalogId: target.catalog.id, entryCode: target.entryCode })) },
              select: { id: true, catalogId: true, entryCode: true, title: true },
            });
      for (const [entryId, reference] of references) {
        const catalog = catalogFor(reference.abbreviation);
        const match = catalog && found.find((f) => f.catalogId === catalog.id && f.entryCode === reference.entryCode);
        if (catalog && match && match.id !== entryId) {
          originals.set(entryId, {
            catalogId: catalog.id,
            catalogName: catalog.name,
            catalogAbbreviation: catalog.abbreviation,
            entryId: match.id,
            entryCode: match.entryCode,
            title: match.title,
          });
        }
      }
    }
    return entries.map((entry) => ({ id: entry.id, ...toData(entry), original: originals.get(entry.id) ?? null }));
  }

  private async findEntry(catalogId: string, entryId: string): Promise<EntryRow> {
    const entry = await this.prisma.client.songbookCatalogEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.catalogId !== catalogId) throw new NotFoundException("Catalog entry not found");
    return entry;
  }

  private async ensureExists(catalogId: string): Promise<void> {
    const exists = await this.prisma.client.songbookCatalog.findUnique({ where: { id: catalogId }, select: { id: true } });
    if (!exists) throw new NotFoundException("Songbook catalog not found");
  }
}

function validated(dto: CatalogEntryInputDto): CatalogEntryPatch {
  const { data, problems } = validateCatalogEntryPatch(dto as Record<string, unknown>);
  if (problems.length > 0) throw new BadRequestException(problems.join("; "));
  return data;
}

function toData(entry: EntryRow): CatalogEntryData {
  return Object.fromEntries(CATALOG_ENTRY_FIELD_KEYS.map((key) => [key, entry[key]])) as unknown as CatalogEntryData;
}

function sortEntries(entries: EntryRow[]): EntryRow[] {
  return [...entries].sort((a, b) => compareEntryCodes(a.entryCode, b.entryCode));
}

function changedFields(current: EntryRow, data: CatalogEntryPatch): CatalogEntryFieldKey[] {
  return (Object.keys(data) as CatalogEntryFieldKey[]).filter((key) => {
    const next = data[key];
    const now = current[key];
    if (Array.isArray(next) && Array.isArray(now)) return next.join("\u0000") !== now.join("\u0000");
    return next !== now;
  });
}

function pick(data: CatalogEntryPatch, fields: CatalogEntryFieldKey[]): CatalogEntryPatch {
  return Object.fromEntries(fields.map((key) => [key, data[key]])) as CatalogEntryPatch;
}

/** Printed volumes as stored, or a 400 saying what's wrong with them (overlapping ranges, say). */
function validSections(sections: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (sections === null) return Prisma.JsonNull;
  try {
    const valid = validateSongbookSections(sections);
    return valid.length > 0 ? (valid as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : String(error));
  }
}
