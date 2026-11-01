import {
  lyricsSearchText,
  NoteAnchorSchema,
  readItemPassage,
  readItemScreenTemplate,
  readItemText,
  readItemTimer,
  safeParseArrangementDocumentV2,
  safeParseSongDocumentV2,
  slugify,
  validateSongbookSections,
} from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import type { z } from "zod";
import type { AccessPolicyService } from "../access/access-policy.service.js";
import { joinTeamOrganization } from "../organizations/organizations.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { SongHistoryService } from "../song-versions/song-history.service.js";
import type { StorageQuotaService } from "../storage/storage-quota.service.js";
import type { StorageService } from "../storage/storage.service.js";
import {
  ARCHIVE_FILES,
  ARCHIVE_FORMAT_VERSION,
  ArchiveContentSchemas,
  ArchiveManifestSchema,
  isSha256,
  type ArchiveContent,
  type ArchiveImportSummary,
  type ArchiveSong,
} from "./archive-format.js";
import type { ArchiveOwner } from "./archive-export.js";
import { readArchive } from "./archive-zip.js";

type Tx = Prisma.TransactionClient;
type Owner = { ownerScope: "USER"; ownerUserId: string; ownerTeamId: null } | { ownerScope: "TEAM"; ownerUserId: null; ownerTeamId: string };

export interface ImportDeps {
  prisma: PrismaService;
  storage: StorageService;
  quota: StorageQuotaService;
  policy: AccessPolicyService;
  history: SongHistoryService;
}

/** Same set-item chords as a set's own (UpdateSetlistItemSchema). */
const TRANSITION_CHORD = /^[#b]?[1-7][^/\s]{0,12}(?:\/[#b]?[1-7])?$/;
const LEFT_OUT_SHOWN = 100;

class Summary {
  readonly result: ArchiveImportSummary = {
    created: { songs: 0, arrangements: 0, songbooks: 0, sets: 0, notes: 0, files: 0, teams: 0 },
    kept: { songs: 0, arrangements: 0, songbooks: 0, sets: 0 },
    leftOut: [],
    leftOutCount: 0,
  };
  leave(why: string) {
    this.result.leftOutCount += 1;
    if (this.result.leftOut.length < LEFT_OUT_SHOWN) this.result.leftOut.push(why);
  }
}

/** Reads and checks an archive's content: what's missing is empty, what's wrong is refused with why. */
export async function readArchiveContent(
  body: Readable,
  folder: string,
  maxBytes: number,
  onFile: (sha256: string, path: string, sizeBytes: number) => Promise<void>,
): Promise<ArchiveContent> {
  const json = await readArchive(body, {
    json: new Set(Object.values(ARCHIVE_FILES)),
    wantsFile: (name) => name.startsWith("files/") && isSha256(name.slice(6)),
    folder,
    maxBytes,
    onFile: async (name, file) => {
      try {
        // Only bytes that are what the archive says they are.
        if (file.sha256 === name.slice(6)) await onFile(file.sha256, file.path, file.sizeBytes);
      } finally {
        await rm(file.path, { force: true });
      }
    },
  });
  const manifestJson = json.get(ARCHIVE_FILES.manifest);
  if (!manifestJson) throw new Error("This isn't a Oneverse archive: it has no manifest.json");
  const manifest = ArchiveManifestSchema.safeParse(manifestJson);
  if (!manifest.success) throw new Error("This isn't a Oneverse archive: its manifest.json can't be read");
  if (manifest.data.version > ARCHIVE_FORMAT_VERSION) throw new Error(`This archive was made by a newer Oneverse (format ${manifest.data.version}); update this server to import it`);
  const part = <T>(name: string, schema: z.ZodType<T>, fallback: T): T => {
    const value = json.get(name);
    if (value === undefined) return fallback;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${name} in the archive can't be read (${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid"})`);
    }
    return parsed.data;
  };
  return {
    manifest: manifest.data,
    songs: part(ARCHIVE_FILES.songs, ArchiveContentSchemas.songs, []),
    arrangements: part(ARCHIVE_FILES.arrangements, ArchiveContentSchemas.arrangements, []),
    songbooks: part(ARCHIVE_FILES.songbooks, ArchiveContentSchemas.songbooks, []),
    sets: part(ARCHIVE_FILES.sets, ArchiveContentSchemas.sets, []),
    notes: part(ARCHIVE_FILES.notes, ArchiveContentSchemas.notes, []),
  };
}

/**
 * Brings an archive's content in for `destination` (issue #351), as
 * `importerId`: everything gets new IDs and belongs to the destination;
 * nothing already there is changed. A song, an arrangement, a songbook or a
 * set that's already there the same is used as it is (so importing twice
 * adds nothing). What the archive points at without holding (a catalogue
 * song) is kept only if the importer can see it; the rest is left out, with
 * why. People the archive names are never made authors of anything: notes
 * by others say who wrote them in their text.
 *
 * `present` is the files the archive held (already stored); a file it only
 * names is left out.
 */
export async function importArchiveContent(deps: ImportDeps, content: ArchiveContent, destination: ArchiveOwner, importerId: string, present: ReadonlySet<string>): Promise<ArchiveImportSummary> {
  const db = deps.prisma.client;
  const summary = new Summary();
  const importer = await db.user.findUniqueOrThrow({ where: { id: importerId }, select: { id: true, isGlobalAdmin: true } });
  const viewer = { id: importer.id, isGlobalAdmin: false };
  const importerTeams = new Set(await deps.policy.teamIds(importer.id));

  // Where each of the archive's teams' content goes.
  const teamMap = await planTeams(deps, content, destination);

  // Storage: what the files will count, checked before anything is written.
  const bytesByOwner = new Map<string, number>();
  for (const song of content.songs) {
    const target = teamMap.ownerOf(song.teamId);
    const key = target.ownerTeamId ?? "me";
    for (const file of song.attachments) if (present.has(file.sha256)) bytesByOwner.set(key, (bytesByOwner.get(key) ?? 0) + file.sizeBytes);
  }
  for (const [key, bytes] of bytesByOwner) {
    if (key === "me") await deps.quota.assertCanStore(importer.id, bytes);
    else if (!teamMap.created.has(key)) await deps.quota.assertCanStoreForTeam(importer.id, key, bytes);
  }

  // Songs the archive points at without holding them: kept if the importer can see them.
  const outside = new Map<string, string | null>();
  const outsideSong = async (songId: string): Promise<string | null> => {
    if (outside.has(songId)) return outside.get(songId)!;
    const song = await db.songVersion.findUnique({
      where: { id: songId },
      select: { id: true, ownerScope: true, ownerUserId: true, ownerTeamId: true, publicationState: true, deletedAt: true },
    });
    const seen = song && (await deps.policy.canSeeSong(viewer, song)) ? song.id : null;
    outside.set(songId, seen);
    return seen;
  };
  const songIds = new Map<string, string>();
  const resolveSong = async (songId: string) => songIds.get(songId) ?? (await outsideSong(songId));
  for (const ref of [...content.arrangements, ...content.songbooks.flatMap((book) => book.entries), ...content.notes, ...content.sets.flatMap((set) => set.items)]) {
    const id = "songId" in ref ? ref.songId : null;
    if (id && !content.songs.some((song) => song.id === id)) await outsideSong(id);
  }

  const tags = await db.tag.findMany({ select: { id: true, slug: true, label: true, scope: true, ownerUserId: true, ownerTeamId: true, isApproved: true } });
  const tuning = new Map((await db.tuningPreset.findMany({ select: { id: true, slug: true } })).map((preset) => [preset.slug, preset.id]));

  await db.$transaction(
    async (tx) => {
      await teamMap.create(tx, importer.id, summary);
      const visibilityFor = (owner: Owner, visibility: string, teamId: string | null | undefined): { visibility: "PRIVATE" | "TEAM" | "SONG" | "SHARED"; visibleToTeamId: string | null } => {
        if (visibility !== "TEAM") return { visibility: visibility as "PRIVATE" | "SONG" | "SHARED", visibleToTeamId: null };
        const team = owner.ownerTeamId ?? (teamId && importerTeams.has(teamId) ? teamId : null);
        return team ? { visibility: "TEAM", visibleToTeamId: team } : { visibility: "PRIVATE", visibleToTeamId: null };
      };

      // Songs: parents first, so a version goes in its original's Work.
      const links = new Map<string, string>();
      const attachments: { archive: ArchiveSong["attachments"][number]; id: string }[] = [];
      const workOf = new Map<string, string>();
      for (const song of parentsFirst(content.songs)) {
        const owner = teamMap.ownerOf(song.teamId);
        const parsed = safeParseSongDocumentV2(song.documentJson);
        if (!parsed.success) {
          summary.leave(`Song "${song.title}": its chart can't be read`);
          continue;
        }
        const document = parsed.data;
        const existing = await tx.songVersion.findFirst({
          where: { ownerScope: owner.ownerScope, ownerUserId: owner.ownerUserId, ownerTeamId: owner.ownerTeamId, title: song.title, documentJson: { equals: document as object } },
          select: { id: true, workId: true },
        });
        if (existing) {
          songIds.set(song.id, existing.id);
          workOf.set(existing.id, existing.workId);
          summary.result.kept.songs += 1;
          continue;
        }
        const parentId = song.parentId ? songIds.get(song.parentId) : undefined;
        const workId = (parentId && workOf.get(parentId)) || (await tx.work.create({ data: {}, select: { id: true } })).id;
        const usableTag = (tag: (typeof tags)[number]) =>
          (tag.scope === "GLOBAL" && tag.isApproved) || (tag.scope === "USER" && tag.ownerUserId === owner.ownerUserId) || (tag.scope === "TEAM" && tag.ownerTeamId === owner.ownerTeamId);
        const tagIds = [
          ...new Set(
            song.tags
              .map((wanted) => tags.find((tag) => usableTag(tag) && (tag.slug === wanted.slug || tag.label.toLowerCase() === wanted.label.toLowerCase()))?.id)
              .filter((id): id is string => !!id),
          ),
        ];
        const created = await tx.songVersion.create({
          data: {
            ...owner,
            workId,
            title: song.title,
            alternateTitle: song.alternateTitle ?? null,
            versionName: song.versionName ?? null,
            sortTitle: song.sortTitle ?? null,
            language: song.language,
            trustLabel: song.trustLabel ?? null,
            imageStorageKey: song.imageSha256 && present.has(song.imageSha256) ? song.imageSha256 : null,
            imageSourceUrl: song.imageSha256 && present.has(song.imageSha256) ? (song.imageSourceUrl ?? null) : null,
            copyright: song.copyright ?? null,
            copyrightYear: song.copyrightYear ?? null,
            publisher: song.publisher ?? null,
            album: song.album ?? null,
            year: song.year ?? null,
            isrc: song.isrc ?? null,
            reference: song.reference ?? null,
            notes: song.notes ?? null,
            ccli: song.ccli ?? null,
            capo: song.capo ?? null,
            documentJson: document as object,
            lyricsText: lyricsSearchText(document),
            ...(parentId && { parentVersionId: parentId, relationshipType: song.relationshipType ?? "UNKNOWN_ORIGIN" }),
            defaultGrooveStyleId: song.defaultGrooveStyleId ?? null,
            defaultGrooveVariant: song.defaultGrooveVariant ?? null,
          },
          select: { id: true },
        });
        if (!parentId) await tx.work.update({ where: { id: workId }, data: { preferredOriginalVersionId: created.id } });
        songIds.set(song.id, created.id);
        workOf.set(created.id, workId);
        if (song.credits.length) {
          await tx.versionContributor.createMany({ data: song.credits.map((credit, displayOrder) => ({ songVersionId: created.id, source: credit.source ?? null, roles: credit.roles, displayOrder })) });
        }
        if (tagIds.length) await tx.songVersionTag.createMany({ data: tagIds.map((tagId) => ({ songVersionId: created.id, tagId })) });
        const identifierTypes = new Set<string>();
        for (const identifier of song.identifiers) {
          if (identifierTypes.has(identifier.type) || !IDENTIFIER_TYPES.has(identifier.type)) continue;
          identifierTypes.add(identifier.type);
          await tx.songVersionIdentifier.create({
            data: {
              songVersionId: created.id,
              type: identifier.type as never,
              value: identifier.value,
              sourceUrl: identifier.sourceUrl ?? null,
              note: identifier.note ?? null,
              ...(identifier.details !== undefined && identifier.details !== null && { details: identifier.details as object }),
            },
          });
        }
        for (const link of song.links) {
          const made = await tx.songLink.create({
            data: {
              songVersionId: created.id,
              url: link.url,
              service: link.service,
              value: link.value ?? null,
              label: link.label,
              startSeconds: link.startSeconds ?? null,
              addedByUserId: importer.id,
              ...visibilityFor(owner, link.visibility, link.visibleToTeamId),
            },
            select: { id: true },
          });
          links.set(link.id, made.id);
        }
        for (const file of song.attachments) {
          if (!present.has(file.sha256)) {
            summary.leave(`File "${file.filename}" of "${song.title}": not in the archive`);
            continue;
          }
          const original = file.originalSha256 && present.has(file.originalSha256);
          const made = await tx.attachment.create({
            data: {
              songVersionId: created.id,
              type: file.type,
              filename: file.filename,
              mimeType: file.mimeType,
              storageKey: file.sha256,
              sizeBytes: file.sizeBytes,
              ...(original && { originalStorageKey: file.originalSha256, originalMimeType: file.originalMimeType ?? null, originalSizeBytes: file.originalSizeBytes ?? null }),
              stemPart: file.stemPart ?? null,
              pitchOffset: file.pitchOffset ?? null,
              ...(file.cuePoints !== undefined && file.cuePoints !== null && { cuePoints: file.cuePoints as object }),
              locked: file.locked,
              origin: file.origin,
              detected: file.detected,
              partName: file.partName ?? null,
              recordingKey: file.recordingKey ?? null,
              recordingTempo: file.recordingTempo ?? null,
              recordingFirstBeat: file.recordingFirstBeat ?? null,
              recordingFreeIntro: file.recordingFreeIntro,
              recordingBeats: file.recordingBeats,
              recordingDownbeats: file.recordingDownbeats,
              recordingTimeSignature: file.recordingTimeSignature ?? null,
              multitrackId: file.multitrackId ?? null,
              multitrackName: file.multitrackName ?? null,
              otherTake: file.otherTake,
              uploadedByUserId: importer.id,
              ...visibilityFor(owner, file.visibility, file.visibleToTeamId),
            },
            select: { id: true },
          });
          attachments.push({ archive: file, id: made.id });
          summary.result.created.files += 1;
        }
        await deps.history.record(tx, created.id, { kind: "CREATED", authorUserId: importer.id });
        summary.result.created.songs += 1;
      }

      // Arrangements (a set's own come with the set).
      const arrangementIds = new Map<string, string>();
      const arrangementData = async (arrangement: ArchiveContent["arrangements"][number], owner: Owner, songId: string, setlistItemId: string | null) => {
        const parsed = safeParseArrangementDocumentV2(arrangement.documentJson);
        if (!parsed.success) return null;
        return {
          ...owner,
          songVersionId: songId,
          name: arrangement.name,
          description: arrangement.description ?? null,
          documentJson: { ...parsed.data, songVersionId: songId } as object,
          isTeamDefault: !!owner.ownerTeamId && arrangement.isTeamDefault && (await tx.arrangement.count({ where: { songVersionId: songId, ownerTeamId: owner.ownerTeamId, isTeamDefault: true } })) === 0,
          setlistItemId,
          linkId: arrangement.linkId ? (links.get(arrangement.linkId) ?? null) : null,
          multitrackId: arrangement.multitrackId ?? null,
          guitarTuningPresetId: arrangement.guitarTuningSlug ? (tuning.get(arrangement.guitarTuningSlug) ?? null) : null,
        };
      };
      for (const arrangement of content.arrangements.filter((one) => !one.setItemId)) {
        const owner = teamMap.ownerOf(arrangement.teamId);
        const songId = await resolveSong(arrangement.songId);
        if (!songId) {
          summary.leave(`Arrangement "${arrangement.name}" of "${arrangement.songTitle ?? arrangement.songId}": its song isn't on this server, or you can't see it`);
          continue;
        }
        const data = await arrangementData(arrangement, owner, songId, null);
        if (!data) {
          summary.leave(`Arrangement "${arrangement.name}": it can't be read`);
          continue;
        }
        const existing = await tx.arrangement.findFirst({
          where: { songVersionId: songId, ownerScope: owner.ownerScope, ownerUserId: owner.ownerUserId, ownerTeamId: owner.ownerTeamId, name: arrangement.name, setlistItemId: null },
          select: { id: true, documentJson: true },
        });
        if (existing && sameJson(existing.documentJson, data.documentJson)) {
          arrangementIds.set(arrangement.id, existing.id);
          summary.result.kept.arrangements += 1;
          continue;
        }
        const made = await tx.arrangement.create({ data, select: { id: true } });
        arrangementIds.set(arrangement.id, made.id);
        summary.result.created.arrangements += 1;
      }

      // Songbooks.
      const songbookIds = new Map<string, string>();
      for (const songbook of content.songbooks) {
        const owner = teamMap.ownerOf(songbook.teamId);
        const entries: { songVersionId: string; entryCode: string | null }[] = [];
        const codes = new Set<string>();
        const inIt = new Set<string>();
        for (const entry of songbook.entries) {
          const songId = await resolveSong(entry.songId);
          if (!songId) {
            summary.leave(`"${entry.songTitle ?? entry.songId}" in songbook "${songbook.name}": not on this server, or you can't see it`);
            continue;
          }
          const code = entry.entryCode?.trim() || null;
          if (inIt.has(songId) || (code && codes.has(code))) continue;
          inIt.add(songId);
          if (code) codes.add(code);
          entries.push({ songVersionId: songId, entryCode: code });
        }
        const sameName = await tx.songbook.findMany({
          where: { ownerScope: owner.ownerScope, ownerUserId: owner.ownerUserId, ownerTeamId: owner.ownerTeamId, name: { startsWith: songbook.name } },
          select: { id: true, name: true, entries: { select: { songVersionId: true, entryCode: true } } },
        });
        const same = sameName.find((book) => book.name === songbook.name && sameEntries(book.entries, entries));
        if (same) {
          songbookIds.set(songbook.id, same.id);
          summary.result.kept.songbooks += 1;
          continue;
        }
        let sections: object | undefined;
        try {
          sections = songbook.sections === undefined || songbook.sections === null ? undefined : (validateSongbookSections(songbook.sections) as object);
        } catch {
          sections = undefined;
        }
        const made = await tx.songbook.create({
          data: {
            ...owner,
            name: freeName(songbook.name, sameName.map((book) => book.name)),
            abbreviation: songbook.abbreviation ?? null,
            language: songbook.language ?? null,
            publisher: songbook.publisher ?? null,
            year: songbook.year ?? null,
            kind: songbook.kind,
            color: songbook.color ?? null,
            avatarStorageKey: songbook.avatarSha256 && present.has(songbook.avatarSha256) ? songbook.avatarSha256 : null,
            ...(sections && { sections }),
            entries: { create: entries },
          },
          select: { id: true },
        });
        songbookIds.set(songbook.id, made.id);
        summary.result.created.songbooks += 1;
      }

      // Sets, their items and the arrangements of their own.
      const setIds = new Map<string, string>();
      for (const set of content.sets) {
        const owner = teamMap.ownerOf(set.teamId);
        const items: { archive: (typeof set.items)[number]; data: Prisma.SetlistItemCreateWithoutSetlistInput }[] = [];
        for (const item of [...set.items].sort((a, b) => a.position - b.position)) {
          const common = {
            transposeSteps: item.transposeSteps,
            tempoOverride: item.tempoOverride ?? null,
            notes: item.notes ?? null,
            transition: item.transition ?? null,
            transitionNote: item.transitionNote ?? null,
            transitionChords: item.transitionChords.filter((chord) => TRANSITION_CHORD.test(chord)),
            ...(readItemTimer(item.timer) && { timer: readItemTimer(item.timer) as object }),
          };
          if (item.kind === "SONG") {
            const songId = item.songId ? await resolveSong(item.songId) : null;
            if (!songId) {
              summary.leave(`"${item.songTitle ?? item.songId}" in set "${set.name ?? set.eventDate ?? ""}": not on this server, or you can't see it`);
              continue;
            }
            const arrangementId = item.arrangementId ? arrangementIds.get(item.arrangementId) : undefined;
            items.push({ archive: item, data: { kind: "SONG", position: items.length, ...common, songVersion: { connect: { id: songId } }, ...(arrangementId && { arrangement: { connect: { id: arrangementId } } }) } });
          } else if (item.kind === "TEXT") {
            const text = readItemText(item.text);
            if (!text) continue;
            items.push({ archive: item, data: { kind: "TEXT", position: items.length, ...common, text } });
          } else {
            const passage = readItemPassage(item.passage);
            if (!passage) continue;
            const template = readItemScreenTemplate(item.screenTemplate);
            items.push({ archive: item, data: { kind: "PASSAGE", position: items.length, ...common, passage, ...(template && "builtIn" in template && { screenTemplate: template }) } });
          }
        }
        const eventDate = set.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(set.eventDate) ? new Date(`${set.eventDate}T00:00:00Z`) : null;
        const sameName = await tx.setlist.findMany({
          where: { ownerUserId: owner.ownerUserId, ownerTeamId: owner.ownerTeamId, name: set.name ?? null, eventDate },
          select: { id: true, items: { orderBy: { position: "asc" }, select: { kind: true, songVersionId: true, text: true, passage: true } } },
        });
        const fingerprint = (rows: { kind: string; songVersionId?: string | null; text?: unknown; passage?: unknown }[]) =>
          // Sorted: the database keeps a JSON object's keys in its own order.
          JSON.stringify(sorted(rows.map((row) => [row.kind, row.songVersionId ?? null, row.text ?? null, row.passage ?? null])));
        const mine = fingerprint(items.map(({ data }) => ({ kind: data.kind!, songVersionId: data.songVersion?.connect?.id, text: data.text, passage: data.passage })));
        const same = sameName.find((one) => fingerprint(one.items) === mine);
        if (same) {
          setIds.set(set.id, same.id);
          summary.result.kept.sets += 1;
          continue;
        }
        const made = await tx.setlist.create({
          data: { ownerUserId: owner.ownerUserId, ownerTeamId: owner.ownerTeamId, name: set.name ?? null, description: set.description ?? null, eventDate },
          select: { id: true },
        });
        setIds.set(set.id, made.id);
        for (const { archive, data } of items) {
          const item = await tx.setlistItem.create({ data: { ...data, setlist: { connect: { id: made.id } } }, select: { id: true, songVersionId: true } });
          const own = content.arrangements.find((arrangement) => arrangement.setItemId === archive.id);
          if (own && item.songVersionId) {
            const arrangement = await arrangementData(own, owner, item.songVersionId, item.id);
            if (arrangement) {
              const created = await tx.arrangement.create({ data: arrangement, select: { id: true } });
              if (archive.arrangementId === own.id) await tx.setlistItem.update({ where: { id: item.id }, data: { arrangementId: created.id } });
              summary.result.created.arrangements += 1;
            }
          }
        }
        summary.result.created.sets += 1;
      }

      // A multitrack's files belong to a set; pointed at the new one.
      for (const { archive, id } of attachments) {
        const setId = archive.multitrackSetId ? setIds.get(archive.multitrackSetId) : undefined;
        if (setId) await tx.attachment.update({ where: { id }, data: { multitrackSetlistId: setId } });
      }

      // Notes: the importer's; another's say who wrote them.
      for (const note of content.notes) {
        const songId = await resolveSong(note.songId);
        const anchor = NoteAnchorSchema.safeParse(note.anchor);
        if (!songId || !anchor.success) {
          summary.leave(`A note on "${note.songTitle ?? note.songId}": ${songId ? "it can't be read" : "its song isn't on this server, or you can't see it"}`);
          continue;
        }
        const owner = teamMap.ownerOf(note.teamId);
        let where: { place: "ME" | "TEAM" | "SONGBOOK" | "SET" | "SONG"; teamId: string | null; songbookId: string | null; setlistId: string | null } | null = null;
        if (note.place === "ME") where = note.mine || destination.scope === "USER" ? { place: "ME", teamId: null, songbookId: null, setlistId: null } : null;
        else if (note.place === "TEAM") {
          const teamId = owner.ownerTeamId ?? (note.teamId && importerTeams.has(note.teamId) ? note.teamId : null);
          where = teamId ? { place: "TEAM", teamId, songbookId: null, setlistId: null } : { place: "ME", teamId: null, songbookId: null, setlistId: null };
        } else if (note.place === "SONGBOOK") {
          const songbookId = note.songbookId ? songbookIds.get(note.songbookId) : undefined;
          where = songbookId ? { place: "SONGBOOK", teamId: null, songbookId, setlistId: null } : null;
        } else if (note.place === "SET") {
          const setlistId = note.setId ? setIds.get(note.setId) : undefined;
          where = setlistId ? { place: "SET", teamId: null, songbookId: null, setlistId } : null;
        } else where = songIds.has(note.songId) ? { place: "SONG", teamId: null, songbookId: null, setlistId: null } : null;
        if (!where) {
          summary.leave(`A note on "${note.songTitle ?? note.songId}": where it was isn't in the archive`);
          continue;
        }
        const content_ = note.mine || !note.authorName ? note.content : `${note.authorName}: ${note.content}`;
        const already = await tx.note.count({ where: { ...where, songVersionId: songId, authorUserId: importer.id, content: content_ } });
        if (already > 0) continue;
        await tx.note.create({
          data: {
            ...where,
            songVersionId: songId,
            authorUserId: importer.id,
            content: content_,
            anchor: anchor.data as object,
            resolvedAt: note.resolvedAt ? new Date(note.resolvedAt) : null,
            replies: { create: note.replies.map((reply) => ({ authorUserId: importer.id, content: reply.authorName ? `${reply.authorName}: ${reply.content}` : reply.content })) },
          },
        });
        summary.result.created.notes += 1;
      }
    },
    { timeout: 30 * 60 * 1000, maxWait: 30_000 },
  );
  return summary.result;
}

const IDENTIFIER_TYPES = new Set(["CCLI", "ISWC", "ISRC", "MUSICBRAINZ_WORK", "MUSICBRAINZ_RECORDING", "SPOTIFY", "APPLE_MUSIC", "DEEZER", "YOUTUBE", "CUSTOM", "METADATA_MATCH"]);

/** Where each of an archive's teams' content goes, and the teams an organisation's import makes. */
async function planTeams(deps: ImportDeps, content: ArchiveContent, destination: ArchiveOwner) {
  const db = deps.prisma.client;
  const fixed = (owner: Owner) => ({ ownerOf: (_teamId?: string | null) => owner, created: new Set<string>(), create: async (_tx: Tx, _by: string, _summary: Summary) => undefined });
  if (destination.scope === "USER") return fixed({ ownerScope: "USER", ownerUserId: destination.userId, ownerTeamId: null });
  if (destination.scope === "TEAM") return fixed({ ownerScope: "TEAM", ownerUserId: null, ownerTeamId: destination.teamId });

  // An organisation's: each team to its team by ID, then by name, or a new group; a person's content to a group named after them.
  const teams = await db.team.findMany({ where: { organizationId: destination.organizationId, usesSongverse: true }, select: { id: true, name: true } });
  const names = new Map(content.manifest.teams.map((team) => [team.id, team.name]));
  const wanted = new Set<string>();
  for (const item of [...content.songs, ...content.arrangements, ...content.songbooks, ...content.sets, ...content.notes]) wanted.add(item.teamId ?? "");
  const map = new Map<string, string>();
  const toCreate = new Map<string, string>();
  for (const key of wanted) {
    const name = (key ? names.get(key) : content.manifest.scope.name) ?? content.manifest.scope.name;
    const found = teams.find((team) => team.id === key) ?? teams.find((team) => team.name.toLowerCase() === name.toLowerCase());
    if (found) map.set(key, found.id);
    else toCreate.set(key, name.slice(0, 100));
  }
  const created = new Set<string>();
  return {
    created,
    ownerOf: (teamId?: string | null): Owner => ({ ownerScope: "TEAM", ownerUserId: null, ownerTeamId: map.get(teamId ?? "") ?? map.get("")! ?? [...map.values()][0]! }),
    create: async (tx: Tx, by: string, summary: Summary) => {
      for (const [key, name] of toCreate) {
        const team = await tx.team.create({
          data: { name, slug: `${slugify(name) || "team"}-${randomBytes(3).toString("hex")}`, organizationId: destination.organizationId, memberships: { create: { userId: by, role: "ADMIN" } } },
          select: { id: true },
        });
        await joinTeamOrganization(tx as never, team.id, [by]);
        map.set(key, team.id);
        created.add(team.id);
        summary.result.created.teams += 1;
      }
    },
  };
}

/** Songs with their original (in the archive) before them. */
function parentsFirst(songs: ArchiveSong[]): ArchiveSong[] {
  const byId = new Map(songs.map((song) => [song.id, song]));
  const done = new Set<string>();
  const order: ArchiveSong[] = [];
  const visit = (song: ArchiveSong, depth: number) => {
    if (done.has(song.id)) return;
    done.add(song.id);
    const parent = song.parentId ? byId.get(song.parentId) : undefined;
    if (parent && depth < 50) visit(parent, depth + 1);
    order.push(song);
  };
  for (const song of songs) visit(song, 0);
  return order;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted((value as Record<string, unknown>)[key])]));
  return value;
}

function sameEntries(a: { songVersionId: string; entryCode: string | null }[], b: { songVersionId: string; entryCode: string | null }[]): boolean {
  const key = (rows: typeof a) => rows.map((row) => `${row.songVersionId}:${row.entryCode ?? ""}`).sort().join("|");
  return key(a) === key(b);
}

/** `name`, or "name (imported)", "name (imported 2)"… when it's taken. */
function freeName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? `${name} (imported)` : `${name} (imported ${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}
