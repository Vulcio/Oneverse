import {
  ApiError,
  ISO_639_1_CODES,
  getLanguageDisplayName,
  renderChart,
  songToChordPro,
  type Attachment,
  formatDuration,
  songInfoProposals,
  type MetadataMatch,
  type MusicBrainzWorkMatch,
  type SongInfoField,
  type SongInfoProposal,
  type SongDocumentV2,
  type SongMatch,
  type SongVersionDetail,
  type SongVersionSongbookMembership,
  type Tag,
} from "@oneverse/core";
import { useBlocker, useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { PrivateMark } from "#/components/library-home";
import { DetailClash, PresenceChip, SavedElsewhere, StartedOver } from "#/components/presence";
import { sendDoc, usePresence, useSongPresence, watchSong } from "#/lib/live-notes";
import { useChartNotes } from "#/components/notes";
import { useDisplaySettings } from "#/lib/display-settings";
import { useSongNotes } from "#/lib/notes";
import { FileText, History, Info, Layers, Link2, MoreHorizontal, Music, PenLine, Share2, Star } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { OfflinePinButton } from "#/components/offline-pin-button";
import { Button } from "@oneverse/ui/components/button";
import { AddToSetButton, AddToSetPopover } from "#/components/add-to-set";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { apiClient } from "#/lib/api-client";
import { attachmentTypeFor, isPdf } from "./attachment-types";
import { RepeatsCard } from "./repeats-card";
import { ReplaceChartDialog } from "./replace-chart-dialog";
import { SongContentCard, type SourceFile } from "./song-content";
import {
  emptyForm,
  fillFrom,
  formFromVersion,
  isDirty,
  nameKeyChanges,
  songInfoFromForm,
  toCreateInput,
  toUpdateInput,
  validate,
  withContent,
  withSections,
  type SongForm,
} from "./song-form";
import { AutoDetectCard, BasicInfoCard, LibraryMatchPanel, MoreDetailsCard, SongbooksCard, SongInfoReview } from "./song-info";
import { PublishCard } from "./publish-card";
import { MySuggestionsCard } from "./my-suggestions-card";
import { LinkedSongsCard, relationKind } from "./linked-songs-card";
import { ProgressionsCard } from "./progressions-card";
import { Textarea } from "@oneverse/ui/components/textarea";
import { ArrangementsTab } from "./arrangements-tab";
import { HistoryTab } from "./history-tab";
import { ShareDialog } from "./share-dialog";
import { DeleteSongDialog } from "./delete-song-dialog";
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
  /** Opened from this songbook: new notes are saved in it by default (issue #256). */
  songbookId?: string;
  /** A note's thread to open (a notification's link). */
  openNoteId?: string;
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
/** What the room shares as it's typed (issue #27): the chart, its order and key; the rest is saved by each page. */
const ROOM_FIELDS = new Set<keyof SongForm>(["sections", "flow", "key"]);
/** The chart as text, which follows the chart: never a clash of its own. */
const CHART_TEXT_FIELDS = new Set<keyof SongForm>(["content", "contentFormat"]);

export function SongEditor(props: (CreateProps | EditProps) & { tags: Tag[]; tab: SongTab; onTabChange: (tab: SongTab) => void }) {
  const { tags, tab, onTabChange } = props;
  // Opened once, the Editor stays (hidden) while another tab shows (issue #354): typing together, the chart stays the
  // room's - live - so a save from Info or Links never sends an old one over what the others typed since.
  const [editorOpened, setEditorOpened] = useState(tab === "editor");
  useEffect(() => {
    if (tab === "editor") setEditorOpened(true);
  }, [tab]);
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
  // Typing in the song with others (issue #27): the chart is the room's, not the page's.
  const [inRoom, setInRoom] = useState(false);
  const inRoomRef = useRef(false);
  inRoomRef.current = inRoom;
  // In a room, someone else's save changed details this page changed too (issue #354): theirs, to take or leave.
  const [detailClash, setDetailClash] = useState<{ by: string | null; theirs: Partial<SongForm> } | null>(null);
  const lastSaverRef = useRef<string | null>(null);
  useEffect(() => {
    const base = baseline.current;
    baseline.current = loaded;
    setInitial(loaded);
    if (!inRoomRef.current) {
      setForm((current) => (isDirty(current, base) ? current : loaded));
      return;
    }
    // In a room, someone else's save: their details where this page didn't change them, the chart as the room has it.
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    setForm((current) => {
      const merged = { ...current };
      for (const field of Object.keys(loaded) as (keyof SongForm)[]) {
        if (!ROOM_FIELDS.has(field) && same(current[field], base[field])) (merged as Record<string, unknown>)[field] = loaded[field];
      }
      return merged;
    });
    const clash: Partial<SongForm> = {};
    for (const field of Object.keys(loaded) as (keyof SongForm)[]) {
      if (ROOM_FIELDS.has(field) || CHART_TEXT_FIELDS.has(field)) continue;
      if (!same(form[field], base[field]) && !same(loaded[field], base[field]) && !same(loaded[field], form[field])) (clash as Record<string, unknown>)[field] = loaded[field];
    }
    // Both changed it, differently: kept as typed here, and said, so neither is lost without knowing.
    setDetailClash(Object.keys(clash).length > 0 ? { by: lastSaverRef.current, theirs: clash } : null);
  }, [loaded]);

  const [showErrors, setShowErrors] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mbChoice, setMbChoice] = useState<MetadataMatch | null | undefined>(undefined);
  // Whether the chosen match's artwork becomes the song's image (issue #352).
  const [mbArtwork, setMbArtwork] = useState(true);
  // A chosen match's review, before anything is used (issue #352).
  const [review, setReview] = useState<{ match: MetadataMatch; proposals: SongInfoProposal[] } | null>(null);
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "failed">("idle");
  const [sourceFile, setSourceFile] = useState<SourceFile | null>(null);
  const [replacing, setReplacing] = useState(false);
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
  // Add to set from More, on a narrower screen (issue #330): shown by the More button.
  const moreRef = useRef<HTMLButtonElement>(null);
  const [addingToSet, setAddingToSet] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  // The phone's save bar's height, for the chord bar over it (issue #253): 0 where it's hidden.
  const saveBarRef = useRef<HTMLDivElement>(null);
  const [saveBarHeight, setSaveBarHeight] = useState(0);
  useEffect(() => {
    const header = headerRef.current;
    const saveBar = saveBarRef.current;
    const observer = new ResizeObserver(() => {
      if (header) setHeaderHeight(header.offsetHeight);
      setSaveBarHeight(saveBar?.offsetHeight ?? 0);
    });
    if (header) observer.observe(header);
    if (saveBar) observer.observe(saveBar);
    return () => observer.disconnect();
  }, [canChangeChart]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The More menu asking for the notes (issue #256), on a screen too narrow for their button.
  const [notesAsked, setNotesAsked] = useState(0);
  const leaving = useRef(false);

  const errors = showErrors ? validate(form) : {};
  const dirty = isDirty(form, initial) || mbChoice !== undefined || sourceFile !== null || basedOn !== null;

  // Live (issue #27): who else is editing the song, and saves made elsewhere - said at once, not found out on saving.
  const { session } = useRouteContext({ from: "/_protected" });
  usePresence(edit?.version.id, "editing", canEdit && !suggesting);
  const others = useSongPresence(edit?.version.id, session.userId);
  const [savedElsewhere, setSavedElsewhere] = useState<{ by: string | null; revision: number } | null>(null);
  // The room started over (a save or a Discard from elsewhere): said for a moment.
  const [startedOver, setStartedOver] = useState(false);
  useEffect(() => {
    if (!startedOver) return;
    const timer = setTimeout(() => setStartedOver(false), 8000);
    return () => clearTimeout(timer);
  }, [startedOver]);
  const revision = edit?.version.documentJson.revision ?? 0;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  // This tab saving: its own save, heard back, isn't someone else's.
  const savingRef = useRef(false);
  useEffect(() => {
    if (!edit) return;
    return watchSong(
      { songVersionId: edit.version.id },
      {
        onSaved: (saved) => {
          // In a room, a save is everyone's: the page takes the revision quietly (a save from elsewhere starts the room over).
          if (inRoomRef.current) {
            lastSaverRef.current = saved.byId === session.userId ? null : saved.by;
            // A details-only save leaves the chart's revision as it was: read the song again all the same.
            if (!savingRef.current && (saved.revision > revisionRef.current || saved.byId !== session.userId)) void router.invalidate();
            return;
          }
          if (saved.revision <= revisionRef.current || (savingRef.current && saved.byId === session.userId)) return;
          setSavedElsewhere({ by: saved.by, revision: saved.revision });
        },
      },
    );
  }, [edit?.version.id, session.userId]);
  // Loaded since: nothing to say any more.
  useEffect(() => {
    if (savedElsewhere && revision >= savedElsewhere.revision) setSavedElsewhere(null);
  }, [revision, savedElsewhere]);
  function loadTheirs() {
    if (dirty) discard();
    setSavedElsewhere(null);
    void router.invalidate();
  }

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
    if (!match) {
      setMbChoice(null);
      return;
    }
    void openReview(match);
  }

  /** Looks the chosen match up again, with all its sources know, and shows what it would fill in (issue #352). */
  async function openReview(chosen: MetadataMatch) {
    setReviewState("loading");
    setReview(null);
    try {
      const match = await apiClient.lookupMetadata(chosen);
      setReview({ match, proposals: songInfoProposals(songInfoFromForm(form, !!version?.imageUrl), match) });
      setReviewState("idle");
    } catch {
      setReviewState("failed");
    }
  }

  /** What was ticked goes into the form; the link is saved with the song. */
  function applyReview(fields: Set<SongInfoField>) {
    if (!review) return;
    const { match, proposals } = review;
    const value = (field: SongInfoField) => proposals.find((p) => p.field === field)?.proposed;
    setMbChoice(match);
    setMbArtwork(fields.has("artwork"));
    setReview(null);
    updateForm((current) => {
      const next = { ...current };
      for (const field of fields) {
        const proposed = value(field);
        if (proposed === undefined || proposed === null) continue;
        if (field === "title") next.title = String(proposed);
        else if (field === "artists") next.artists = proposed as string[];
        // The match's writers wrote words and music: they're the song's writers, in place of who it credited.
        else if (field === "writers") Object.assign(next, { writers: proposed as string[], composers: [], lyricists: [] });
        else if (field === "album" || field === "isrc") next[field] = String(proposed);
        else if (field === "year" || field === "tempo") next[field] = String(proposed);
        else if (field === "duration") next.duration = formatDuration(proposed as number);
      }
      return next;
    });
    if ([...fields].some((field) => !["title", "artists", "artwork"].includes(field))) setDetailsOpen(true);
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
    savingRef.current = true;
    setMessage(null);
    try {
      if (!edit) {
        const created = await apiClient.createSongVersion({ ...toCreateInput(current), ...(base && { basedOnVersionId: base.id }) });
        const notices: SongNotice[] = [];
        if (mbChoice) await apiClient.linkSongMetadata(created.id, mbChoice, { artwork: mbArtwork }).catch(() => notices.push("linkFailed"));
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
        let saved: SongVersionDetail;
        try {
          saved = await apiClient.updateSongVersion(edit.version.id, { ...update, revision: edit.version.documentJson.revision });
        } catch (err) {
          // In a room, someone else saved a moment before: the chart is the room's either way, so saved again over theirs.
          if (!(inRoomRef.current && err instanceof ApiError && err.status === 409)) throw err;
          const fresh = await apiClient.getSongVersion(edit.version.id);
          saved = await apiClient.updateSongVersion(edit.version.id, { ...update, revision: fresh.documentJson.revision });
        }
        // The room is at this revision: the save isn't one from elsewhere.
        if (inRoomRef.current) sendDoc({ type: "doc-saved", songVersionId: edit.version.id, revision: saved.documentJson.revision });
      }
      // Saved: edits made from here on are new ones, kept when the song reloads.
      baseline.current = current;
      if (mbChoice) await apiClient.linkSongMetadata(edit.version.id, mbChoice, { artwork: mbArtwork });
      else if (mbChoice === null) await apiClient.unlinkSongMetadata(edit.version.id);
      setMbChoice(undefined);
      await keepSourceFile(edit.version.id);
      setSourceFile(null);
      setShowErrors(false);
      await router.invalidate();
      setMessage({ kind: "ok", text: t("songEditor.saved") });
    } catch (err) {
      // Saved somewhere else since it was opened (issue #27): load theirs, or keep editing.
      if (err instanceof ApiError && err.status === 409) setSavedElsewhere({ by: null, revision: revisionRef.current + 1 });
      else setMessage({ kind: "error", text: err instanceof Error && err.message ? err.message : t("songEditor.saveFailed") });
    } finally {
      setSaving(false);
      savingRef.current = false;
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

  /** Discard: in a room, what nobody saved goes for everyone (each loads the song again). */
  function discardChanges() {
    if (inRoom && edit) sendDoc({ type: "doc-discard", songVersionId: edit.version.id });
    discard();
  }

  function discard() {
    setForm(initial);
    setMbChoice(undefined);
    setReview(null);
    setSourceFile(null);
    setShowErrors(false);
    setMessage(null);
  }

  /** In the bin (issue #340): off to the Bin, where it can be put back. */
  async function binned() {
    leaving.current = true;
    await navigate({ to: "/library/bin" });
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
            autoSearch={!edit}
            review={
              review ? (
                <SongInfoReview match={review.match} proposals={review.proposals} onApply={applyReview} onCancel={() => setReview(null)} />
              ) : reviewState === "loading" ? (
                <p className="text-sm text-muted-foreground" role="status">
                  {t("songEditor.infoLookingUp")}
                </p>
              ) : null
            }
            note={
              reviewState === "failed" ? (
                <p className="text-sm text-destructive" role="alert">
                  {t("songEditor.infoLookupFailed")}
                </p>
              ) : null
            }
          />
        ) : null}
        <MoreDetailsCard form={form} setField={setField} errors={errors} tags={tags} open={detailsOpen} onOpenChange={setDetailsOpen} />
      </fieldset>
      <div className="flex min-w-0 flex-col gap-6">
        {edit ? <ArtworkCard version={edit.version} canEdit={canEdit} /> : null}
        {/* For a new song; a song that exists has its chart replaced from the Editor (issue #254). */}
        {canChangeChart && !edit ? (
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
        // Shared with them by its owner (#77), or with one of their teams (#331).
        edit.version.sharedBy?.organization
          ? t("sharing.sharedWithOrganization", { name: edit.version.sharedBy.displayName, organization: edit.version.sharedBy.organization.name })
          : edit.version.sharedBy?.team
          ? t(edit.version.sharedBy.canEdit ? "sharing.sharedWithTeamEdit" : "sharing.sharedWithTeamView", { name: edit.version.sharedBy.displayName, team: edit.version.sharedBy.team.name })
          : edit.version.sharedBy
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
      style={{ "--song-header-h": `${headerHeight}px`, "--save-bar-h": `${saveBarHeight}px` } as CSSProperties}
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
            {edit?.version.private ? <PrivateMark className="text-muted-foreground" iconClassName="size-4" /> : null}
            {edit?.version.versionName ? (
              <span className="rounded-full border px-2.5 py-0.5 text-sm font-medium text-muted-foreground">{edit.version.versionName}</span>
            ) : null}
          </h1>
          {/* Beside the subtitle, not on a row of its own: the header stays short (issue #248). */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-muted-foreground">{subheading}</p>
            {edit ? <OfflinePinButton kind="SONG" targetId={edit.version.id} /> : null}
            <PresenceChip people={others} doing="editing" />
          </div>
        </div>
        </div>
        {/* One row of actions that wraps as a whole, never leaving a button alone on a line. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {edit ? <EditorNotes version={edit.version} songbookId={edit.songbookId} openNoteId={edit.openNoteId} openSignal={notesAsked} /> : null}
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
                <Button type="button" variant="outline" onClick={discardChanges} disabled={!dirty || saving}>
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
          {/* Into one of one's sets (issue #330): a button of its own on a wide screen, in More on a narrower one. */}
          {edit ? <AddToSetButton songVersionId={edit.version.id} songTitle={edit.version.title} className="hidden xl:inline-flex" /> : null}
          {edit && canManage && edit.version.ownerScope !== "GLOBAL" ? (
            <Button type="button" variant="outline" onClick={() => setSharing(true)} aria-label={t("sharing.share")}>
              <Share2 />
              {/* Just the icon until there is room, so the header's actions stay on one row. */}
              <span className="hidden xl:inline">{t("sharing.share")}</span>
            </Button>
          ) : null}
          {edit ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button ref={moreRef} type="button" variant="ghost" size="icon" aria-label={t("songEditor.moreActions")} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportChordPro}>{t("songEditor.exportChordPro")}</DropdownMenuItem>
                <DropdownMenuItem className="xl:hidden" onClick={() => setAddingToSet(true)} data-testid="menu-add-to-set">
                  {t("sets.addToSet.button")}…
                </DropdownMenuItem>
                {/* Notes (issue #256): a button of its own on a wide screen, here on a narrower one. */}
                {edit ? (
                  <DropdownMenuItem className="xl:hidden" onClick={() => setNotesAsked((n) => n + 1)} data-testid="menu-notes">
                    {t("songNotes.all")}
                  </DropdownMenuItem>
                ) : null}
                {/* A team's share is the team's, not theirs to leave. */}
                {edit.version.sharedBy && !edit.version.sharedBy.team && !edit.version.sharedBy.organization ? (
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
          {edit ? (
            <AddToSetPopover songVersionId={edit.version.id} songTitle={edit.version.title} open={addingToSet} onOpenChange={setAddingToSet} anchor={moreRef} />
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
        <TabsContent value="editor" keepMounted={editorOpened && inRoom}>
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
                onReplaceChart={() => setReplacing(true)}
                onFactChange={(field, value) => setField(field, value)}
                readOnly={!canChangeChart}
                shared={
                  edit && canEdit && !suggesting
                    ? {
                        songVersionId: edit.version.id,
                        me: { name: session.displayName, color: caretColor(session.userId) },
                        loadSaved: async () => {
                          const saved = await apiClient.getSongVersion(edit.version.id);
                          const form = formFromVersion(saved);
                          return { revision: saved.documentJson.revision, sections: form.sections, flow: form.flow, key: form.key };
                        },
                        onNewer: () => void router.invalidate(),
                        onReset: () => {
                          discard();
                          setSavedElsewhere(null);
                          void router.invalidate();
                          setStartedOver(true);
                        },
                        onRoomChange: setInRoom,
                      }
                    : undefined
                }
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
        <div ref={saveBarRef} className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t bg-background px-4 py-3 md:hidden" data-testid="mobile-save-bar" data-dirty={dirty || undefined}>
          <span className="text-sm text-muted-foreground">{dirty ? t("songEditor.unsaved") : t("songEditor.allSaved")}</span>
          <Button type="submit" className="pointer-coarse:h-11" disabled={saving || (!!edit && !dirty)}>
            {suggesting ? t("suggestions.send") : saving ? t("songEditor.saving") : t("songEditor.save")}
          </Button>
        </div>
      ) : null}

      <ReplaceChartDialog
        open={replacing}
        onOpenChange={setReplacing}
        onReplace={(content, format, file) => {
          updateForm((current) => withContent(current, content, format));
          if (file) setSourceFile(file);
        }}
      />

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

      {edit ? (
        <ShareDialog
          songVersionId={edit.version.id}
          songTitle={edit.version.title}
          personal={edit.version.ownerScope === "USER"}
          ownerTeamId={edit.version.ownerTeamId}
          open={sharing}
          onOpenChange={setSharing}
          onMoved={() => void router.invalidate()}
        />
      ) : null}
      {startedOver ? <StartedOver onDismiss={() => setStartedOver(false)} /> : null}
      {detailClash ? (
        <DetailClash
          by={detailClash.by}
          fields={Object.keys(detailClash.theirs).map((field) => t(`songEditor.fields.${field === "tagIds" ? "tags" : field}`))}
          onKeepMine={() => setDetailClash(null)}
          onUseTheirs={() => {
            setForm((current) => ({ ...current, ...detailClash.theirs }));
            setDetailClash(null);
          }}
        />
      ) : null}
      {savedElsewhere ? <SavedElsewhere by={savedElsewhere.by} dirty={dirty} onLoad={loadTheirs} onDismiss={() => setSavedElsewhere(null)} /> : null}

      {edit ? (
        <DeleteSongDialog
          songVersionId={edit.version.id}
          title={edit.version.title}
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          onBinned={binned}
          onGiven={async (text) => {
            setMessage({ kind: "ok", text });
            await router.invalidate();
          }}
        />
      ) : null}

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

/** The song's notes in Edit (issue #256): every note one sees, to read, reply to and add to the song or a part of it from the list. */
function EditorNotes({ version, songbookId, openNoteId, openSignal }: { version: SongVersionDetail; songbookId?: string; openNoteId?: string; /** Goes up when the More menu asks for the notes. */ openSignal: number }) {
  const display = useDisplaySettings("EDIT");
  const chart = useMemo(() => renderChart(version.documentJson), [version.documentJson]);
  const context = { songVersionId: version.id, songbookId };
  const notes = useChartNotes({ state: useSongNotes(context), chart, document: version.documentJson, show: display.notes, marks: display.noteMarks, style: display.noteStyle, context, openNoteId });
  const { openList } = notes;
  useEffect(() => {
    if (openSignal > 0) openList();
    // Only when asked again.
  }, [openSignal]);
  return (
    <>
      {/* On a narrower screen the header has no room: More actions has it. */}
      <span className="hidden xl:contents">{notes.button}</span>
      {notes.dialogs}
    </>
  );
}

/** One's caret's colour, the same on every device (issue #27). */
function caretColor(userId: string): string {
  const colors = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777", "#65a30d"];
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length]!;
}
