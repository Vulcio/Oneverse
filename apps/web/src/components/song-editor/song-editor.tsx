import {
  ISO_639_1_CODES,
  getLanguageDisplayName,
  songToChordPro,
  type Attachment,
  type MetadataMatch,
  type MusicBrainzWorkMatch,
  type SongDocumentV2,
  type SongMatch,
  type SongVersionDetail,
  type SongVersionSongbookMembership,
  type Tag,
} from "@songverse/core";
import { useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
import { FileText, History, Info, Layers, Link2, MoreHorizontal, Music, PenLine, Share2, Star } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { OfflinePinButton } from "#/components/offline-pin-button";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@songverse/ui/components/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@songverse/ui/components/tabs";
import { apiClient } from "#/lib/api-client";
import { attachmentTypeFor, isPdf } from "./attachment-types";
import { RepeatsCard } from "./repeats-card";
import { SongContentCard, type SourceFile } from "./song-content";
import {
  emptyForm,
  fillFrom,
  formFromVersion,
  isDirty,
  nameKeyChanges,
  toCreateInput,
  toUpdateInput,
  validate,
  withContent,
  withSections,
  type SongForm,
} from "./song-form";
import { AutoDetectCard, BasicInfoCard, LibraryMatchPanel, MoreDetailsCard, SongbooksCard } from "./song-info";
import { PublishCard } from "./publish-card";
import { MySuggestionsCard } from "./my-suggestions-card";
import { LinkedSongsCard, relationKind } from "./linked-songs-card";
import { ProgressionsCard } from "./progressions-card";
import { Textarea } from "@songverse/ui/components/textarea";
import { ArrangementsTab } from "./arrangements-tab";
import { HistoryTab } from "./history-tab";
import { ShareDialog } from "./share-dialog";
import { ArtworkCard } from "./artwork-card";
import { AttachmentsTab, LinksTab, SaveFirst } from "./song-tabs";
import type { SongNotice, SongTab } from "./song-tabs-list";

// The editor (Tiptap and ProseMirror) loads when the Editor tab first opens, not with the song page.
const StructuredEditor = lazy(() => import("./structured/structured-editor").then((module) => ({ default: module.StructuredEditor })));
import { downloadBlob } from "#/lib/download";


type EditProps = {
  mode: "edit";
  version: SongVersionDetail;
  recordingMatch: MetadataMatch | null;
  workMatch: MusicBrainzWorkMatch | null;
  attachments: Attachment[];
  songbookMemberships: SongVersionSongbookMembership[];
  notices?: SongNotice[];
};
/** `linkTo`: the song this one is a translation or adaptation of, when started from it. */
type CreateProps = { mode: "create"; linkTo?: { id: string; label: string } };

type MatchVersion = SongMatch["versions"][number];

/** The version a new song is being added as another version of. */
type BasedOn = { id: string; label: string; copied: boolean };


/**
 * The song screen, for adding a song and for editing one: Song Info
 * (every field, the chart's text), Editor (the text beside a preview),
 * then Files, Audio and Links. Song Info and Editor are saved together by
 * "Save song"; files and links are saved as they're added.
 */
export function SongEditor(props: (CreateProps | EditProps) & { tags: Tag[]; tab: SongTab; onTabChange: (tab: SongTab) => void }) {
  const { tags, tab, onTabChange } = props;
  const edit = props.mode === "edit" ? props : null;
  const version = edit?.version ?? null;
  const canEdit = version ? version.canEdit : true;
  // Deleting, publishing, sharing it, its links and everyone's files: its owner (or team admins), not someone it's shared with (#77).
  const canManage = version ? version.canManage : true;
  const [sharing, setSharing] = useState(false);
  // A catalogue song someone can't edit: they can suggest a change instead (issue #74).
  const canSuggest = !!version && !version.canEdit && version.ownerScope === "GLOBAL";
  const [suggesting, setSuggesting] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestMessage, setSuggestMessage] = useState("");
  const [suggestionsKey, setSuggestionsKey] = useState(0);
  // The chart and details: the song's editors change them, and so does someone suggesting a change.
  const canChangeChart = canEdit || suggesting;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();

  const defaultLanguage = (ISO_639_1_CODES as readonly string[]).includes(i18n.language) ? i18n.language : "en";
  // Reload from the song when it changes (a save, say) - not when anything
  // else reloads the page (an upload), which would drop unsaved edits.
  const versionKey = version
    ? JSON.stringify([version.updatedAt, version.contributors.map((c) => [c.id, c.roles]), version.tags.map((tag) => tag.id)])
    : "new";
  const loaded = useMemo(() => (version ? formFromVersion(version) : emptyForm(defaultLanguage)), [versionKey]);
  const [initial, setInitial] = useState(loaded);
  const [form, setForm] = useState(loaded);
  // The form as last loaded or saved. The reloaded song replaces the form
  // only if it hasn't been edited since: the reload lands a moment after a
  // save, and an edit made in between must survive it (#39).
  const baseline = useRef(loaded);
  useEffect(() => {
    const base = baseline.current;
    baseline.current = loaded;
    setInitial(loaded);
    setForm((current) => (isDirty(current, base) ? current : loaded));
  }, [loaded]);

  const [showErrors, setShowErrors] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mbChoice, setMbChoice] = useState<MetadataMatch | null | undefined>(undefined);
  const [sourceFile, setSourceFile] = useState<SourceFile | null>(null);
  const [basedOn, setBasedOn] = useState<BasedOn | null>(props.mode === "create" && props.linkTo ? { ...props.linkTo, copied: false } : null);
  const [matches, setMatches] = useState<SongMatch[]>([]);
  const [dismissedTitle, setDismissedTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // A message over the page goes by itself once read; an error stays until the next try.
  useEffect(() => {
    if (message?.kind !== "ok") return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  // The header's height, for the editor's toolbar sticking under it (issue #248).
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => setHeaderHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const leaving = useRef(false);

  const errors = showErrors ? validate(form) : {};
  const dirty = isDirty(form, initial) || mbChoice !== undefined || sourceFile !== null || basedOn !== null;

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => dirty && !leaving.current && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  });

  function setField<K extends keyof SongForm>(field: K, value: SongForm[K]) {
    updateForm((current) => {
      const next = { ...current, [field]: value };
      // Key changes in the song's order are named from the song's key.
      return field === "key" ? { ...next, flow: nameKeyChanges(next.flow, next.key) } : next;
    });
  }

  function updateForm(change: (current: SongForm) => SongForm) {
    setForm(change);
    setMessage(null);
  }

  // Songs already in the library with this title (adding only).
  const title = form.title.trim();
  useEffect(() => {
    if (edit || basedOn || title.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      apiClient
        .findSongMatches(title)
        .then((found) => !cancelled && setMatches(found))
        .catch(() => !cancelled && setMatches([]));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [edit, basedOn, title]);
  const showMatches = matches.length > 0 && dismissedTitle !== title.toLowerCase();

  function chooseRecording(match: MetadataMatch | null) {
    setMessage(null);
    const key = (m: MetadataMatch) => m.sources.map((source) => `${source.provider}:${source.id}`).join(",");
    if (match && edit?.recordingMatch && key(edit.recordingMatch) === key(match)) {
      setMbChoice(undefined);
      return;
    }
    if (!match && !edit?.recordingMatch) {
      setMbChoice(undefined);
      return;
    }
    setMbChoice(match);
    if (!match) return;
    // Fill in what's still empty from what the providers know.
    setForm((current) => ({
      ...current,
      title: current.title.trim() ? current.title : match.title,
      artists: current.artists.length === 0 && match.artist ? [match.artist] : current.artists,
      album: current.album.trim() ? current.album : (match.album ?? ""),
      year: current.year.trim() ? current.year : (match.releaseDate?.slice(0, 4) ?? ""),
      isrc: current.isrc.trim() ? current.isrc : (match.isrc ?? ""),
      // Apple Music's composers wrote words and music: writers, unless the song credits someone already.
      writers:
        current.writers.length + current.composers.length + current.lyricists.length === 0 && match.composers?.length ? match.composers : current.writers,
    }));
  }

  async function useAsBase(base: MatchVersion) {
    setBusy(true);
    setMessage(null);
    try {
      const detail = await apiClient.getSongVersion(base.id);
      setForm((current) => fillFrom(current, formFromVersion(detail)));
      setBasedOn({ id: base.id, label: base.versionName ? `${base.title} — ${base.versionName}` : base.title, copied: true });
      setDetailsOpen(true);
    } catch {
      setMessage({ kind: "error", text: t("songEditor.loadFailed") });
    } finally {
      setBusy(false);
    }
  }

  /** Saves this song linked to `base`, as a translation or adaptation of it (issue #78). */
  function newVersionOf(base: MatchVersion) {
    const next = {
      ...form,
      title: form.title.trim() || base.title,
      artists: form.artists.length > 0 ? form.artists : base.artists,
    };
    const target = { id: base.id, label: base.versionName ? `${base.title} — ${base.versionName}` : base.title, copied: false };
    setForm(next);
    setBasedOn(target);
    void save(next, target);
  }

  function exportChordPro() {
    // What's on screen, saved or not: the chart from the text, the details from the fields.
    const doc: SongDocumentV2 = {
      $schema: "song-document/v2",
      revision: 0,
      defaults: {
        key: form.key || null,
        tempo: form.tempo.trim() ? Number(form.tempo) : null,
        timeSignature: form.timeSignature
          ? { numerator: Number(form.timeSignature.split("/")[0]), denominator: Number(form.timeSignature.split("/")[1]) }
          : null,
      },
      sections: form.sections,
      flow: form.flow,
    };
    const file = songToChordPro(doc, {
      title: form.title.trim(),
      subtitle: form.alternateTitle.trim() || null,
      artists: form.artists,
      composers: form.composers,
      lyricists: form.lyricists,
      album: form.album.trim() || null,
      year: form.year.trim() ? Number(form.year) : null,
      copyright: form.copyright.trim() || null,
      ccli: form.ccli.trim() || null,
      capo: form.capo ? Number(form.capo) : null,
    });
    downloadBlob(new Blob([file], { type: "text/plain" }), `${form.title.trim() || "song"}.cho`);
  }

  async function keepSourceFile(songVersionId: string) {
    if (!sourceFile || !(sourceFile.keep || isPdf(sourceFile.file))) return;
    await apiClient.uploadAttachment(songVersionId, attachmentTypeFor(sourceFile.file), sourceFile.file);
  }

  async function save(current: SongForm = form, base: BasedOn | null = basedOn) {
    setShowErrors(true);
    const problems = validate(current);
    if (Object.keys(problems).length > 0) {
      if (Object.keys(problems).some((field) => field !== "title" && field !== "artists")) setDetailsOpen(true);
      onTabChange("info");
      setMessage({ kind: "error", text: t("songEditor.fixErrors") });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      if (!edit) {
        const created = await apiClient.createSongVersion({ ...toCreateInput(current), ...(base && { basedOnVersionId: base.id }) });
        const notices: SongNotice[] = [];
        if (mbChoice) await apiClient.linkSongMetadata(created.id, mbChoice).catch(() => notices.push("linkFailed"));
        await keepSourceFile(created.id).catch(() => notices.push("fileFailed"));
        leaving.current = true;
        await navigate({
          to: "/library/$songVersionId",
          params: { songVersionId: created.id },
          search: { tab: "info", ...(notices.length > 0 && { notice: notices.join(",") }) },
        });
        return;
      }
      const update = toUpdateInput(current, initial);
      // The revision this edit started from: refused if someone saved in the meantime.
      if (Object.keys(update).length > 0) {
        await apiClient.updateSongVersion(edit.version.id, { ...update, revision: edit.version.documentJson.revision });
      }
      // Saved: edits made from here on are new ones, kept when the song reloads.
      baseline.current = current;
      if (mbChoice) await apiClient.linkSongMetadata(edit.version.id, mbChoice);
      else if (mbChoice === null) await apiClient.unlinkSongMetadata(edit.version.id);
      setMbChoice(undefined);
      await keepSourceFile(edit.version.id);
      setSourceFile(null);
      setShowErrors(false);
      await router.invalidate();
      setMessage({ kind: "ok", text: t("songEditor.saved") });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error && err.message ? err.message : t("songEditor.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  function openSuggest() {
    setShowErrors(true);
    if (Object.keys(validate(form)).length > 0) {
      onTabChange("info");
      setMessage({ kind: "error", text: t("songEditor.fixErrors") });
      return;
    }
    setSuggestOpen(true);
  }

  function stopSuggesting() {
    discard();
    setSuggesting(false);
  }

  /** Sends what's been changed as a suggestion (issue #74), and puts the song back as it is. */
  async function sendSuggestion() {
    if (!edit) return;
    setSaving(true);
    try {
      await apiClient.suggestChange(edit.version.id, {
        ...toUpdateInput(form, initial),
        revision: edit.version.documentJson.revision,
        message: suggestMessage.trim() || undefined,
      });
      setSuggestOpen(false);
      setSuggestMessage("");
      stopSuggesting();
      setSuggestionsKey((key) => key + 1);
      setMessage({ kind: "ok", text: t("suggestions.sent") });
    } catch (err) {
      setSuggestOpen(false);
      setMessage({ kind: "error", text: err instanceof Error && err.message ? err.message : t("suggestions.sendFailed") });
    } finally {
      setSaving(false);
    }
  }

  /** Takes a song shared with the user out of their library (#77). */
  async function leaveShared() {
    if (!edit) return;
    try {
      await apiClient.leaveSharedSong(edit.version.id);
      leaving.current = true;
      await navigate({ to: "/library" });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  function discard() {
    setForm(initial);
    setMbChoice(undefined);
    setSourceFile(null);
    setShowErrors(false);
    setMessage(null);
  }

  async function remove() {
    if (!edit) return;
    setDeleting(true);
    try {
      await apiClient.deleteSongVersion(edit.version.id);
      leaving.current = true;
      await navigate({ to: "/library" });
    } catch (err) {
      setDeleting(false);
      setConfirmingDelete(false);
      setMessage({ kind: "error", text: err instanceof Error ? err.message : t("songEditor.deleteFailed") });
    }
  }

  const attachments = edit?.attachments ?? [];
  const audioCount = attachments.filter((a) => a.type === "AUDIO").length;
  const fileCount = attachments.length - audioCount;
  const shownRecording = mbChoice === undefined ? (edit?.recordingMatch ?? null) : mbChoice;

  const songInfo = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <fieldset disabled={!canChangeChart || saving} className="flex min-w-0 flex-col gap-6">
        {basedOn ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm" role="status">
            <span className="min-w-0 flex-1">
              {t(basedOn.copied ? "songEditor.basedOnCopied" : "songEditor.basedOn", { title: basedOn.label })}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setBasedOn(null)}>
              {t("songEditor.undo")}
            </Button>
          </div>
        ) : null}
        <BasicInfoCard form={form} setField={setField} errors={errors} />
        {showMatches ? (
          <LibraryMatchPanel
            matches={matches}
            busy={busy || saving}
            onUseAsBase={(base) => void useAsBase(base)}
            onNewVersion={newVersionOf}
            onDismiss={() => setDismissedTitle(title.toLowerCase())}
          />
        ) : null}
        {canManage ? (
          <AutoDetectCard
            title={form.title}
            artist={form.artists[0]}
            shown={shownRecording}
            staged={mbChoice !== undefined}
            onChoose={chooseRecording}
          />
        ) : null}
        <MoreDetailsCard form={form} setField={setField} errors={errors} tags={tags} open={detailsOpen} onOpenChange={setDetailsOpen} />
      </fieldset>
      <div className="flex min-w-0 flex-col gap-6">
        {edit ? <ArtworkCard version={edit.version} canEdit={canEdit} /> : null}
        {canChangeChart ? (
          <fieldset disabled={saving} className="min-w-0">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" aria-hidden />
                  {t("songEditor.songContent")}
                </CardTitle>
                <CardDescription>{t("songEditor.songContentDescription")}</CardDescription>
              </CardHeader>
              <CardContent>
                <SongContentCard
                  content={form.content}
                  format={form.contentFormat}
                  onContentChange={(content) => updateForm((current) => withContent(current, content, current.contentFormat))}
                  onFormatChange={(format) => updateForm((current) => withContent(current, current.content, format))}
                  sourceFile={sourceFile}
                  onSourceFile={setSourceFile}
                />
              </CardContent>
            </Card>
          </fieldset>
        ) : null}
        {edit ? <SongbooksCard memberships={edit.songbookMemberships} title={edit.version.title} /> : null}
        {edit ? <LinkedSongsCard version={edit.version} /> : null}
        {edit ? <ProgressionsCard songVersionId={edit.version.id} /> : null}
        {edit && canManage && edit.version.ownerScope !== "GLOBAL" ? <PublishCard songVersionId={edit.version.id} /> : null}
        {edit && edit.version.ownerScope === "GLOBAL" ? <MySuggestionsCard songVersionId={edit.version.id} refreshKey={suggestionsKey} /> : null}
      </div>
    </div>
  );

  const heading = edit ? edit.version.title : t("songEditor.createTitle");
  // A catalogue song credits who put it there (issue #73).
  const contributor = edit?.version.ownerScope === "GLOBAL" ? (edit.version.contributedByTeam?.name ?? edit.version.contributedBy?.displayName ?? null) : null;
  const subheading = edit
    ? [
        edit.version.artists.map((a) => a.source).filter(Boolean).join(", "),
        getLanguageDisplayName(edit.version.language, i18n.language),
        contributor ? t("songEditor.contributedBy", { name: contributor }) : null,
        // Shared with them by its owner (#77).
        edit.version.sharedBy
          ? t(edit.version.sharedBy.canEdit ? "sharing.sharedByEdit" : "sharing.sharedByView", { name: edit.version.sharedBy.displayName })
          : null,
        // A translation or adaptation names the song it's linked to (issue #78).
        edit.version.parentVersion
          ? t(relationKind(edit.version.relationshipType) === "adaptation" ? "songEditor.adaptationOf" : "songEditor.translationOf", { title: edit.version.parentVersion.title })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("songEditor.createDescription");

  return (
    <form
      // Room for the phone's save bar, there whenever the song can be changed (issue #248).
      className={`flex flex-col gap-6 ${canChangeChart ? "pb-16 md:pb-0" : ""}`}
      style={{ "--song-header-h": `${headerHeight}px` } as CSSProperties}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (suggesting) openSuggest();
        else if (canEdit) void save();
      }}
    >
      {/* Sticky on wider screens; a phone gets the save bar at the bottom instead. */}
      <div ref={headerRef} className="bleed-x relative z-30 -mt-4 flex flex-wrap md:sticky md:top-14 items-center justify-between gap-3 border-b bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex min-w-0 items-center gap-3">
          {/* Its album art (issue #146), small: the header stays in view. */}
          {edit?.version.imageUrl ? <img src={`${edit.version.imageUrl}&w=128`} alt="" className="size-14 shrink-0 rounded-md object-cover shadow-sm sm:size-16" data-testid="song-art" /> : null}
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <span className="min-w-0 break-words">{heading}</span>
            {edit?.version.versionName ? (
              <span className="rounded-full border px-2.5 py-0.5 text-sm font-medium text-muted-foreground">{edit.version.versionName}</span>
            ) : null}
          </h1>
          {/* Beside the subtitle, not on a row of its own: the header stays short (issue #248). */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-muted-foreground">{subheading}</p>
            {edit ? <OfflinePinButton kind="SONG" targetId={edit.version.id} /> : null}
          </div>
        </div>
        </div>
        {/* One row of actions that wraps as a whole, never leaving a button alone on a line. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {canSuggest && !suggesting ? (
            <Button type="button" variant="outline" onClick={() => setSuggesting(true)}>
              <PenLine />
              {t("suggestions.suggest")}
            </Button>
          ) : null}
          {suggesting ? (
            <>
              <Button type="button" variant="outline" onClick={stopSuggesting} disabled={saving}>
                {t("songEditor.cancel")}
              </Button>
              <Button type="submit" disabled={saving || !dirty}>
                {t("suggestions.send")}
              </Button>
            </>
          ) : null}
          {canEdit ? (
            <>
              {edit ? (
                <Button type="button" variant="outline" onClick={discard} disabled={!dirty || saving}>
                  {t("songEditor.discard")}
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => void navigate({ to: "/library" })}>
                  {t("songEditor.cancel")}
                </Button>
              )}
              <Button type="submit" disabled={saving || (!!edit && !dirty)}>
                {saving ? t("songEditor.saving") : t("songEditor.save")}
              </Button>
            </>
          ) : null}
          {edit ? <FavoriteButton key={edit.version.id} songVersionId={edit.version.id} initial={!!edit.version.isFavorite} /> : null}
          {edit && canManage && edit.version.ownerScope !== "GLOBAL" ? (
            <Button type="button" variant="outline" onClick={() => setSharing(true)} aria-label={t("sharing.share")}>
              <Share2 />
              {/* Just the icon until there is room, so the header's actions stay on one row. */}
              <span className="hidden xl:inline">{t("sharing.share")}</span>
            </Button>
          ) : null}
          {edit ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={t("songEditor.moreActions")} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportChordPro}>{t("songEditor.exportChordPro")}</DropdownMenuItem>
                {edit.version.sharedBy ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void leaveShared()}>{t("sharing.leave")}</DropdownMenuItem>
                  </>
                ) : null}
                {canManage ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirmingDelete(true)}>
                      {t("songEditor.deleteSong")}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {/* Over the page, under the header: a message never pushes the page down (issue #248). */}
        {message ? (
          <p
            className={`absolute top-full right-4 mt-2 max-w-[min(32rem,calc(100%-2rem))] rounded-md border bg-background px-3 py-2 text-sm shadow-md ${message.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}
      </div>

      {edit?.notices?.length ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {edit.notices.map((notice) => t(`songEditor.notices.${notice}`)).join(" ")}
        </p>
      ) : null}
      {version && !canChangeChart ? <p className="text-sm text-muted-foreground">{t(canSuggest ? "suggestions.readOnly" : "songEditor.readOnly")}</p> : null}
      {suggesting ? (
        <p className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm" role="status">
          {t("suggestions.suggesting")}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => onTabChange(value as SongTab)} className="gap-6">
        <TabsList className="h-auto w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="info" className="flex-none px-3">
            <Info aria-hidden />
            {t("songEditor.tabs.info")}
          </TabsTrigger>
          <TabsTrigger value="editor" className="flex-none px-3">
            <PenLine aria-hidden />
            {t("songEditor.tabs.editor")}
          </TabsTrigger>
          <TabsTrigger value="arrangements" className="flex-none px-3">
            <Layers aria-hidden />
            {t("songEditor.tabs.arrangements")}
          </TabsTrigger>
          <TabsTrigger value="files" className="flex-none px-3">
            <FileText aria-hidden />
            {t("songEditor.tabs.files")}
            {fileCount > 0 ? <span className="rounded-full bg-muted px-1.5 text-xs">{fileCount}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="audio" className="flex-none px-3">
            <Music aria-hidden />
            {t("songEditor.tabs.audio")}
            {audioCount > 0 ? <span className="rounded-full bg-muted px-1.5 text-xs">{audioCount}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="links" className="flex-none px-3">
            <Link2 aria-hidden />
            {t("songEditor.tabs.links")}
          </TabsTrigger>
          {edit ? (
            <TabsTrigger value="history" className="flex-none px-3">
              <History aria-hidden />
              {t("songEditor.tabs.history")}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="info">{songInfo}</TabsContent>
        <TabsContent value="editor">
          <fieldset disabled={saving} className="min-w-0">
            {/* Sections written out again (issue #231): linked as passes of the one they repeat. */}
            {edit && canChangeChart && !suggesting ? <RepeatsCard songVersionId={edit.version.id} revision={edit.version.documentJson.revision} sections={form.sections} dirty={dirty} /> : null}
            <Suspense fallback={<p className="py-8 text-center text-sm text-muted-foreground">{t("songEditor.loadingEditor")}</p>}>
              <StructuredEditor
                sections={form.sections}
                onChange={(sections) => updateForm((current) => withSections(current, sections))}
                flow={form.flow}
                onFlowChange={(flow) => updateForm((current) => ({ ...current, flow: nameKeyChanges(flow, current.key) }))}
                songKey={form.key}
                onSongKeyChange={(key) => setField("key", key)}
                facts={{ tempo: form.tempo, timeSignature: form.timeSignature, capo: form.capo }}
                onFactChange={(field, value) => setField(field, value)}
                readOnly={!canChangeChart}
              />
            </Suspense>
          </fieldset>
        </TabsContent>
        <TabsContent value="arrangements">{edit ? <ArrangementsTab songVersionId={edit.version.id} /> : <SaveFirst />}</TabsContent>
        <TabsContent value="files">
          {edit ? <AttachmentsTab kind="files" songVersionId={edit.version.id} attachments={attachments} canEdit={canManage} canShare={canManage && edit.version.ownerScope !== "GLOBAL"} /> : <SaveFirst />}
        </TabsContent>
        <TabsContent value="audio">
          {edit ? <AttachmentsTab kind="audio" songVersionId={edit.version.id} attachments={attachments} canEdit={canManage} canShare={canManage && edit.version.ownerScope !== "GLOBAL"} songKey={form.key} songTempo={form.tempo} songTimeSignature={form.timeSignature} songTitle={form.title} /> : <SaveFirst />}
        </TabsContent>
        <TabsContent value="links">{edit ? <LinksTab version={edit.version} workMatch={edit.workMatch} /> : <SaveFirst />}</TabsContent>
        <TabsContent value="history">
          {edit ? <HistoryTab songVersionId={edit.version.id} updatedAt={edit.version.updatedAt} canEdit={canEdit} dirty={dirty} /> : <SaveFirst />}
        </TabsContent>
      </Tabs>

      {/* Always there on a phone, Save disabled with nothing to save: it never appears under a finger (issue #248). */}
      {canChangeChart ? (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t bg-background px-4 py-3 md:hidden" data-testid="mobile-save-bar" data-dirty={dirty || undefined}>
          <span className="text-sm text-muted-foreground">{dirty ? t("songEditor.unsaved") : t("songEditor.allSaved")}</span>
          <Button type="submit" className="pointer-coarse:h-11" disabled={saving || (!!edit && !dirty)}>
            {suggesting ? t("suggestions.send") : saving ? t("songEditor.saving") : t("songEditor.save")}
          </Button>
        </div>
      ) : null}

      <Dialog open={suggestOpen} onOpenChange={(open) => !saving && setSuggestOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("suggestions.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("suggestions.dialogDescription")}</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2 text-sm font-medium">
            {t("suggestions.messageLabel")}
            <Textarea value={suggestMessage} onChange={(event) => setSuggestMessage(event.target.value)} className="min-h-20 font-normal" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSuggestOpen(false)} disabled={saving}>
              {t("songEditor.cancel")}
            </Button>
            <Button type="button" onClick={() => void sendSuggestion()} disabled={saving}>
              {saving ? t("suggestions.sending") : t("suggestions.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {edit ? <ShareDialog songVersionId={edit.version.id} open={sharing} onOpenChange={setSharing} /> : null}

      <Dialog open={confirmingDelete} onOpenChange={(open) => !deleting && setConfirmingDelete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("songEditor.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("songEditor.deleteDescription", { title: edit?.version.title ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
              {t("songEditor.cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void remove()} disabled={deleting}>
              {deleting ? t("songEditor.deleting") : t("songEditor.deleteSong")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blocker.status === "blocked"} onOpenChange={(open) => !open && blocker.reset?.()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("songEditor.leaveTitle")}</DialogTitle>
            <DialogDescription>{t("songEditor.leaveDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => blocker.reset?.()}>
              {t("songEditor.keepEditing")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => blocker.proceed?.()}>
              {t("songEditor.leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

/** A star: the song in the user's favorites, or not (issue #81). */
function FavoriteButton({ songVersionId, initial }: { songVersionId: string; initial: boolean }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const label = on ? t("library.home.unfavorite") : t("library.home.favorite");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setOn(!on);
        apiClient
          .setFavorite(songVersionId, !on)
          .catch(() => setOn(on))
          .finally(() => setBusy(false));
      }}
    >
      <Star className={on ? "fill-amber-400 text-amber-500" : undefined} />
    </Button>
  );
}
