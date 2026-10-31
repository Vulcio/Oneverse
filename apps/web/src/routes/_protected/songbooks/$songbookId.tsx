import { ApiError, BULK_UPLOAD_EXTENSIONS, isNetworkError, keptSongbook, onlineOrKept, type BulkUploadContentType, type BulkUploadFileMatch, type LanguageCode, type SongbookSection, type SongVersionSummary } from "@oneverse/core";
import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { ChevronDown, Settings2, Share2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { LanguageSelect } from "#/components/language-select";
import { AppearanceCard } from "#/components/appearance-card";
import { EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Badge } from "@oneverse/ui/components/badge";
import { SongbookShareDialog } from "#/components/songbook-share-dialog";
import { TeamAccessDialog } from "#/components/set-team-access";
import { OfflinePinButton } from "#/components/offline-pin-button";
import { SectionsEditor } from "#/components/sections-editor";
import { deviceStorage } from "#/lib/offline-data";

/** A bulk upload's files go in batches of at most this many files and bytes (issue #202): within the API's limit per request, and its memory. */
const BULK_UPLOAD_BATCH_FILES = 100;
const BULK_UPLOAD_BATCH_BYTES = 50 * 1024 * 1024;

export const Route = createFileRoute("/_protected/songbooks/$songbookId")({
  // Offline, the copy kept with "Keep a local copy" (issue #52), read-only.
  loader: async ({ context, params }) => {
    const songbook = await onlineOrKept(
      () =>
        apiClient.getSongbook(params.songbookId).catch((error: unknown) => {
          if (isNetworkError(error)) throw error;
          return null;
        }),
      () => keptSongbook(deviceStorage(), params.songbookId),
    );
    if (!songbook) throw redirect({ to: "/songbooks" });
    return { session: context.session, teams: context.teams, songbook, offline: !!context.offline };
  },
  component: SongbookDetail,
});

function SongbookDetail() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const { session, teams, songbook, offline } = Route.useLoaderData();

  // Its owner (or its team's admins) change, share and delete it; someone it's shared with to edit changes its entries and details (issue #211).
  const owns =
    songbook.access === "own" ||
    (!songbook.access &&
      (session.isGlobalAdmin ||
        (songbook.ownerScope === "USER"
          ? songbook.ownerUserId === session.userId
          : songbook.ownerScope === "TEAM"
            ? teams.some((team) => team.id === songbook.ownerTeamId && team.currentUserRole === "ADMIN")
            : false)));
  const canEdit = !offline && (owns || songbook.access === "edit");
  const sharedWithMe = songbook.access === "edit" || (songbook.access === "view" && songbook.ownerScope !== "GLOBAL");
  const [sharing, setSharing] = useState(false);
  const isNumbered = songbook.kind === "NUMBERED";

  const [name, setName] = useState(songbook.name);
  const [abbreviation, setAbbreviation] = useState(songbook.abbreviation ?? "");
  const [language, setLanguage] = useState(songbook.language ?? "");
  const [publisher, setPublisher] = useState(songbook.publisher ?? "");
  const [year, setYear] = useState(songbook.year?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);

  const [entryFilter, setEntryFilter] = useState("");
  const [selectedSongVersionId, setSelectedSongVersionId] = useState("");
  const [entryCode, setEntryCode] = useState("");
  const [addingEntry, setAddingEntry] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);
  // One's own song into a team's songbook: shared with the team or moved to it first (issue #340).
  const [askingTeam, setAskingTeam] = useState<{ title: string; team: string } | null>(null);
  const [sectionFilter, setSectionFilter] = useState("");

  const [sections, setSections] = useState<SongbookSection[]>(songbook.sections ?? []);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [materializingId, setMaterializingId] = useState<string | null>(null);
  const [materializeError, setMaterializeError] = useState<string | null>(null);

  const [bulkUploadType, setBulkUploadType] = useState<BulkUploadContentType>("CHORDPRO");
  const [bulkUploadFiles, setBulkUploadFiles] = useState<File[]>([]);
  const [bulkUploadPreview, setBulkUploadPreview] = useState<BulkUploadFileMatch[] | null>(null);
  const [previewingBulkUpload, setPreviewingBulkUpload] = useState(false);
  const [committingBulkUpload, setCommittingBulkUpload] = useState(false);
  const [bulkUploadResult, setBulkUploadResult] = useState<{ queued: number; skipped: string[] } | null>(null);
  const [bulkUploadError, setBulkUploadError] = useState<string | null>(null);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{ done: number; of: number } | null>(null);

  // Songs matching what's typed, searched on the server (the whole
  // library, not just what's loaded), minus those already in the book.
  const [songMatches, setSongMatches] = useState<SongVersionSummary[]>([]);
  useEffect(() => {
    const q = entryFilter.trim();
    if (!q || selectedSongVersionId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiClient
        .listSongVersions({ q, sort: "title", pageSize: 40 })
        .then(({ items }) => !cancelled && setSongMatches(items))
        .catch(() => !cancelled && setSongMatches([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entryFilter, selectedSongVersionId]);
  const filteredSongVersions = useMemo(() => {
    const alreadyAdded = new Set(songbook.entries.map((entry) => entry.songVersionId));
    return songMatches.filter((version) => !alreadyAdded.has(version.id)).slice(0, 20);
  }, [songMatches, songbook.entries]);

  const visibleEntries = useMemo(() => {
    if (!sectionFilter) return songbook.entries;
    return songbook.entries.filter((entry) => entry.sectionLabel === sectionFilter);
  }, [songbook.entries, sectionFilter]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.updateSongbook(songbook.id, {
        name,
        abbreviation: abbreviation.trim() || undefined,
        language: (language.trim() || undefined) as LanguageCode | undefined,
        publisher: publisher.trim() || undefined,
        year: year.trim() ? Number(year) : undefined,
      });
      await router.invalidate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await apiClient.deleteSongbook(songbook.id);
      await navigate({ to: "/songbooks" });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function addEntry(teamAccess?: "share" | "move") {
    if (!selectedSongVersionId || (isNumbered && !entryCode.trim())) return;
    setAddingEntry(true);
    setEntryError(null);
    try {
      await apiClient.addSongbookEntry(songbook.id, selectedSongVersionId, isNumbered ? entryCode.trim() : undefined, teamAccess);
      setAskingTeam(null);
      setSelectedSongVersionId("");
      setEntryCode("");
      setEntryFilter("");
      await router.invalidate();
    } catch (err) {
      if (err instanceof ApiError && err.code === "SONG_NOT_SHARED") {
        // Picking a song writes its title in the search box.
        setAskingTeam({ title: entryFilter, team: teams.find((team) => team.id === songbook.ownerTeamId)?.name ?? "" });
        return;
      }
      setEntryError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingEntry(false);
    }
  }

  async function removeEntry(entryId: string) {
    try {
      await apiClient.removeSongbookEntry(songbook.id, entryId);
      await router.invalidate();
    } catch (err) {
      setEntryError(err instanceof Error ? err.message : String(err));
    }
  }

  async function materializeEntry(catalogEntryId: string) {
    setMaterializingId(catalogEntryId);
    setMaterializeError(null);
    try {
      await apiClient.materializeSongbookCatalogEntry(songbook.id, catalogEntryId);
      await router.invalidate();
    } catch (err) {
      setMaterializeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMaterializingId(null);
    }
  }

  async function selectBulkUploadFiles(files: File[], type = bulkUploadType) {
    setBulkUploadFiles(files);
    setBulkUploadResult(null);
    setBulkUploadError(null);
    setBulkUploadPreview(null);
    if (files.length === 0) return;
    setPreviewingBulkUpload(true);
    try {
      const matches = await apiClient.previewBulkUpload(
        songbook.id,
        files.map((file) => file.name),
        type,
      );
      setBulkUploadPreview(matches);
    } catch (err) {
      setBulkUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewingBulkUpload(false);
    }
  }

  async function commitBulkUpload() {
    if (!bulkUploadPreview) return;
    const matchedFilenames = new Set(
      bulkUploadPreview.filter((match) => match.status === "MATCHED").map((match) => match.filename),
    );
    const filesToUpload = bulkUploadFiles.filter((file) => matchedFilenames.has(file.name));
    if (filesToUpload.length === 0) return;

    setCommittingBulkUpload(true);
    setBulkUploadError(null);
    // In batches (issue #202): the API takes so many files, and so many MB, per request.
    const batches: File[][] = [];
    for (const file of filesToUpload) {
      const last = batches.at(-1);
      if (!last || last.length >= BULK_UPLOAD_BATCH_FILES || last.reduce((total, one) => total + one.size, 0) + file.size > BULK_UPLOAD_BATCH_BYTES) batches.push([file]);
      else last.push(file);
    }
    const total = { queued: 0, skipped: [] as string[] };
    setBulkUploadProgress({ done: 0, of: filesToUpload.length });
    try {
      for (const batch of batches) {
        const result = await apiClient.commitBulkUpload(songbook.id, bulkUploadType, batch);
        total.queued += result.queued;
        total.skipped.push(...result.skipped);
        setBulkUploadProgress((progress) => progress && { ...progress, done: progress.done + batch.length });
      }
      setBulkUploadResult(total);
      setBulkUploadFiles([]);
      setBulkUploadPreview(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // What was already sent stays queued: said, so it isn't sent twice.
      setBulkUploadError(total.queued ? t("songbooks.bulkUploadPartly", { queued: total.queued, message }) : message);
      if (total.queued) setBulkUploadResult(total);
    } finally {
      setCommittingBulkUpload(false);
      setBulkUploadProgress(null);
    }
  }

  async function saveSections(next: SongbookSection[]) {
    await apiClient.updateSongbook(songbook.id, { sections: next });
    setSections(next);
  }

  return (
    <div className="flex flex-col gap-6">
      {owns ? <SongbookShareDialog songbookId={songbook.id} open={sharing} onOpenChange={setSharing} /> : null}
      <TeamAccessDialog
        testId="songbook-team-access"
        song={askingTeam?.title ?? null}
        team={askingTeam?.team ?? ""}
        description={t("songbooks.teamAccessDescription", { team: askingTeam?.team ?? "" })}
        busy={addingEntry}
        error={askingTeam ? entryError : null}
        onChoose={(access) => void addEntry(access)}
        onCancel={() => setAskingTeam(null)}
      />
      <div>
        <div className="flex min-w-0 items-center gap-3">
          <EntityAvatar name={songbook.name} color={songbook.color} avatarUrl={songbook.avatarUrl} size={40} />
          <h1 className="min-w-0 text-2xl font-semibold break-words">{songbook.name}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {[
            songbook.ownerScope === "GLOBAL"
              ? t("songbooks.global")
              : songbook.ownerScope === "TEAM"
                ? t("songbooks.teamOwned")
                : t("songbooks.personal"),
            isNumbered ? t("songbooks.kindNumbered") : t("songbooks.kindSimple"),
            t("songbooks.entriesCount", { count: songbook.entries.length }),
            songbook.publisher,
            songbook.year,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <OfflinePinButton kind="SONGBOOK" targetId={songbook.id} />
          {/* Shared with people and teams (issue #211), by its owner. */}
          {owns && !offline && songbook.ownerScope !== "GLOBAL" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setSharing(true)} data-testid="songbook-share">
              <Share2 />
              {t("songbookSharing.share")}
            </Button>
          ) : null}
          {sharedWithMe ? (
            <Badge variant="muted" data-testid="songbook-shared-with-me" data-access={songbook.access}>
              <Users className="size-3" />
              {songbook.access === "edit" ? t("songbookSharing.sharedToEdit") : t("songbookSharing.sharedToView")}
            </Badge>
          ) : null}
          {/* Its details, sections and deletion, tucked away: the page is about its entries (issue #148). */}
          <Button type="button" variant="outline" size="sm" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)} data-testid="songbook-details-toggle">
            <Settings2 />
            {t("songbooks.details")}
            <ChevronDown className={detailsOpen ? "rotate-180 transition-transform" : "transition-transform"} />
          </Button>
        </div>
      </div>

      {detailsOpen ? (
        <div className="flex flex-col gap-6" data-testid="songbook-details">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("songbooks.details")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="songbook-name">{t("songbooks.name")}</Label>
                <Input id="songbook-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="songbook-abbreviation">{t("songbooks.abbreviation")}</Label>
                <Input
                  id="songbook-abbreviation"
                  value={abbreviation}
                  onChange={(e) => setAbbreviation(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="songbook-language">{t("songbooks.language")}</Label>
                <LanguageSelect
                  id="songbook-language"
                  value={language}
                  onChange={setLanguage}
                  disabled={!canEdit}
                  allowEmpty
                  emptyLabel={t("common.noLanguage")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="songbook-publisher">{t("songbooks.publisher")}</Label>
                <Input
                  id="songbook-publisher"
                  value={publisher}
                  onChange={(e) => setPublisher(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="songbook-year">{t("songbooks.year")}</Label>
                <Input
                  id="songbook-year"
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
              {canEdit ? (
                <div className="flex items-center justify-between">
                  <Button onClick={() => void save()} disabled={saving || !name.trim()}>
                    {saving ? t("songbooks.saving") : t("songbooks.save")}
                  </Button>
                  {owns ? <ConfirmButton
                    label={t("songbooks.deleteSongbook")}
                    confirmLabel={t("songbooks.confirmDelete")}
                    busyLabel={t("songbooks.deleting")}
                    cancelLabel={t("songbooks.cancel")}
                    busy={deleting}
                    onConfirm={remove}
                  /> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
          {/* Its colour and picture (issue #161). */}
          {canEdit ? (
            <AppearanceCard
              owner="songbooks"
              id={songbook.id}
              name={songbook.name}
              color={songbook.color}
              avatarUrl={songbook.avatarUrl}
              onColor={(color) => apiClient.updateSongbook(songbook.id, { color })}
              onChanged={() => router.invalidate()}
            />
          ) : null}
          {isNumbered ? (
            <SectionsEditor sections={sections} canEdit={canEdit} onSave={saveSections}>
              {canEdit && songbook.catalogSections?.length ? (
                // The catalogue's printed volumes differ: offered, never applied silently (issue #55).
                <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {t("songbooks.catalogSections", { sections: songbook.catalogSections.map((section) => `${section.label} (${section.start}–${section.end})`).join(", ") })}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => void saveSections(songbook.catalogSections!).then(() => router.invalidate())}>
                    {t("songbooks.useCatalogSections")}
                  </Button>
                </div>
              ) : null}
            </SectionsEditor>
          ) : null}
        </div>
      ) : null}

      {songbook.pendingEntries && songbook.pendingEntries.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("songbooks.pendingEntries")} ({songbook.pendingEntries.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("songbooks.pendingEntriesDescription")}</p>
            <ul className="flex max-h-96 flex-col divide-y overflow-auto">
              {songbook.pendingEntries.map((entry) => (
                <li
                  key={entry.catalogEntryId}
                  className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-14 shrink-0 rounded-md bg-muted px-2 py-1 text-center text-xs font-medium">
                      {entry.entryCode}
                    </span>
                    <span className="text-sm">{entry.title}</span>
                  </div>
                  {canEdit ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void materializeEntry(entry.catalogEntryId)}
                      disabled={materializingId === entry.catalogEntryId}
                    >
                      {materializingId === entry.catalogEntryId ? t("songbooks.starting") : t("songbooks.start")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {materializeError ? <p className="text-sm text-destructive">{materializeError}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">{t("songbooks.entries")}</CardTitle>
          {isNumbered && sections.length > 0 ? (
            <NativeSelect
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              compact
            >
              <option value="">{t("songbooks.allSections")}</option>
              {sections.map((section) => (
                <option key={section.label} value={section.label}>
                  {section.label}
                </option>
              ))}
            </NativeSelect>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {visibleEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("songbooks.noEntriesYet")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {visibleEntries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    {entry.entryCode ? (
                      <span className="w-14 shrink-0 rounded-md bg-muted px-2 py-1 text-center text-xs font-medium">
                        {entry.entryCode}
                      </span>
                    ) : null}
                    {entry.sectionLabel ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {entry.sectionLabel}
                      </span>
                    ) : null}
                    <Link
                      to="/library/$songVersionId"
                      params={{ songVersionId: entry.songVersionId }}
                      search={{ songbook: songbook.id }}
                      className="text-sm hover:text-primary"
                    >
                      {entry.songVersionTitle ?? entry.songVersionId}
                    </Link>
                  </div>
                  {canEdit ? (
                    <Button variant="ghost" size="sm" onClick={() => void removeEntry(entry.id)}>
                      {t("songbooks.remove")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <div className="flex flex-col gap-2 border-t pt-4">
              <Label htmlFor="entry-search">{t("songbooks.addEntry")}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="entry-search"
                  value={entryFilter}
                  onChange={(e) => {
                    setEntryFilter(e.target.value);
                    setSelectedSongVersionId("");
                  }}
                  placeholder={t("songbooks.searchSongPlaceholder")}
                  className="max-w-xs"
                />
                {isNumbered ? (
                  <Input
                    value={entryCode}
                    onChange={(e) => setEntryCode(e.target.value)}
                    placeholder={t("songbooks.entryCodePlaceholder")}
                    className="w-28"
                  />
                ) : null}
                <Button
                  onClick={() => void addEntry()}
                  disabled={addingEntry || !selectedSongVersionId || (isNumbered && !entryCode.trim())}
                >
                  {addingEntry ? t("songbooks.adding") : t("songbooks.add")}
                </Button>
              </div>
              {entryFilter && !selectedSongVersionId ? (
                filteredSongVersions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("songbooks.noMatchingSongs")}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {filteredSongVersions.map((version) => (
                      <li key={version.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSongVersionId(version.id);
                            setEntryFilter(version.title);
                          }}
                          className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          <span className="font-medium">{version.title}</span>
                          {version.versionName ? <span className="text-muted-foreground"> — {version.versionName}</span> : null}
                          {version.artists.length > 0 ? (
                            <span className="text-muted-foreground"> · {version.artists.map((a) => a.source).filter(Boolean).join(", ")}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
              {entryError ? <p className="text-sm text-destructive">{entryError}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* A bulk upload writes into its owner's songs: the owner's (issue #211). */}
      {isNumbered && canEdit && owns ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("songbooks.bulkUpload")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t("songbooks.bulkUploadDescription")}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bulk-upload-type">{t("songbooks.bulkUploadType")}</Label>
                <NativeSelect
                  id="bulk-upload-type"
                  value={bulkUploadType}
                  onChange={(e) => {
                    const type = e.target.value as BulkUploadContentType;
                    setBulkUploadType(type);
                    // Files already chosen: matched again for this kind (issue #201).
                    if (bulkUploadFiles.length) void selectBulkUploadFiles(bulkUploadFiles, type);
                  }}
                >
                  <option value="CHORDPRO">{t("songbooks.bulkUploadTypeChordpro")}</option>
                  <option value="PDF">{t("songbooks.bulkUploadTypePdf")}</option>
                </NativeSelect>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bulk-upload-files">{t("songbooks.bulkUploadChooseFiles")}</Label>
                <input
                  id="bulk-upload-files"
                  type="file"
                  multiple
                  // The chosen kind's files, in the picker (issue #201).
                  accept={BULK_UPLOAD_EXTENSIONS[bulkUploadType].join(",")}
                  disabled={previewingBulkUpload || committingBulkUpload}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    void selectBulkUploadFiles(files);
                  }}
                  className="text-sm"
                />
              </div>
            </div>

            {previewingBulkUpload ? (
              <p className="text-sm text-muted-foreground">{t("songbooks.bulkUploadPreviewing")}</p>
            ) : null}

            {bulkUploadPreview && bulkUploadPreview.length > 0 ? (
              <div className="flex flex-col gap-2 border-t pt-4">
                {/* System files ("._jem001.chordpro", ".DS_Store"): left out, only counted (issue #201). */}
                {bulkUploadPreview.some((match) => match.ignoredBecause === "hidden") ? (
                  <p className="text-xs text-muted-foreground" data-testid="bulk-upload-hidden">
                    {t("songbooks.bulkUploadHiddenLeftOut", { count: bulkUploadPreview.filter((match) => match.ignoredBecause === "hidden").length })}
                  </p>
                ) : null}
                <ul className="flex max-h-64 flex-col divide-y overflow-auto">
                  {bulkUploadPreview.filter((match) => match.ignoredBecause !== "hidden").map((match, index) => (
                    <li key={`${match.filename}-${index}`} className="flex items-center justify-between gap-4 py-2 text-sm" data-testid="bulk-upload-row" data-status={match.status}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{match.filename}</span>
                        {/* Which file it clashes with. */}
                        {match.conflictsWith?.length ? (
                          <span className="truncate text-xs text-muted-foreground" data-testid="bulk-upload-conflicts-with">
                            {t("songbooks.bulkUploadConflictsWith", { files: match.conflictsWith.join(", ") })}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        {match.entryCode ? (
                          <span className="rounded-md bg-muted px-2 py-1 text-center text-xs font-medium">
                            {match.entryCode}
                          </span>
                        ) : null}
                        <span
                          className={
                            match.status === "MATCHED"
                              ? "text-xs font-medium text-primary"
                              : "text-xs font-medium text-destructive"
                          }
                        >
                          {match.status === "MATCHED"
                            ? t("songbooks.bulkUploadStatusMatched")
                            : match.status === "DUPLICATE"
                              ? t("songbooks.bulkUploadStatusDuplicate")
                              : match.status === "IGNORED"
                                ? t("songbooks.bulkUploadStatusWrongType")
                                : t("songbooks.bulkUploadStatusUnmatched")}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => void commitBulkUpload()}
                  disabled={committingBulkUpload || !bulkUploadPreview.some((match) => match.status === "MATCHED")}
                  className="self-start"
                >
                  {committingBulkUpload ? (bulkUploadProgress && bulkUploadProgress.of > BULK_UPLOAD_BATCH_FILES ? t("songbooks.bulkUploadUploadingOf", { done: bulkUploadProgress.done, of: bulkUploadProgress.of }) : t("songbooks.bulkUploadUploading")) : t("songbooks.bulkUploadConfirm")}
                </Button>
              </div>
            ) : null}

            {bulkUploadResult ? (
              <div className="text-sm">
                <p>{t("songbooks.bulkUploadResult", { queued: bulkUploadResult.queued })}</p>
                {bulkUploadResult.skipped.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("songbooks.bulkUploadSkipped", { files: bulkUploadResult.skipped.join(", ") })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {bulkUploadError ? <p className="text-sm text-destructive">{bulkUploadError}</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
