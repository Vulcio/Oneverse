import { readSongDocument, songToChordPro } from "@oneverse/core";
import type { Prisma } from "@oneverse/db";
import { join } from "node:path";
import { serverVersion } from "../common/version.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { StorageService } from "../storage/storage.service.js";
import {
  ARCHIVE_FILES,
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  archiveFilePath,
  type ArchiveArrangement,
  type ArchiveAttachment,
  type ArchiveManifest,
  type ArchiveNote,
  type ArchiveSet,
  type ArchiveSong,
  type ArchiveSongbook,
} from "./archive-format.js";
import { ArchiveWriter } from "./archive-zip.js";

/** Whose archive: a person's, a team's, or an organisation's teams'. */
export type ArchiveOwner = { scope: "USER"; userId: string } | { scope: "TEAM"; teamId: string } | { scope: "ORGANIZATION"; organizationId: string };

export interface ExportedArchive {
  path: string;
  sha256: string;
  sizeBytes: number;
  counts: Record<string, number>;
  name: string;
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

/**
 * Everything `owner` owns, as an archive file in `folder` (issue #351): songs
 * with their credits, tags, links and files, arrangements, songbooks, sets
 * and notes. What it holds:
 * - a person's: their own songs, arrangements, songbooks and sets, the notes
 *   they wrote for themselves, and the notes on their songbooks and sets;
 * - a team's: the team's, and its team notes;
 * - an organisation's: each of its teams' (the groups that only plan own nothing).
 * Never someone else's private files or links on those songs, nor a Bible's
 * text (a passage is its reference), nor anything shared with them but not theirs.
 */
export async function exportArchive(prisma: PrismaService, storage: StorageService, owner: ArchiveOwner, folder: string): Promise<ExportedArchive> {
  const db = prisma.client;
  const { name, teams, userId } = await whose(prisma, owner);
  const teamIds = teams.map((team) => team.id);
  const owned = userId ? { ownerScope: "USER" as const, ownerUserId: userId } : { ownerScope: "TEAM" as const, ownerTeamId: { in: teamIds } };

  const songRows = await db.songVersion.findMany({
    where: owned,
    orderBy: { createdAt: "asc" },
    include: {
      contributors: { orderBy: { displayOrder: "asc" } },
      versionTags: { include: { tag: { select: { slug: true, label: true } } } },
      identifiers: true,
      links: true,
      attachments: { where: { processing: null }, orderBy: { createdAt: "asc" } },
    },
  });
  // Each file, and where it's stored (an organisation's own bucket, issue #206).
  const files = new Map<string, { mimeType: string; location: string | null }>();
  const keep = (sha: string | null | undefined, mimeType: string, location: string | null = null) => {
    if (sha) files.set(sha, { mimeType, location });
    return sha ?? null;
  };
  // Another person's private file or link on these songs is theirs, not the owner's.
  const owns = (visibility: string, by: string | null, teamId: string | null) =>
    visibility === "SONG" || visibility === "SHARED" || (userId ? by === userId : visibility === "TEAM" && !!teamId && teamIds.includes(teamId));

  const songs: ArchiveSong[] = songRows.map((song) => ({
    id: song.id,
    teamId: song.ownerTeamId,
    title: song.title,
    alternateTitle: song.alternateTitle,
    versionName: song.versionName,
    sortTitle: song.sortTitle,
    language: song.language,
    trustLabel: song.trustLabel,
    imageSha256: keep(song.imageStorageKey, "image/jpeg"),
    imageSourceUrl: song.imageSourceUrl,
    copyright: song.copyright,
    copyrightYear: song.copyrightYear,
    publisher: song.publisher,
    album: song.album,
    year: song.year,
    isrc: song.isrc,
    reference: song.reference,
    notes: song.notes,
    ccli: song.ccli,
    capo: song.capo,
    documentJson: song.documentJson,
    relationshipType: song.relationshipType,
    parentId: song.parentVersionId,
    defaultGrooveStyleId: song.defaultGrooveStyleId,
    defaultGrooveVariant: song.defaultGrooveVariant,
    credits: song.contributors.map((credit) => ({ source: credit.source, roles: credit.roles })),
    tags: song.versionTags.map(({ tag }) => ({ slug: tag.slug, label: tag.label })),
    identifiers: song.identifiers.map((identifier) => ({ type: identifier.type, value: identifier.value, sourceUrl: identifier.sourceUrl, note: identifier.note, details: identifier.details ?? undefined })),
    links: song.links
      .filter((link) => owns(link.visibility, link.addedByUserId, link.visibleToTeamId))
      .map((link) => ({ id: link.id, url: link.url, service: link.service, value: link.value, label: link.label, startSeconds: link.startSeconds, visibility: link.visibility, visibleToTeamId: link.visibleToTeamId })),
    attachments: song.attachments
      .filter((file) => owns(file.visibility, file.uploadedByUserId, file.visibleToTeamId))
      .map(
        (file): ArchiveAttachment => ({
          id: file.id,
          type: file.type,
          filename: file.filename,
          mimeType: file.mimeType,
          sha256: keep(file.storageKey, file.mimeType, file.storedInOrganizationId)!,
          sizeBytes: file.sizeBytes ?? 0,
          originalSha256: keep(file.originalStorageKey, file.originalMimeType ?? "application/octet-stream", file.storedInOrganizationId),
          originalMimeType: file.originalMimeType,
          originalSizeBytes: file.originalSizeBytes,
          stemPart: file.stemPart,
          pitchOffset: file.pitchOffset,
          cuePoints: file.cuePoints ?? undefined,
          locked: file.locked,
          origin: file.origin,
          detected: file.detected,
          partName: file.partName,
          recordingKey: file.recordingKey,
          recordingTempo: file.recordingTempo,
          recordingFirstBeat: file.recordingFirstBeat,
          recordingFreeIntro: file.recordingFreeIntro,
          recordingBeats: file.recordingBeats,
          recordingDownbeats: file.recordingDownbeats,
          recordingTimeSignature: file.recordingTimeSignature,
          multitrackId: file.multitrackId,
          multitrackName: file.multitrackName,
          multitrackSetId: file.multitrackSetlistId,
          otherTake: file.otherTake,
          visibility: file.visibility,
          visibleToTeamId: file.visibleToTeamId,
        }),
      ),
    createdAt: iso(song.createdAt),
  }));

  const ownedBy = userId ? { ownerUserId: userId } : { ownerTeamId: { in: teamIds } };
  const setRows = await db.setlist.findMany({ where: ownedBy, orderBy: { createdAt: "asc" }, include: { items: { orderBy: { position: "asc" }, include: { songVersion: { select: { title: true } } } } } });
  const sets: ArchiveSet[] = setRows.map((set) => ({
    id: set.id,
    teamId: set.ownerTeamId,
    name: set.name,
    description: set.description,
    eventDate: set.eventDate ? set.eventDate.toISOString().slice(0, 10) : null,
    items: set.items.map((item) => ({
      id: item.id,
      kind: item.kind,
      songId: item.songVersionId,
      songTitle: item.songVersion?.title ?? null,
      text: item.text ?? undefined,
      // A passage is its Bible and reference only; its text is read from the Bible.
      passage: item.passage ?? undefined,
      arrangementId: item.arrangementId,
      position: item.position,
      transposeSteps: item.transposeSteps,
      tempoOverride: item.tempoOverride,
      notes: item.notes,
      transition: item.transition,
      transitionNote: item.transitionNote,
      transitionChords: item.transitionChords,
      timer: item.timer ?? undefined,
      screenTemplate: item.screenTemplate ?? undefined,
    })),
  }));
  const setItemIds = new Set(setRows.flatMap((set) => set.items.map((item) => item.id)));

  const arrangementRows = await db.arrangement.findMany({
    where: { ...(userId ? { ownerScope: "USER", ownerUserId: userId } : { ownerScope: "TEAM", ownerTeamId: { in: teamIds } }) },
    orderBy: { createdAt: "asc" },
    include: { songVersion: { select: { title: true, deletedAt: true } }, guitarTuningPreset: { select: { slug: true } } },
  });
  const arrangements: ArchiveArrangement[] = arrangementRows
    .filter((arrangement) => !arrangement.songVersion.deletedAt && (!arrangement.setlistItemId || setItemIds.has(arrangement.setlistItemId)))
    .map((arrangement) => ({
      id: arrangement.id,
      teamId: arrangement.ownerTeamId,
      songId: arrangement.songVersionId,
      songTitle: arrangement.songVersion.title,
      name: arrangement.name,
      description: arrangement.description,
      documentJson: arrangement.documentJson,
      isTeamDefault: arrangement.isTeamDefault,
      setItemId: arrangement.setlistItemId,
      linkId: arrangement.linkId,
      multitrackId: arrangement.multitrackId,
      guitarTuningSlug: arrangement.guitarTuningPreset?.slug ?? null,
    }));

  const songbookRows = await db.songbook.findMany({
    where: userId ? { ownerScope: "USER", ownerUserId: userId } : { ownerScope: "TEAM", ownerTeamId: { in: teamIds } },
    orderBy: { createdAt: "asc" },
    include: { entries: { orderBy: { createdAt: "asc" }, include: { songVersion: { select: { title: true, deletedAt: true } } } } },
  });
  const songbooks: ArchiveSongbook[] = songbookRows.map((songbook) => ({
    id: songbook.id,
    teamId: songbook.ownerTeamId,
    name: songbook.name,
    abbreviation: songbook.abbreviation,
    language: songbook.language,
    publisher: songbook.publisher,
    year: songbook.year,
    kind: songbook.kind,
    color: songbook.color,
    avatarSha256: keep(songbook.avatarStorageKey, "image/jpeg"),
    sections: songbook.sections ?? undefined,
    entries: songbook.entries.filter((entry) => !entry.songVersion.deletedAt).map((entry) => ({ songId: entry.songVersionId, songTitle: entry.songVersion.title, entryCode: entry.entryCode })),
  }));

  const songIds = songRows.map((song) => song.id);
  const noteWhere: Prisma.NoteWhereInput = {
    OR: [
      userId ? { place: "ME", authorUserId: userId } : { place: "TEAM", teamId: { in: teamIds } },
      { songbookId: { in: songbookRows.map((songbook) => songbook.id) } },
      { setlistId: { in: setRows.map((set) => set.id) } },
      { place: "SONG", songVersionId: { in: songIds } },
    ],
  };
  const noteRows = await db.note.findMany({
    where: noteWhere,
    orderBy: { createdAt: "asc" },
    include: { author: { select: { displayName: true } }, songVersion: { select: { title: true } }, replies: { orderBy: { createdAt: "asc" }, include: { author: { select: { displayName: true } } } } },
  });
  const notes: ArchiveNote[] = noteRows.map((note) => ({
    id: note.id,
    place: note.place,
    content: note.content,
    anchor: note.anchor,
    authorName: note.author.displayName,
    mine: !!userId && note.authorUserId === userId,
    songId: note.songVersionId,
    songTitle: note.songVersion.title,
    teamId: note.teamId,
    songbookId: note.songbookId,
    setId: note.setlistId,
    resolvedAt: iso(note.resolvedAt),
    createdAt: iso(note.createdAt),
    replies: note.replies.map((reply) => ({ authorName: reply.author.displayName, content: reply.content, createdAt: iso(reply.createdAt) })),
  }));

  const counts = { songs: songs.length, arrangements: arrangements.length, songbooks: songbooks.length, sets: sets.length, notes: notes.length, files: files.size };
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    server: { version: serverVersion().version },
    scope: { kind: owner.scope, id: userId ?? (owner.scope === "TEAM" ? owner.teamId : owner.scope === "ORGANIZATION" ? owner.organizationId : ""), name },
    teams,
    counts,
  };

  const path = join(folder, "archive.zip");
  const writer = new ArchiveWriter(path);
  try {
    await writer.addJson(ARCHIVE_FILES.manifest, manifest);
    await writer.addJson(ARCHIVE_FILES.songs, songs);
    await writer.addJson(ARCHIVE_FILES.arrangements, arrangements);
    await writer.addJson(ARCHIVE_FILES.songbooks, songbooks);
    await writer.addJson(ARCHIVE_FILES.sets, sets);
    await writer.addJson(ARCHIVE_FILES.notes, notes);
    await writer.addText("README.txt", readme(manifest));
    // Each song as ChordPro too, to read without Oneverse (never read back).
    for (const song of songRows) {
      const credits = (role: string) => song.contributors.filter((credit) => credit.roles.includes(role as never) && credit.source).map((credit) => credit.source!);
      const chordPro = songToChordPro(readSongDocument(song.documentJson), {
        title: song.title,
        subtitle: song.alternateTitle,
        artists: credits("PERFORMER"),
        composers: credits("COMPOSER"),
        lyricists: credits("LYRICIST"),
        album: song.album,
        year: song.year,
        copyright: song.copyright,
        ccli: song.ccli,
        capo: song.capo,
      });
      await writer.addText(`chordpro/${fileName(song.title)}-${song.id}.cho`, chordPro);
    }
    for (const [sha, { location }] of files) {
      const body = await storage.stream(sha, undefined, location).catch(() => null);
      // A file storage lost is left out; the import says so.
      if (body) await writer.addStream(archiveFilePath(sha), body);
    }
    const { sha256, sizeBytes } = await writer.finish();
    return { path, sha256, sizeBytes, counts, name };
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

async function whose(prisma: PrismaService, owner: ArchiveOwner): Promise<{ name: string; teams: { id: string; name: string }[]; userId: string | null }> {
  const db = prisma.client;
  if (owner.scope === "USER") {
    const user = await db.user.findUniqueOrThrow({ where: { id: owner.userId }, select: { displayName: true, email: true } });
    return { name: user.displayName ?? user.email, teams: [], userId: owner.userId };
  }
  if (owner.scope === "TEAM") {
    const team = await db.team.findUniqueOrThrow({ where: { id: owner.teamId }, select: { id: true, name: true } });
    return { name: team.name, teams: [team], userId: null };
  }
  const organization = await db.organization.findUniqueOrThrow({ where: { id: owner.organizationId }, select: { name: true } });
  const teams = await db.team.findMany({ where: { organizationId: owner.organizationId, usesSongverse: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return { name: organization.name, teams, userId: null };
}

/** A name a file can have on any system. */
export function fileName(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "song"
  );
}

function readme(manifest: ArchiveManifest): string {
  return [
    `Oneverse archive of ${manifest.scope.name}, made ${manifest.createdAt}.`,
    "",
    "Import it back in Songverse: Backups, in your dashboard's settings, or on the team's or organisation's page.",
    "nothing already there is changed, and everything it holds gets new IDs.",
    "",
    "songs.json, arrangements.json, songbooks.json, sets.json, notes.json: the content.",
    "chordpro/: each song as ChordPro, to read anywhere.",
    "files/: the songs' files, named by the SHA-256 of their bytes (songs.json gives their names).",
    "",
  ].join("\n");
}
