import "../zod-config.js";
import type {
  CapoDisplayModeValue,
  ChordNotationValue,
  ChordDiagramsValue,
  DisplayColumnsValue,
  DisplayFontValue,
  ControlsLayoutValue,
  DiagramPositionValue,
  ChordRowFontValue,
  ChordRowNamesValue,
  ChordRowWeightValue,
  ControlsPositionValue,
  LiveControlValue,
  AppModeValue,
  DisplaySpacingValue,
  LiveViewValue,
  SetTransitionValue,
  SetlistItemKind,
  TechRoleValue,
} from "../constants/index.js";
import type { ArrangementDocumentV2, ChartPreferences } from "../schemas/arrangement-document-v2.js";
import type { CatalogEntryData, CatalogEntryFieldKey, CatalogFileProblem } from "../songbook-catalog-format/index.js";
import type { BulkUploadFileMatch } from "../bulk-upload-matching/index.js";
import type { MetadataCapability, MetadataMatch, MetadataProviderKey } from "../schemas/metadata.js";
import type { MusicBrainzWorkMatch } from "../schemas/musicbrainz.js";
import type { SectionInstance, SectionV2, SongDocumentV2 } from "../schemas/song-document-v2.js";
import type { SongbookSection } from "../songbook-sections/index.js";
import type { StemPart } from "../stems/index.js";
import type { NewNotes, NoteAnchor, NoteColor, NoteLook, NotePlace, NotePlacement, NoteShow, NoteSize } from "../notes/index.js";
import type { NotificationData, NotificationKind, NotificationPreferences, QuietHours } from "../notifications/index.js";
import type { LyricsMatch } from "../search-text/lyrics.js";
import type { SecondChordRow } from "../display/chord-rows.js";
import type { SectionProgression } from "../chords/progressions.js";
import type { CuePoint } from "../recording/cues.js";
import type { BrandAssetKind, BrandContent } from "../brands/index.js";
import type { CreateBrandRequest, UpdateBrandRequest } from "../requests/brands.js";
import type { z } from "zod";
import type { BibleUpdateSchema } from "../requests/scriptures.js";
import type { BibleSourceFormat } from "../scriptures/bible.js";
import type { PassageChapter } from "../scriptures/references.js";
import type { SaveCollaborationSettingsRequest, SaveSecuritySettingsRequest, SaveStorageLimitsRequest, UpdateTeamRequest } from "../requests/accounts.js";
import type { CreateGroupRequest, CreateOrganizationRequest, OrganizationMode, SaveOrganizationSettingsRequest, UpdateGroupRequest, UpdateOrganizationRequest } from "../requests/organizations.js";
import type { CreateSignupInvitationRequest } from "../requests/invitations.js";
import type { CreatePushSubscriptionRequest, SaveNotificationServerSettingsRequest, UpdateNotificationPreferencesRequest } from "../requests/notifications.js";
import type { AddSetlistItemSchema, SetlistItemText, UpdateSetlistItemRequest } from "../requests/sets.js";
import type { CreateNoteRequest, UpdateNoteRequest } from "../requests/notes.js";
import type { AnswerEventDateRequest, AssignPartRequest, CreateAnswerRequestRequest, RequestSwapRequest, RespondAssignmentRequest, CreateAwayRequest, UpdateAwayRequest, CreateTeamEventRequest, UpdateTeamEventDateRequest, UpdateTeamEventRequest, CreateOrganizationEventRequest, UpdateOrganizationEventRequest, OrganizationEventPresetRequest } from "../requests/events.js";
import type { AssignmentStatus, AvailabilityAnswer, EventDate, EventPart, EventRepeat, PartCoverage } from "../calendar/index.js";
import type { SaveSonicServerRequest, SaveStemSeparationSettingsRequest, StemSeparationParts } from "../requests/stem-separation.js";
import type { AssignRolesRequest, CreateInstrumentRequest, CreateRoleRequest, UpdateInstrumentRequest, UpdateRoleRequest } from "../requests/roles.js";
import type { AttachmentTypeValue, SaveFileSizeLimitsRequest } from "../requests/files.js";
import type { ConfirmScreenPairingRequest, CreateScreenPartRequest, CreateScreenThemeRequest, SaveScreenWidgetDefaultRequest, UpdateScreenPartRequest, UpdateScreenRequest, UpdateScreenThemeRequest } from "../requests/screens.js";
import type { ScreenSwitchableLayer, ScreenTheme, ScreenWidgetKind, ScreenWidgetLook } from "../screens/theme.js";
import type { ScreenBackgroundTheme, ScreenContentTheme, ScreenEffects, ScreenPartKind, ScreenTemplateLayout } from "../screens/parts.js";
import type { ScreenMode } from "../screens/index.js";
import type { ScreenReport, ScreenTier } from "../screens/reports.js";
import type {
  CreateCatalogSchema,
  CreateInviteLinkSchema,
  ImportSongbookFromCatalogSchema,
  SaveAuthConfigSchema,
  SaveStorageConfigSchema,
  UpdateCatalogSchema,
  UpdateUserByAdminSchema,
} from "../requests/index.js";
import type { CreateSongbookRequest, UpdateSongbookRequest } from "../requests/songbooks.js";
import type { CreateSongVersionRequest, LinkRepeatsRequest, RepeatsBackfillRequest, SongSort, UpdateSongVersionRequest } from "../requests/songs.js";
import type { SongChange, SongSnapshot } from "../song-history/index.js";

export interface ApiClientOptions {
  baseUrl: string;
  /** Resolves the current bearer token, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Called when the API answers 401, e.g. so a cached token isn't reused. */
  onUnauthorized?: () => void;
  /** Called after any request that changes something succeeds, e.g. so cached reads are refetched. */
  onChange?: () => void;
  /** The message for a request refused as one too many (429, issue #113), in the reader's language. */
  rateLimitedMessage?: () => string | undefined;
}

export interface AdminCommandResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  isGlobalAdmin: boolean;
  /** From their roles, or their teams'. */
  isReviewer: boolean;
  /** Their own roles (issue #160). */
  roles: { id: string; name: string }[];
  /** The roles their teams give them. */
  teamRoles: { id: string; name: string; teamName: string }[];
  createdAt: string;
  bannedAt: string | null;
  banReason: string | null;
  /** Set while the account awaits a content transfer. */
  deletedAt: string | null;
  transferExpiresAt: string | null;
  usedBytes: number;
  /** Null means unlimited (global admins). */
  limitBytes: number | null;
  teamCount: number;
  songCount: number;
}

export type UpdateUserByAdminInput = z.input<typeof UpdateUserByAdminSchema>;

export interface TransferLink {
  transferUrl: string;
  expiresAt: string;
}

export interface TransferPreview {
  fromDisplayName: string;
  expiresAt: string;
  songCount: number;
  arrangementCount: number;
  songbookCount: number;
  tagCount: number;
  setCount: number;
  storageBytes: number;
}

export interface StorageLimits {
  defaultLimitMb: number;
  isBuiltIn: boolean;
  builtInDefaultMb: number;
  /** A team's pool when no role sets one (issue #160). */
  defaultTeamLimitMb: number;
  teamIsBuiltIn: boolean;
  builtInTeamDefaultMb: number;
}

export interface StorageUsage {
  usedBytes: number;
  /** Null means unlimited. */
  limitBytes: number | null;
}

export interface SetlistSongRef {
  id: string;
  title: string;
  /** Tells this version apart from the song's others, e.g. "Acoustic". */
  versionName: string | null;
  workId: string;
  /** The song's own key as written on it, if any. */
  key: string | null;
  ownerScope: "GLOBAL" | "TEAM" | "USER";
  teamName: string | null;
  /** Its artists' names (issue #68); missing from copies kept offline before then. */
  artists?: string[];
  /** From its chart (issue #199); missing from copies kept offline before then. */
  tempo?: number | null;
  timeSignature?: { numerator: number; denominator: number } | null;
  durationSeconds?: number | null;
}

export interface SetlistSummary {
  id: string;
  /** Null when the set is shown by its date (or as untitled). */
  name: string | null;
  /** YYYY-MM-DD */
  eventDate: string | null;
  /** Null for a personal set. */
  teamId: string | null;
  teamName: string | null;
  /** Whose personal set it is; null for a team set. */
  ownerName: string | null;
  itemCount: number;
  canEdit: boolean;
  /** Shared with the current user by link, rather than theirs or their team's. */
  isGuest: boolean;
  /** Made for a date of its team's calendar (issue #235): shown as its name and date, "Morning service - 12 Oct". Left out by older offline copies. */
  fromEvent?: boolean;
  /** For an event's set: the viewer signed up for its date (answered Available). */
  signedUp?: boolean;
  /** For an event's set: its date is over, in the team's time zone. */
  past?: boolean;
}

export interface SetlistItem {
  id: string;
  /** What it is (issue #305): left out by an older API, a song. A kind this client doesn't know is shown as a placeholder. */
  kind?: SetlistItemKind;
  /** A text item's title and body, its paragraphs its slides (textSlides); null or left out for a song. */
  text?: SetlistItemText | null;
  position: number;
  /** Semitones relative to the song's own key. */
  transposeSteps: number;
  notes: string | null;
  /** What happens after it (issue #199); null: nothing said. Missing from copies kept offline before then. */
  transition?: SetTransitionValue | null;
  transitionNote?: string | null;
  /** The chords played into the next song (issue #10), as degrees of its key. */
  transitionChords?: string[];
  /** Its own timer (issue #269), started on the screens' stage when Live comes to it; left out by an older API. */
  timer?: { kind: "countdown" | "count-up"; duration: number } | null;
  /** Its first and last chords as played (issue #217); null when the viewer can't read it. */
  edgeChords?: { first: string | null; last: string | null } | null;
  /** Null when the song isn't readable by the current user (shown as a placeholder), and for an item that isn't a song. */
  song: SetlistSongRef | null;
  /** Also in the current user's own library, i.e. openable outside the set. */
  inLibrary: boolean;
  /** Someone's personal song shared into this (team) set by them, read-only. */
  sharedBy: { id: string; displayName: string } | null;
  /** The set's team has asked for this song; `canDecide` when it's the current user's. */
  ownershipRequest: { id: string; canDecide: boolean } | null;
  /** A team admin can ask for this shared song (or, owning it, hand it over). */
  canRequestOwnership: boolean;
  /** Where the song is in the viewer's numbered songbooks: "JEM 855 · JEM3" (issue #55). */
  songbookReferences: string[];
  /** Versions of the same song this item can switch to (editors only). */
  versions: SetlistSongRef[];
  /** The arrangement it's played in (and the semitones it moves the song's key); null plays the song as written. */
  arrangement: { id: string; name: string; transposeSteps: number; setOnly: boolean } | null;
  /** The arrangements this set could play for it (editors only); `setOnly` is its own for this set. */
  arrangements: { id: string; name: string; isTeamDefault: boolean; setOnly: boolean }[];
}

export interface SetlistDetail extends SetlistSummary {
  items: SetlistItem[];
}

/** One song of a set, as anyone who can open the set sees it. */
/** A set song's transition into the next (issue #199). */
export interface SetTransitionView {
  kind: SetTransitionValue;
  note: string | null;
  /** The chords played into the next song (issue #10), as degrees of its key: spell them with degreeChords(chords, toKey). */
  chords?: string[];
  fromKey: string | null;
  toKey: string | null;
  fromTempo: number | null;
  toTempo: number | null;
  /** The song's last chord and the next one's first, as played (issue #217): where the transition goes from and to. */
  lastChord?: string | null;
  firstChord?: string | null;
}

export interface SetlistSongView {
  set: SetlistSummary;
  item: { id: string; position: number; transposeSteps: number; notes: string | null; arrangementId: string | null; kind?: SetlistItemKind };
  /** A text item's title and body (issue #305); null or left out for a song. */
  text?: SetlistItemText | null;
  /** What happens after it (issue #199), with the keys and tempos either side as played; null: nothing said. */
  transition?: SetTransitionView | null;
  song:
    | (SetlistSongRef & {
        tempo: number | null;
        sections: SectionV2[];
        flow: SectionInstance[];
        /** The whole document, for renderChart(). */
        document: SongDocumentV2;
        /** A capo written on the song: a suggestion when the arrangement sets none. */
        suggestedCapo: number | null;
      })
    | null;
  /** The arrangement the set plays it in (null: as written). */
  arrangement: { id: string; name: string; document: ArrangementDocumentV2 } | null;
  /** How the current user reads it. */
  view: ChartViewSettings;
  inLibrary: boolean;
  sharedBy: { id: string; displayName: string } | null;
  previousItemId: string | null;
  nextItemId: string | null;
  /** Where the song is in the viewer's numbered songbooks: "JEM 855 · JEM3" (issue #59). */
  songbookReferences: string[];
  /** The next item's title (a song's, or a text's); null at the end of the set, or when the viewer can't read that song. */
  nextTitle: string | null;
  /** The current user's private note on this song of the set. */
}

/** A set to keep offline (GET /setlists/:id/offline): the set, and each of its songs as the song view gives it. */
export interface SetlistOfflineCopy {
  set: SetlistDetail;
  songs: SetlistSongView[];
  /** The notes one sees on each of its songs in this set (issue #256), by song. */
  notes: Record<string, SongNotes>;
  /** Changes whenever anything in the copy would. */
  version: string;
}

/** A song to keep offline (issue #52): its details, its files' list, and a version. */
export interface SongOfflineCopy {
  song: SongVersionDetail;
  attachments: Attachment[];
  /** The notes one sees on it, outside any set (issue #256). */
  notes: SongNotes;
  version: string;
}

/** A songbook to keep offline (issue #52): its entries, and a version. */
export interface SongbookOfflineCopy {
  songbook: SongbookDetail;
  version: string;
}

/** A songbook entry found by reference ("HY 42"), for search (issue #48). */
export interface SongbookEntryHit {
  songbookId: string;
  songbookName: string;
  abbreviation: string | null;
  entryCode: string;
  /** The printed volume, when the songbook has sections. */
  sectionLabel: string | null;
  songVersionId: string;
  title: string;
  /** How its number answers the search (issue #213): exactly, starting with it, or containing it. */
  match?: "exact" | "prefix" | "contains";
}

export type OfflinePinKind = "SET" | "SONG" | "SONGBOOK";

/** Something the user keeps offline on every device ("Available offline", "Keep a local copy"). */
export interface OfflinePin {
  kind: OfflinePinKind;
  targetId: string;
  includeAudio: boolean;
  createdAt: string;
}

/** POST /offline/sync (issues #51, #52): what a device should keep offline now. */
export interface OfflineSyncResponse {
  days: number;
  /** The sets dated from yesterday to `days` ahead. */
  upcoming: string[];
  /** Upcoming, pinned and known sets still visible; `copy` only when the device's version is out of date. */
  sets: { id: string; version: string; copy?: SetlistOfflineCopy }[];
  /** Known sets deleted, or no longer visible: remove them. */
  gone: string[];
  /** Pinned songbooks. */
  songbooks: { id: string; version: string; copy?: SongbookOfflineCopy }[];
  goneSongbooks: string[];
  /**
   * The user's own songs, pinned ones, and those in kept sets and songbooks;
   * `audio`: download their audio files too. `pending`: out of date on the
   * device but not in this answer (it carries so many copies at most, issue
   * #122) - fetch it with POST /offline/songs.
   */
  songs: { id: string; version: string; audio: boolean; copy?: SongOfflineCopy; pending?: true }[];
  goneSongs: string[];
  pins: OfflinePin[];
  /** The user's chord settings, for songs shown on their own. */
  viewer: {
    chordNotation: ChordNotationValue;
    capoDisplayMode: CapoDisplayModeValue;
    liveView?: LiveViewValue;
    chordDiagrams?: ChordDiagramsValue;
    chordColors?: boolean;
    /** Each mode's display settings (issue #209), for offline. */
    displaySettings?: Partial<Record<AppModeValue, DisplaySettings>>;
  } & DiagramPlayer;
}

/**
 * POST /offline/sync with a `fingerprint` (issue #121): whether what the
 * device keeps is still what it should keep. Unchanged, it carries only
 * the small settings; changed, the device syncs with its lists.
 */
export type OfflineSyncCheck =
  | ({ unchanged: true } & Pick<OfflineSyncResponse, "days" | "upcoming" | "pins" | "viewer">)
  | { unchanged: false };

/** The shape a player chose for a chord of a song (issue #207): theirs only, per instrument and tuning; `frets` as players write it ("320003"). */
export interface ChordShapeChoice {
  instrument: "guitar" | "ukulele" | "piano";
  tuning: string;
  chord: string;
  frets: string;
}

/** A player's own way of reading charts: this chart's preferences, and their settings for every chart. */
export interface ChartViewSettings {
  preferences: ChartPreferences | null;
  chordNotation: ChordNotationValue;
  capoDisplayMode: CapoDisplayModeValue;
  /** How songs read in Live unless chosen for this one (issue #155); left out by an older copy kept offline. */
  liveView?: LiveViewValue;
  /** Chord diagrams beside the chart (issue #207); left out by an older copy kept offline. */
  chordDiagrams?: ChordDiagramsValue;
  /** Chords coloured by family (issue #9); left out by an older copy kept offline. */
  chordColors?: boolean;
  /** Left-handed diagrams and tunings (issue #207); left out by an older copy kept offline. */
  leftHanded?: boolean;
  guitarTuning?: string;
  ukuleleTuning?: string;
  pianoSmooth?: boolean;
  pianoHands?: string;
  pianoNoteNames?: string;
  /** Each mode's display settings (issue #209). Missing from copies kept offline before then. */
  displaySettings?: Partial<Record<AppModeValue, DisplaySettings>>;
}

/** How a player's diagrams are drawn (issue #207 phases 3 and 4): mirrored, in which tunings, and the piano's options. */
export interface DiagramPlayer {
  leftHanded?: boolean;
  guitarTuning?: string;
  ukuleleTuning?: string;
  /** Each chord's inversion nearest the one before (default), or root position. */
  pianoSmooth?: boolean;
  /** "both" hands (default) or "right" only. */
  pianoHands?: string;
  /** Note names on the keys: "card" (default), "all" or "none". */
  pianoNoteNames?: string;
}

/** An arrangement of a song, as listed (docs/arrangement-document-v2.md). */
export interface ArrangementSummary {
  id: string;
  songVersionId: string;
  name: string;
  description: string | null;
  ownerScope: "USER" | "TEAM" | "GLOBAL";
  teamId: string | null;
  teamName: string | null;
  ownerName: string | null;
  isTeamDefault: boolean;
  /** Set when it's one song's own arrangement for one set: that set's id. */
  setlistId: string | null;
  /** The key it's played in, when the song has one. */
  key: string | null;
  transposeSteps: number;
  capo: number | null;
  /** The song changed since the arrangement was last checked against it. */
  needsReview: boolean;
  canEdit: boolean;
  updatedAt: string;
}

export interface ArrangementDetail extends ArrangementSummary {
  document: ArrangementDocumentV2;
  song: { revision: number; key: string | null };
  /** References to the song that no longer match (deleted lines or chords). */
  problems: string[];
}

export interface SetlistGuest {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  joinedAt: string;
}

export interface SetlistSharing {
  link: { token: string; createdAt: string } | null;
  guests: SetlistGuest[];
}

export interface SetInvitePreview {
  name: string | null;
  eventDate: string | null;
  teamName: string | null;
  ownerName: string | null;
  fromEvent?: boolean;
  itemCount: number;
}

export interface SongOwnershipRequest {
  id: string;
  createdAt: string;
  song: { id: string; title: string };
  team: { id: string; name: string };
  requestedByName: string | null;
  setlistId: string | null;
  /** When false, handing the song over means losing access to it. */
  ownerIsTeamMember: boolean;
}

/** One mode's display settings (issue #209): only what it changes; the rest comes from the account's. */
export interface DisplaySettings {
  textSize?: number;
  /** The chords' own size (issue #225); left out, the same as the lyrics'. */
  chordSize?: number;
  font?: DisplayFontValue;
  spacing?: DisplaySpacingValue;
  columns?: DisplayColumnsValue;
  /** The main row's names (issue #230): a notation, or a diagram on each chord. */
  chordNotation?: ChordRowNamesValue;
  chordColors?: boolean;
  /** The main row's look (issue #230). */
  chordFont?: ChordRowFontValue;
  chordWeight?: ChordRowWeightValue;
  chordColor?: string;
  /** A second row of chords (issue #230). */
  secondRow?: (Partial<SecondChordRow> & { on?: boolean }) | null;
  capoDisplayMode?: CapoDisplayModeValue;
  chordDiagrams?: ChordDiagramsValue;
  /** Where the diagrams sit (issue #212). */
  diagramsPosition?: DiagramPositionValue;
  hideChords?: boolean;
  /** The bars row at the top (issue #238): the chords in bars and beats, following the music. */
  bars?: boolean;
  /** Live's controls (issue #224). */
  controls?: ControlsLayoutValue;
  controlsPosition?: ControlsPositionValue;
  hiddenControls?: LiveControlValue[];
  controlsOpacity?: number;
  /** Notes on the chart (issue #256). */
  notes?: NoteShow;
  /** What a note is on, marked on the chart (issue #263). */
  noteMarks?: boolean;
  /** Someone else's new notes: at once, or on a tap (issue #263). */
  newNotes?: NewNotes;
  /** Where notes go, and how they look (issue #264). */
  notesPlacement?: NotePlacement;
  notesLook?: NoteLook;
  notesSize?: NoteSize;
  notesColor?: NoteColor;
}

/** Someone who wrote a note or a reply (issue #256). */
export interface NoteAuthor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface SongNoteReply {
  id: string;
  content: string;
  author: NoteAuthor;
  createdAt: string;
  updatedAt: string;
  /** Its author, or a moderator of the note's place. */
  canEdit: boolean;
}

/** A note on a song (issue #256): where it's saved decides who sees it. */
export interface SongNote {
  id: string;
  songVersionId: string;
  content: string;
  place: NotePlace;
  /** The team, songbook or set it's saved in; for ME, the set it only shows in, if any. */
  placeId: string | null;
  /** That team's, songbook's or set's name ("Morning Band", "Sunday service"). */
  placeName: string | null;
  /** Where it's pinned, as the song is now. */
  anchor: NoteAnchor;
  /** What it was pinned to is gone: it moved up (to its line, section, or the song). */
  moved: boolean;
  author: NoteAuthor;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  replies: SongNoteReply[];
  /** Its author, or a moderator of its place (a team's or songbook's admins, a set's leaders, the song's editors): edit, resolve, delete. */
  canEdit: boolean;
  /** Anyone who sees it may reply. */
  canReply: boolean;
}

/** A place one may save a note in, from where the song was opened. */
export interface NotePlaceChoice {
  place: NotePlace;
  /** The team, songbook or set; null for ME and SONG. */
  id: string | null;
  name: string | null;
}

export interface SongNotes {
  notes: SongNote[];
  /** Where a new note may go; the first is the default (where one came from). */
  places: NotePlaceChoice[];
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  isGlobalAdmin: boolean;
  /** From their roles, or their teams' (issue #160). */
  isReviewer: boolean;
  canSeparateStems: boolean;
  /** May upload audio files (issue #183): a role's, or a global admin. */
  canUploadAudio: boolean;
  /** Their roles' names, their own and their teams'. */
  roles: string[];
  permissions: string[];
  /** Built-in instruments' keys, then the ids of those an admin added (issue #166). */
  instruments: string[];
  techRoles: TechRoleValue[];
  /** With a capo: chords as they sound, or the shapes a guitarist plays. */
  capoDisplayMode: CapoDisplayModeValue;
  /** Chord names in letters or solfège. */
  chordNotation: ChordNotationValue;
  /** How songs read in Live unless chosen for a song (issue #155). */
  liveView: LiveViewValue;
  /** Chord diagrams beside every chart (issue #207). */
  chordDiagrams: ChordDiagramsValue;
  /** Chords coloured by family (issue #9). */
  chordColors: boolean;
  /** Chord diagrams mirrored for a left-handed player, and each instrument's tuning (issue #207). */
  leftHanded: boolean;
  /** Calendars' first day of the week (issue #235): 0 Sunday, 1 Monday, 6 Saturday; null from the language. */
  weekStartsOn: 0 | 1 | 6 | null;
  guitarTuning: string;
  ukuleleTuning: string;
  /** Piano diagrams' options (issue #207 phase 4). */
  pianoSmooth: boolean;
  pianoHands: string;
  pianoNoteNames: string;
  /** What the Display panel changed for each mode (issue #209): over the account's settings above. */
  displaySettings?: Partial<Record<AppModeValue, DisplaySettings>>;
}

export type StorageConfigSource = "database" | "env" | "none";

/** A recording split into stems (issue #63), as the song's Audio tab shows it. */
export interface StemSeparation {
  id: string;
  sourceAttachmentId: string;
  parts: StemSeparationParts;
  status: "QUEUED" | "SUBMITTED" | "FAST_READY" | "COMPLETED" | "FAILED";
  hqRequested: boolean;
  hqDone: boolean;
  /** The models it was sent with (issue #175): the quick pass's, and the finer pass's (null without one); null for one sent before they were kept. */
  fastModel: string | null;
  hqModel: string | null;
  /** The recording's name, kept after it's deleted. */
  sourceFilename: string | null;
  multitrackId: string | null;
  /** The earlier separation's multitrack it replaces (issue #175), once its stems are in. */
  replacesMultitrackId: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
}

export interface StemSeparations {
  /** Whether the viewer may split this song's recordings; `refusal` says why not. */
  available: boolean;
  refusal: "not-configured" | "not-granted" | null;
  /** Whose Sonic server it goes to (issue #300): the song's team's or its organisation's; null for the instance's. */
  server: { kind: "team" | "organization"; name: string } | null;
  separations: StemSeparation[];
}

/** Admin > Stem separation (issue #63). */
export interface StemSeparationSummary {
  source: "database" | "env" | "none";
  apiUrl: string | null;
  hasDatabaseKey: boolean;
  hasKey: boolean;
  fastModel: string;
  hqModel: string;
  hqEnabled: boolean;
  monthlyLimit: number | null;
  signedCallbacks: boolean;
  /** Whether the instance has its own server: optional, teams and organisations may run theirs (issue #300). */
  configured: boolean;
  /** Teams and organisations may connect their own Sonic servers, and on private or local addresses. */
  ownServers: boolean;
  ownServersPrivate: boolean;
}

export type StemSeparationTest =
  | {
      ok: true;
      health: Record<string, unknown>;
      models: { models: string[]; default: string; hq_default: string; devices: string[]; default_device: string };
      /** Its API's version (Sonic 1.6 and later say it), and whether it finds beats and bars (1.5 and later); null when it doesn't say. */
      version: string | null;
      beats: boolean | null;
    }
  | { ok: false; error: string };

/** A team's or an organisation's own Sonic server (issue #300), as its admins see it: never its key. */
export interface SonicServerSummary {
  /** Whether Admin lets teams and organisations connect their own, and on private or local addresses. */
  allowed: boolean;
  allowPrivate: boolean;
  server: { apiUrl: string; hasKey: boolean; fastModel: string | null; hqModel: string | null; hqEnabled: boolean; monthlyLimit: number | null; updatedAt: string } | null;
}

/** Admin > Stem separation's list of the servers teams and organisations connected. */
export interface ConnectedSonicServer {
  id: string;
  owner: { kind: "team" | "organization"; id: string; name: string };
  apiUrl: string;
  separations: number;
  updatedAt: string;
}

export type SonicServerOwnerRef = { teamId: string } | { organizationId: string };
const sonicServerPath = (owner: SonicServerOwnerRef) => ("teamId" in owner ? `/teams/${owner.teamId}/sonic-server` : `/organizations/${owner.organizationId}/sonic-server`);


/** Admin > Storage > File size limits (issue #163): each type's, in MB. */
export interface FileSizeLimits {
  limitsMb: Record<AttachmentTypeValue, number>;
  builtInMb: Record<AttachmentTypeValue, number>;
  /** The types whose limit is saved rather than built in. */
  custom: AttachmentTypeValue[];
}

/** An instrument an admin added to the list (issue #166): picked by its id. */
export interface CustomInstrument {
  id: string;
  /** In English, and the fallback. */
  label: string;
  /** Per locale, e.g. {"fr": "Nyckelharpa"}. */
  translations: Record<string, string> | null;
}

/** Admin > Instruments: who plays it. */
export interface AdminCustomInstrument extends CustomInstrument {
  userCount: number;
}

/** A screen showing a set (issue #186). */
export interface ScreenSummary {
  id: string;
  /** Whose it is (issue #222): a person's, a team's or an organisation's. */
  owner: { kind: "user" | "team" | "organization"; id: string; name: string };
  /** The viewer renames it, changes its look and owner, or disconnects it. */
  canManage: boolean;
  name: string;
  mode: ScreenMode;
  setlistId: string | null;
  setlist: { id: string; name: string | null; eventDate: string | null; fromEvent?: boolean } | null;
  /** When it last loaded its set. */
  lastSeenAt: string | null;
  /** A set put on it, or its owner's set of the day (issue #274); left out by an older API. */
  setMode?: "FIXED" | "DAY";
  /** Connected now (issue #267); left out where it isn't known (a screen's own view of itself). */
  online?: boolean;
  createdAt: string;
  /** Its look (issue #194): a saved theme, or a built-in one by its id; neither, the default. */
  themeId: string | null;
  themeTemplate: string | null;
  /** The layers it never shows (issue #287); left out by an older API. */
  hiddenLayers?: ScreenSwitchableLayer[];
  /** Effects shown (issue #281), or off on a screen that can't keep up; left out by an older API. */
  effects?: boolean;
  /** Its latest report about itself (issue #286), with what it can run; for who manages it, and null before its first. */
  report?: (ScreenReport & { at: string; tier: ScreenTier }) | null;
}

/** A screen theme's own file (issue #194): a background picture or video ("media"), or a font, at a signed address. */
export interface ScreenThemeAsset {
  id: string;
  kind: "media" | "font" | "shader";
  mimeType: string;
  filename: string;
  url: string;
}

/** A brand's file (issue #279): a logo in its slot, a background or a font, at its signed address. */
export interface BrandAsset {
  id: string;
  kind: BrandAssetKind;
  /** A background's or a font's name. */
  name: string | null;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  url: string;
}

/** A brand (issue #279): a team's or an organisation's logos, colours, fonts, backgrounds and links. */
export interface Brand extends BrandContent {
  id: string;
  name: string;
  owner: { kind: "team" | "organization"; id: string; name: string };
  /** The one picked first among its owner's. */
  isDefault: boolean;
  /** Its owner's admins change it. */
  canEdit: boolean;
  assets: BrandAsset[];
  updatedAt: string;
}

/** A widget's default look (issue #273): the user's own, or a team's. */
export interface ScreenWidgetDefault {
  kind: ScreenWidgetKind;
  teamId: string | null;
  teamName: string | null;
  look: ScreenWidgetLook;
  /** Theirs, or a team's they're an admin of. */
  canEdit: boolean;
}

/** A saved screen theme (issue #194): the user's own or a team's. */
/** A template's part (issue #281): a built-in one by its id, or a saved one with its name. */
export type ScreenPartRefView = { builtIn: string } | { id: string; name: string };

/** A saved part (issue #281): a content theme, a background theme or effects. */
export interface ScreenPartSummary {
  id: string;
  kind: ScreenPartKind;
  name: string;
  document: ScreenContentTheme | ScreenBackgroundTheme | ScreenEffects;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  teamName: string | null;
  canEdit: boolean;
  /** How many templates use it. */
  templates: number;
  /** A content theme's fonts, a background theme's pictures and videos. */
  assets: ScreenThemeAsset[];
  updatedAt: string;
}

export interface ScreenThemeSummary {
  id: string;
  name: string;
  /** What screens using it draw: its parts and layout composed (issue #281). */
  theme: ScreenTheme;
  /** Its tags, widget grid and masks. */
  template: ScreenTemplateLayout;
  /** Its parts (issue #281); effects null: none. */
  parts: { content: ScreenPartRefView; background: ScreenPartRefView; effects: ScreenPartRefView | null };
  ownerUserId: string | null;
  ownerTeamId: string | null;
  teamName: string | null;
  /** Theirs, or a team's they're an admin of: they change and delete it. */
  canEdit: boolean;
  updatedAt: string;
  /** Its pictures, videos and fonts, which its document refers to by id. */
  assets: ScreenThemeAsset[];
}

/** What a screen shows (GET /screens/current, with its own token): itself, and its set to keep - each song as the song view gives it - with the songs' credits. */
export interface ScreenCurrent {
  screen: ScreenSummary;
  /** Its look (issue #194), worked out: its theme, else its built-in one, else the default. */
  theme: ScreenTheme;
  /** Its theme's pictures, videos and fonts; left out by an older API. */
  assets?: ScreenThemeAsset[];
  set: (SetlistOfflineCopy & { credits: Record<string, { writers: string[]; copyright: string | null; ccli: string | null }> }) | null;
}

/** Admin > Roles (issue #160): what a role allows, and how many have it. */
export interface AdminRole {
  id: string;
  name: string;
  description: string;
  /** "REVIEWER" | "STEM_SEPARATION": can't be deleted. */
  builtIn: string | null;
  canReview: boolean;
  canSeparateStems: boolean;
  /** Lossless audio uploads keep their original, as FLAC (issue #182). */
  canKeepLosslessAudio: boolean;
  /** Uploads audio files (issue #183); recording in Songverse needs no role. */
  canUploadAudio: boolean;
  /** Controls what's presented on the screens of the sets they can open (issue #305). */
  canOperateScreens: boolean;
  /** Null: Admin > Stem separation's. */
  stemSeparationMonthlyLimit: number | null;
  /** A storage tier (MB). */
  storageLimitMb: number | null;
  permissions: string[];
  userCount: number;
  teamCount: number;
}

/** Admin > Teams (issue #160). */
export interface AdminTeamSummary {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  avatarUrl: string | null;
  createdAt: string;
  memberCount: number;
  songCount: number;
  roles: { id: string; name: string }[];
  /** Its pool: what's on its songs, and its limit. */
  usedBytes: number;
  limitBytes: number;
}

/** Admin > Security (issue #113): each setting's value, and whether it comes from the database, its env var or the default. */
/** Admin > Collaboration (issue #27). */
export interface CollaborationSettingsSummary {
  source: "database" | "env" | "none";
  settings: { liveCoEditing: SecuritySetting<boolean> };
}

export interface SecuritySettingsSummary {
  source: "database" | "env" | "none";
  settings: {
    rateLimitEnabled: SecuritySetting<boolean>;
    rateLimitPerMinute: SecuritySetting<number>;
    rateLimitAnonymousPerMinute: SecuritySetting<number>;
    rateLimitHeavyPerMinute: SecuritySetting<number>;
    trustedProxies: SecuritySetting<number>;
    apiDocsPublic: SecuritySetting<boolean>;
    contentSecurityPolicy: SecuritySetting<"ENFORCE" | "REPORT_ONLY" | "OFF">;
    signupInviteOnly: SecuritySetting<boolean>;
  };
}
export interface SecuritySetting<T> {
  value: T;
  source: "database" | "env" | "default";
  /** Its environment variable. */
  env: string;
}

export interface AdminStorageStats {
  driver: "s3" | "local";
  source: StorageConfigSource;
  attachmentCount: number;
  totalBytes: number;
  byType: Record<string, number>;
}

export interface StorageConfigSummary {
  source: StorageConfigSource;
  driver: "s3" | "local";
  hasDatabaseConfig: boolean;
  accountId: string | null;
  accessKeyIdMasked: string | null;
  bucket: string | null;
  endpoint: string | null;
}

export type SaveStorageConfigInput = z.input<typeof SaveStorageConfigSchema>;

export type AuthConfigSource = "database" | "env" | "none";

export interface AuthConfigSummary {
  emailSource: AuthConfigSource;
  emailFrom: string;
  hasDatabaseResendKey: boolean;
  googleSource: AuthConfigSource;
  googleClientId: string | null;
  hasDatabaseGoogleSecret: boolean;
}

export type SaveAuthConfigInput = z.input<typeof SaveAuthConfigSchema>;

export interface AuthPublicConfig {
  hasGoogleAuth: boolean;
  /** Only invited people can create an account (issue #198). */
  signupInviteOnly: boolean;
}

/** An invitation to create an account (issue #198), as Admin > Users lists it. */
export interface SignupInvitationSummary {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  invitedBy: { id: string; displayName: string } | null;
  /** The web app's page for it, to copy and send by other means. */
  link: string;
}

/** What an invitation's page shows before signing up. */
export interface SignupInvitationPreview {
  email: string;
  status: "pending" | "expired" | "accepted";
}

export type TeamRole = "MEMBER" | "ADMIN";

export interface TeamSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  currentUserRole: TeamRole;
  /** Its colour (issue #161); null: one derived from its name (entityColor). */
  color: string | null;
  /** Its picture, if it has one. */
  avatarUrl: string | null;
  /** The organisation it's part of (issue #241), if any. */
  organization?: { id: string; name: string; color: string | null } | null;
  /** A Songverse team (songs, songbooks, sets), or a group that only plans (issue #241). */
  usesSongverse?: boolean;
  /** The group it's under, in its organisation. */
  parentId?: string | null;
}

/** A group's own position (issue #241): "Greeter", "Coffee". */
export interface TeamPosition {
  id: string;
  name: string;
}

/** An organisation (issue #241) one is in. */
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  currentUserRole: TeamRole;
  memberCount: number;
  teamCount: number;
}

/** GET /organizations: the instance's mode, whether one may create one, and one's own. */
export interface MyOrganizations {
  mode: OrganizationMode;
  canCreate: boolean;
  organizations: OrganizationSummary[];
}

/** A team of an organisation, as its members see it. */
export interface OrganizationTeam {
  id: string;
  name: string;
  color: string | null;
  avatarUrl: string | null;
  memberCount: number;
  /** Whether one is in it. */
  mine: boolean;
  usesSongverse: boolean;
  /** The group it's under, if any. */
  parentId: string | null;
  /** Its own positions, parts an event can ask it for. */
  positions: TeamPosition[];
}

export interface OrganizationDetail extends OrganizationSummary {
  teams: OrganizationTeam[];
}

export interface OrganizationMember {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: TeamRole;
  joinedAt: string;
}

/** Admin > Organisations (issue #241): the mode and who may create one, where each comes from, and every organisation. */
export interface AdminOrganizations {
  source: "database" | "env" | "none";
  settings: {
    mode: SecuritySetting<OrganizationMode>;
    anyoneCreates: SecuritySetting<boolean>;
  };
  /** Planiverse's address (PLANIVERSE_URL, set where it's deployed), or null: not deployed. */
  planiverseUrl: string | null;
  organizations: AdminOrganization[];
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberCount: number;
  teamCount: number;
  admins: { id: string; displayName: string; email: string }[];
}

export interface TeamMember {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: TeamRole;
  joinedAt: string;
  instruments: string[];
  techRoles: TechRoleValue[];
  /** The group's own positions they cover (TeamPosition ids, issue #241). */
  positionIds?: string[];
}

/** A team's event (issue #235). */
export interface TeamEvent {
  id: string;
  teamId: string;
  title: string;
  /** Its first date, YYYY-MM-DD. */
  date: string;
  startTime: string;
  durationMinutes: number;
  /** Its call time (issue #240): minutes before the start to be there. */
  callMinutes: number | null;
  timeZone: string;
  place: string | null;
  note: string | null;
  repeat: EventRepeat | null;
  /** The parts it needs (issue #235, phase 7). */
  parts: EventPart[];
  /** A rehearsal tied to another event: its dates are that event's, days before. */
  rehearsalFor: { eventId: string; daysBefore: number } | null;
  /** A group's part of an organisation's event (issue #241): its timing is set there. */
  organizationEventId?: string | null;
  planned?: { organizationEventId: string; organizationId: string; organizationName: string; hostName: string | null } | null;
}

/** What an organisation's event needs from one of its groups (issue #241). */
export interface OrganizationEventNeed {
  teamId: string;
  teamName: string;
  color: string | null;
  avatarUrl: string | null;
  /** The group's part: one of its events. */
  teamEventId: string;
  parts: EventPart[];
  /** When the group is to be there (issue #240): minutes before the start. */
  callMinutes: number | null;
}

/** An organisation's event (issue #241): its host, its timing, the groups it needs. */
export interface OrganizationEvent {
  id: string;
  organizationId: string;
  title: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  timeZone: string;
  place: string | null;
  note: string | null;
  repeat: EventRepeat | null;
  host: { id: string; displayName: string } | null;
  needs: OrganizationEventNeed[];
  /** The viewer is one of its admins, or its host. */
  canManage: boolean;
}

/** A date of an organisation's event, with each group's part. */
export interface OrganizationEventDate {
  eventId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  title: string;
  place: string | null;
  timeZone: string;
  host: { id: string; displayName: string } | null;
  canManage: boolean;
  /** Cancelled for every group. */
  cancelled: boolean;
  groups: {
    teamId: string;
    teamName: string;
    color: string | null;
    avatarUrl: string | null;
    teamEventId: string;
    /** The viewer is in it. */
    mine: boolean;
    cancelled: boolean;
    /** When the group is to be there (issue #240). */
    callAt: string | null;
    setlistId: string | null;
    songCount: number;
    parts: EventPart[];
    /** For its admins and the event's host. */
    coverage: PartCoverage[] | null;
    lineup: { displayName: string; partKey: string; status: AssignmentStatus }[];
  }[];
}

/** What an organisation's event usually needs, kept under a name (issue #241). */
export interface OrganizationEventPreset {
  id: string;
  name: string;
  title: string;
  startTime: string;
  durationMinutes: number;
  place: string | null;
  needs: { teamId: string; parts?: EventPart[]; callMinutes?: number }[];
}

/** A date of a team's event, with its set. */
export interface TeamEventDateSummary extends EventDate {
  eventId: string;
  /** The date's own title, or the event's. */
  title: string;
  ownTitle: string | null;
  eventTitle: string;
  place: string | null;
  timeZone: string;
  /** When to be there (issue #240), ISO 8601; null without a call time. */
  callAt: string | null;
  repeats: boolean;
  setlistId: string | null;
  songCount: number;
  /** When an admin said its set is ready. */
  setReadyAt: string | null;
  /** The viewer's answer (issue #235). */
  myAnswer: MyEventAnswer;
  /** For the team's admins: how its members answered (NONE: no answer yet). */
  counts: Record<AvailabilityAnswer | "NONE", number> | null;
  /** For the team's admins: how its parts are covered by the answers. */
  coverage: PartCoverage[] | null;
  parts: EventPart[];
  /** Who's on which part (issue #235, phase 7). */
  lineup: LineupPlace[];
  /** A rehearsal's date: the event's date it's for. */
  rehearsalFor: RehearsalFor | null;
}

/** Someone's answer for a date: their own, or Not available on a day they're away (`away`); null when not answered. */
export interface MyEventAnswer {
  answer: AvailabilityAnswer | null;
  away: boolean;
  note: string | null;
  /** Given by one of the team's admins for them. */
  byAdmin: boolean;
}

/** A member's answer for a date, as the team's admins see it. */
export interface MemberEventAnswer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  instruments: string[];
  techRoles: string[];
  /** The group's own positions they cover (issue #241). */
  positionIds?: string[];
  role: TeamRole;
  answer: AvailabilityAnswer | null;
  away: boolean;
  note: string | null;
  /** The admin who answered for them. */
  answeredBy: string | null;
}

/** A date of one of someone's teams, on their own calendar. */
/** Someone on a part for a date (issue #235, phase 7). Notes and clashes are shown to the team's admins and the person. */
export interface LineupPlace {
  id: string;
  /** Null for a guest without an account. */
  userId: string | null;
  displayName: string;
  partKey: string;
  status: AssignmentStatus;
  /** A guest: one of an admin's People ("account"), or someone without an account ("external"). */
  guest: "account" | "external" | null;
  mine: boolean;
  note: string | null;
  conflicts: ("AWAY" | "UNAVAILABLE" | "ELSEWHERE")[];
  /** A replacement looked for (a swap), and whether the viewer could take the place. */
  swap: { requestedAt: string; note: string | null } | null;
  canTake: boolean;
}

export interface MyEventDate extends EventDate {
  eventId: string;
  title: string;
  place: string | null;
  timeZone: string;
  /** When to be there (issue #240), ISO 8601; null without a call time. */
  callAt: string | null;
  repeats: boolean;
  teamId: string;
  teamName: string;
  teamColor: string | null;
  teamAvatarUrl: string | null;
  isAdmin: boolean;
  setlistId: string | null;
  songCount: number;
  myAnswer: MyEventAnswer;
  parts: EventPart[];
  lineup: LineupPlace[];
  /** On another team's line-up, as a guest. */
  guest: boolean;
  rehearsalFor: RehearsalFor | null;
}

/** What a rehearsal's date is for (issue #235, phase 7): its event, that date, and its title. */
export interface RehearsalFor {
  eventId: string;
  date: string;
  title: string;
}

/** A team admin asking for answers for some dates, by a deadline (issue #235). */
export interface TeamAnswerRequest {
  id: string;
  from: string;
  to: string;
  deadline: string;
  timeZone: string;
  createdBy: string | null;
  createdAt: string;
  remindedAt: string | null;
}

/** Days someone is away, across all their teams. */
export interface AwayDays {
  id: string;
  from: string;
  to: string;
  note: string | null;
}

/** A notification (issue #236): its kind and details, put into words by `notificationText`. */
/** A section that repeats an earlier one (issue #231): how, to link it as a pass of that one. */
export interface SongRepeat {
  sectionId: string;
  ofSectionId: string;
  kind: "same" | "transposed" | "chords" | "lines";
  /** Semitones it's moved. */
  steps: number;
  /** Chords of its own. */
  chords: number;
  /** Lines of the earlier section it leaves out. */
  hiddenLines: number;
}

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  data: NotificationData;
  /** Where it leads in the web app. */
  url: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  /** Older ones to load. */
  more: boolean;
  unread: number;
}

/** How each kind of notification reaches someone, and whether this server emails at all (Admin > Notifications). */
export interface MyNotificationPreferences {
  kinds: NotificationPreferences;
  quiet: QuietHours | null;
  emailAvailable: boolean;
  /** The server's VAPID public key, to turn a device on; null: push isn't set up. */
  pushKey: string | null;
}

/** A device someone turned notifications on for (issue #236). */
export interface PushDevice {
  id: string;
  endpoint: string;
  label: string | null;
  createdAt: string;
  lastPushedAt: string | null;
  /** Why the last push to it failed, if it did (issue #237): cleared by one that works. */
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface NotificationServerSettingsSummary {
  source: "database" | "env" | "none";
  settings: { emailEnabled: SecuritySetting<boolean> };
  push: {
    source: "database" | "env" | "none";
    ready: boolean;
    publicKey: string | null;
    hasDatabasePrivateKey: boolean;
    /** Set up, but not usable by the API (a saved key it can't decrypt). */
    error: string | null;
    subject: string | null;
    subjectEnv: string | null;
  };
}

export interface TeamCalendarSettings {
  setsAheadWeeks: number;
}

export interface TeamInviteLink {
  id: string;
  token: string;
  role: TeamRole;
  createdAt: string;
  expiresAt: string | null;
  usedCount: number;
  maxUses: number | null;
}

export type CreateInviteLinkInput = z.input<typeof CreateInviteLinkSchema>;

export type OwnershipScope = "GLOBAL" | "TEAM" | "USER";

export type SongbookKind = "SIMPLE" | "NUMBERED";

export interface SongbookEntry {
  id: string;
  songVersionId: string;
  entryCode: string | null;
  songVersionTitle: string | null;
  sectionLabel: string | null;
}

export interface SongbookSummary {
  id: string;
  name: string;
  abbreviation: string | null;
  language: string | null;
  publisher: string | null;
  year: number | null;
  kind: SongbookKind;
  sections: SongbookSection[] | null;
  ownerScope: OwnershipScope;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  sourceCatalogId?: string | null;
  /** Its colour and picture (issue #161). */
  color: string | null;
  avatarUrl: string | null;
  /**
   * What the user may do with it (issue #211): own it (change, share,
   * delete), edit its entries and details (shared to edit), or only view
   * it. Missing from copies kept offline before then.
   */
  access?: "own" | "edit" | "view";
}

/** Someone, or a team, a songbook is shared with (issue #211). */
export interface SongbookShare {
  canEdit: boolean;
  user: Person | null;
  team: { id: string; name: string } | null;
}

export interface PendingSongbookEntry {
  catalogEntryId: string;
  entryCode: string;
  title: string;
}

export interface SongbookDetail extends SongbookSummary {
  entries: SongbookEntry[];
  pendingEntries?: PendingSongbookEntry[];
  /** Imported from a catalogue whose printed volumes differ from the songbook's: offered to use (issue #55). */
  catalogSections?: SongbookSection[] | null;
}

export type CreateSongbookInput = CreateSongbookRequest;

export type ImportSongbookFromCatalogInput = z.input<typeof ImportSongbookFromCatalogSchema>;

export type BulkUploadContentType = "CHORDPRO" | "PDF";

export interface BulkUploadCommitResult {
  queued: number;
  skipped: string[];
}

export type UpdateSongbookInput = UpdateSongbookRequest;

/** Every field of the catalogue file format (see songbook-catalog-format), plus where "Original song" points. */
export interface SongbookCatalogEntry extends CatalogEntryData {
  id: string;
  /** The entry `originalSong` refers to ("JEM 245"), when it exists in Songverse. */
  original: {
    catalogId: string;
    catalogName: string;
    catalogAbbreviation: string | null;
    entryId: string;
    entryCode: string;
    title: string;
  } | null;
}

export interface SongbookCatalogSummary {
  id: string;
  name: string;
  abbreviation: string | null;
  publisher: string | null;
  isbn: string | null;
  description: string | null;
  coverImageUrl: string | null;
  officialUrl: string | null;
  language: string | null;
  licensed: boolean;
  /** The printed volumes' number ranges ("JEM1": 1-371...), copied into imported songbooks (issue #55). */
  sections: SongbookSection[] | null;
}

export interface SongbookCatalogDetail extends SongbookCatalogSummary {
  entries: SongbookCatalogEntry[];
}

export type CreateSongbookCatalogInput = z.input<typeof CreateCatalogSchema>;

export type UpdateSongbookCatalogInput = z.input<typeof UpdateCatalogSchema>;

/** Any fields of an entry; null or "" clears, a field left out is left alone. */
export type SongbookCatalogEntryInput = { [K in keyof CatalogEntryData]?: CatalogEntryData[K] | null };

export interface SongbookCatalogImportResult {
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
  /** The first 500 changes. */
  changes: { entryCode: string; kind: "create" | "update" | "delete"; fields: CatalogEntryFieldKey[] }[];
}

export type AttachmentType = "PDF" | "CHORDPRO" | "MUSICXML" | "ABC_NOTATION" | "TEXT" | "IMAGE" | "AUDIO" | "OTHER";

export interface Attachment {
  id: string;
  songVersionId: string;
  type: AttachmentType;
  filename: string;
  mimeType: string;
  sizeBytes: number | null;
  /** For audio: the part of the song it is (a stem), or null for a full mix. */
  stemPart: StemPart | null;
  /** Its own name for the part (issue #131), shown instead of the part's; null: the part's. */
  partName: string | null;
  /** The viewer uploaded it (issue #131): others' parts say who recorded them. */
  mine: boolean;
  /** For audio: the recording's key and tempo (BPM) when they aren't the song's, else null. */
  recordingKey: string | null;
  recordingTempo: number | null;
  /** Where its first beat falls, in seconds (issue #100); null for 0:00. */
  recordingFirstBeat: number | null;
  /** Played freely before its first beat (issue #178): the click waits for it, with a count-in, rather than clicking from 0:00. */
  recordingFreeIntro?: boolean;
  /** Its beats and the first beat of each of its bars, in seconds (issue #299), as the stem separation's analysis found them; empty or left out for none. */
  recordingBeats?: number[];
  recordingDownbeats?: number[];
  /** A lossless upload's original (issue #182), kept as FLAC beside this Opus copy: downloadAttachmentOriginal. */
  original?: { mimeType: string; sizeBytes: number | null } | null;
  /** Recorded this many semitones above its multitrack (issue #135), while the player was transposed; null: in its key. */
  pitchOffset: number | null;
  /** Its time signature ("4/4") when it isn't the song's (issue #123). */
  recordingTimeSignature: string | null;
  /** The multitrack it's part of (issue #123): files recorded together; null for the song's original stems. */
  multitrackId: string | null;
  multitrackName: string | null;
  /** The set its multitrack was recorded for (issue #127). */
  multitrackSetlistId: string | null;
  multitrackSetlist: { id: string; name: string | null; eventDate: string | null; fromEvent?: boolean } | null;
  /** Another take of its part, kept but not played (issue #127). */
  otherTake: boolean;
  /** A recorded take being turned into Opus (PENDING), or that couldn't be (FAILED); null once done, or for any other file. */
  processing: "PENDING" | "FAILED" | null;
  /** Who sees it besides its uploader (issue #72): nobody, a team, or everyone who sees the song. */
  visibility: AttachmentVisibility;
  visibleToTeamId: string | null;
  visibleToTeam: { id: string; name: string } | null;
  uploadedByUserId: string | null;
  uploadedBy: { id: string; displayName: string; avatarUrl?: string | null } | null;
  /** Where each section starts in the recording (issue #110), the same on each file of a multitrack. */
  cuePoints?: CuePoint[] | null;
  /** Kept as uploaded (issue #145): not deleted, replaced, merged or cleaned up until its uploader unlocks it. */
  locked?: boolean;
  /** How it came in (issue #175): uploaded, separated from a recording, or recorded in Songverse's recorder. */
  origin?: AttachmentOrigin;
  /** Its recording details a separation's analysis found, not yet confirmed (issue #175). */
  detected?: DetectedDetail[];
  /** The viewer may change its part, key and tempo, or remove it. */
  canChange: boolean;
  /** The viewer may change who sees it. */
  canChangeVisibility: boolean;
  createdAt: string;
}

export type AttachmentVisibility = "PRIVATE" | "TEAM" | "SONG" | "SHARED";
export type AttachmentOrigin = "UPLOADED" | "SEPARATED" | "RECORDED";
export type DetectedDetail = "key" | "tempo" | "timeSignature" | "firstBeat" | "beats" | "sections";

/** Who sees a file: `teamId` for TEAM. */
/** An audio file's recording details and multitrack (issues #65, #100, #123). */
export interface RecordingDetails {
  recordingKey?: string;
  recordingTempo?: number;
  recordingTimeSignature?: string;
  recordingFirstBeat?: number;
  recordingFreeIntro?: boolean;
  pitchOffset?: number;
  multitrackId?: string;
  multitrackName?: string;
  multitrackSetlistId?: string;
  partName?: string;
  /** A recorded WAV take to turn into Opus (issue #127): "encode", plus ",level" and ",noise" if wanted. */
  process?: string;
  otherTake?: boolean;
}

export interface AttachmentAudience {
  visibility: AttachmentVisibility;
  teamId?: string | null;
}

export interface ArtistSummary {
  id: string;
  userId: string | null;
  source: string | null;
}

export interface TagCategory {
  id: string;
  slug: string;
  label: string;
  translations: Record<string, string> | null;
  isGlobal: boolean;
}

export interface Tag {
  id: string;
  categoryId: string;
  slug: string;
  label: string;
  translations: Record<string, string> | null;
  scope: string;
  isApproved: boolean;
}

export interface SongVersionSummary {
  id: string;
  workId: string;
  title: string;
  alternateTitle: string | null;
  /** Tells this version apart from the song's others, e.g. "Acoustic". */
  versionName: string | null;
  language: string;
  ownerScope: "GLOBAL" | "TEAM" | "USER";
  ownerUserId: string | null;
  ownerTeamId: string | null;
  publicationState: string;
  ccli: string | null;
  /** Who put it in the catalogue (issue #73): a person, and the team whose song it was. */
  contributedBy: { id: string; displayName: string } | null;
  contributedByTeam: { id: string; name: string } | null;
  /** Shared with the viewer by its owner (issue #77): who by, and whether to edit. */
  sharedBy?: SharedBy | null;
  /** Its image (issue #85), at an address signed for the viewer that works for a day or two; add `&w=` for a width. */
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  artists: ArtistSummary[];
  tags: Tag[];
  /** Where it is in the viewer's numbered songbooks, abbreviations first ("JEM 58", "HY 12"), when asked for (issue #213). */
  songbookReferences?: string[];
  /** Searched in the lyrics (issue #221): the line found, the words found in it. */
  lyricsMatch?: LyricsMatch;
}


export interface ListSongVersionsQuery {
  /** Matches title, subtitle, version name or artist (ignoring case), or a CCLI number exactly. */
  q?: string;
  /** "lyrics": q searches the songs' words instead (issue #221), each song with the line found. */
  in?: "lyrics";
  /** Only the user's favorites (issue #81). */
  favorites?: boolean;
  language?: string;
  tagId?: string;
  /** Only this artist's songs: the whole name, ignoring case and accents. */
  artist?: string;
  /** Defaults to updatedAt. */
  sort?: SongSort;
  /** Defaults to desc for dates, asc otherwise. */
  dir?: "asc" | "desc";
  /** 1-based. */
  page?: number;
  /** Up to 200; defaults to 50. */
  pageSize?: number;
  /** Each song's places in the viewer's numbered songbooks too (issue #213). */
  references?: boolean;
}

/** What a smart list (issue #58) filters the library by: the library's own search. */
export interface SmartListFilters {
  q?: string;
  language?: string;
  tagId?: string;
  artist?: string;
  sort?: SongSort;
  dir?: "asc" | "desc";
}

/** A saved library filter, the user's own. */
export interface SmartList {
  id: string;
  name: string;
  filters: SmartListFilters;
  createdAt: string;
  updatedAt: string;
}

/** An artist credited on songs the user can see. */
export interface ArtistCount {
  name: string;
  songCount: number;
  /** Their picture (issue #86), signed for the viewer; null when there's none. */
  imageUrl: string | null;
}

/** An artist's page (issue #86). */
export interface ArtistDetail {
  id: string | null;
  name: string;
  /** Songs by them you can see. */
  songCount: number;
  imageUrl: string | null;
  /** "deezer", "upload", or null. */
  imageSource: string | null;
  /** The picture's source page (Deezer's), to credit it. */
  imageSourceUrl: string | null;
  /** One per language (en, fr): show the reader's. */
  bios: { text: string; language: string; sourceUrl: string | null; custom: boolean }[];
  /** Whether the providers have been asked yet. */
  lookedUp: boolean;
  lookupsEnabled: boolean;
  /** Global admins edit artists: they're the same for everyone. */
  canEdit: boolean;
}

export interface ArtistSettings {
  enabled: boolean;
  source: "database" | "env" | "default";
}

/** One page of songs, with the total across all pages. */
/** One of Apple Music's matches for a song's artwork (issue #85). */
export interface ArtworkCandidate {
  /** Who it's from (issue #89). */
  provider?: MetadataProviderKey;
  title: string;
  artist: string;
  album: string | null;
  releaseDate?: string | null;
  artworkUrl: string;
  thumbnailUrl: string;
}

/** Auto detect's results (issue #22), and the providers that didn't answer. */
export interface MetadataSearchResult {
  matches: MetadataMatch[];
  unavailable: MetadataProviderKey[];
}

export interface MetadataSettings {
  /** Every provider, in the order they're asked (issue #89). */
  providers: {
    key: MetadataProviderKey;
    name: string;
    /** What it's asked for. */
    capabilities: Record<MetadataCapability, boolean>;
    /** What it can do. */
    supports: MetadataCapability[];
    /** What it can do with the keys it has now. */
    ready: Record<MetadataCapability, boolean>;
  }[];
  source: "database" | "env" | "default";
  /** The Apple Music API's MusicKit key (issue #87): never the private key, only whether the database has one. */
  appleMusic: {
    source: "database" | "env" | "tokenUrl" | "none";
    teamId: string | null;
    keyId: string | null;
    hasDatabasePrivateKey: boolean;
    /** A developer token address, used while there's no key (a stopgap). */
    tokenUrl: string | null;
    tokenUrlSource: "database" | "env" | "none";
    /** The storefront searched (kept with Song artwork's settings). */
    country: string;
  };
  /** Spotify's developer app (issue #89): never the secret, only whether the database has one. */
  spotify: { source: "database" | "env" | "none"; clientId: string | null; hasDatabaseSecret: boolean; market: string; marketSource: "database" | "env" | "default" };
  musicbrainz: { contact: string; source: "database" | "env" | "default" };
  /** The YouTube Data API's key (issue #169), for the song links' YouTube search: never the key, only whether the database has one. */
  youtube: { source: "database" | "env" | "none"; hasDatabaseKey: boolean };
}

/** YouVersion's App Key (issue #304): never the key, only whether the database has one; none: YouVersion off. */
export interface YouVersionSettings {
  source: "database" | "env" | "none";
  hasDatabaseKey: boolean;
}

/** A YouVersion version (issue #304): its copyright line goes with every passage shown. */
export interface YouVersionBible {
  id: number;
  abbreviation: string;
  title: string;
  languageTag: string;
  copyright: string | null;
  info: string | null;
  link: string | null;
}

/**
 * A passage of a YouVersion version (issue #304): verses or whole chapters as
 * YouVersion gives them, never to be kept - `rights` says what else it may
 * be used for, nothing until a version's licence is read.
 */
export interface YouVersionPassage {
  reference: string;
  bible: YouVersionBible;
  parts: { id: string; reference: string; text: string }[];
  rights: { offline: boolean; projection: boolean; export: boolean };
}

/** What an imported Bible may be used for beyond being read (issue #301): the admin's to say, off until then. */
export interface BibleRights {
  projection: boolean;
  offline: boolean;
  export: boolean;
}

/** A Bible imported from a file (issue #301), with its books as it names them. */
export interface ImportedBible {
  id: string;
  name: string;
  abbreviation: string | null;
  language: string | null;
  copyright: string | null;
  books: { number: number; name: string; osisId?: string; chapters: number }[];
  rights: BibleRights;
}

/** As Admin > Bibles lists it: how its import went too. */
export interface AdminBible extends ImportedBible {
  status: "IMPORTING" | "READY" | "FAILED";
  error: string | null;
  sourceFormat: BibleSourceFormat | null;
  verseCount: number;
  createdAt: string;
}

/** A passage of an imported Bible (issue #301), chapter by chapter, with its copyright line. */
export interface BiblePassage {
  reference: string;
  bible: Pick<ImportedBible, "id" | "name" | "abbreviation" | "copyright">;
  chapters: PassageChapter[];
  rights: BibleRights;
}

/** A song's link to choose from, found at one service by its title and artist (issue #169). */
export interface LinkCandidate {
  title: string;
  /** The artist, or a YouTube video's channel. */
  artist: string | null;
  album: string | null;
  thumbnailUrl: string | null;
  /** The link itself, as the service gives it. */
  url: string;
}

/** Which services a song's links can be searched at (issue #169): Spotify needs its app, YouTube its key. */
export type LinkSearchServices = Record<StreamingLinkType, boolean>;

/** Background jobs (issue #92), for Admin > Metadata. */
export interface JobsHeartbeat {
  at: string;
  host: string;
  /** Its SETTINGS_ENCRYPTION_KEY against the API's (issue #95); null from a Worker too old to say. */
  settingsKey: "missing" | "different" | "same" | null;
  /** Its ffmpeg's version, "" without one (recorded takes stay WAV, issue #127); null from a process too old to say. */
  ffmpeg: string | null;
}

export interface JobsStatus {
  /** The Worker's last heartbeat (every 15 seconds; gone after a minute), or null. */
  worker: JobsHeartbeat | null;
  /** An API process that runs jobs itself (JOBS_IN_API), or null. */
  api: JobsHeartbeat | null;
  thisApiRunsJobs: boolean;
  queues: { name: string; waiting: number; active: number; delayed: number; failed: number; completed: number }[];
  /** The last jobs done, newest first. */
  recent: JobSummary[];
  /** The jobs that failed, with why (issue #93). */
  failed: JobSummary[];
  /** Failed jobs counted but whose details are gone. */
  failedWithoutDetails: number;
}

export interface JobSummary {
  id: string | null;
  queue: string;
  name: string;
  state: "completed" | "failed";
  finishedAt: string | null;
  result: unknown;
  error: string | null;
  subject: string | null;
}

export interface ArtworkSettings {
  enabled: boolean;
  country: string;
  source: "database" | "default";
}

/** Where a song is in a list (issue #84): the ones before and after it; null position when it isn't in it. */
export interface SongNeighbors {
  position: number | null;
  total: number;
  previous: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

/** The Library's home (issue #81): its shelves, each up to 12 songs. */
export interface LibraryHome {
  newest: SongVersionSummary[];
  recent: SongVersionSummary[];
  favorites: SongVersionSummary[];
  popular: SongVersionSummary[];
}

export interface SongPage {
  items: SongVersionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SongVersionSongbookMembership {
  songbookId: string;
  songbookName: string;
  abbreviation: string | null;
  entryCode: string | null;
  /** The printed volume the number falls in (the songbook's sections). */
  sectionLabel: string | null;
  /** To give someone without the app: "JEM 855 · JEM3" (issue #55). */
  reference: string;
}

export interface VersionContributor {
  id: string;
  userId: string | null;
  source: string | null;
  roles: string[];
  isAutoAttached: boolean;
  displayOrder: number;
}

/** One step in a song's history (issue #71), newest first in a list. */
export interface SongRevisionEntry {
  id: string;
  /** EDITED; CREATED; RESTORED (`restoredFrom` it); BASELINE: the song as it was before its history was kept. */
  kind: "CREATED" | "EDITED" | "RESTORED" | "BASELINE";
  createdAt: string;
  /** When its last save landed: saves by the same person a few minutes apart are one entry. */
  updatedAt: string;
  /** Null once they're deleted, or for BASELINE. */
  author: { id: string; displayName: string } | null;
  changes: SongChange[];
  restoredFrom: { id: string; updatedAt: string } | null;
}

/** An entry with the song as it left it, and as the entry before left it (null for the first). */
export interface SongRevisionDetail extends SongRevisionEntry {
  snapshot: SongSnapshot;
  previous: SongSnapshot | null;
}

/** A suggested change to a catalogue song (issue #74). */
export interface Suggestion {
  id: string;
  state: "OPEN" | "UNDER_REVIEW" | "ACCEPTED" | "REJECTED" | "PARTIALLY_APPLIED" | "WITHDRAWN";
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  /** What it changes and why, for the reviewer. */
  description: string | null;
  reviewNotes: string | null;
  proposer: { id: string; displayName: string };
  reviewer: { id: string; displayName: string } | null;
  song: { id: string; title: string; versionName: string | null; ownerScope: string };
  changes: SongChange[];
}

/** A suggestion with the song as it was when it was made and as it would leave it; `conflicts` are the parts changed since in the same place. */
export interface SuggestionDetail extends Suggestion {
  base: SongSnapshot;
  proposed: SongSnapshot;
  conflicts: string[];
}

/** Who shared a song with you (issue #77), and whether to edit. */
export interface SharedBy {
  id: string;
  displayName: string;
  canEdit: boolean;
}

/** Someone in Songverse (People, issue #77). */
export interface Person {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PeopleOverview {
  people: (Person & { connectionId: string; email: string })[];
  /** Asking to connect with you. */
  incoming: { id: string; createdAt: string; from: Person & { email: string } }[];
  /** You asked, and they haven't said yes yet. */
  outgoing: { id: string; createdAt: string; email: string }[];
  /** People from your teams you're not connected to. */
  suggestions: Person[];
}

export interface SongShare {
  user: Person;
  canEdit: boolean;
}

export type StreamingLinkType = "SPOTIFY" | "APPLE_MUSIC" | "DEEZER" | "YOUTUBE";

export interface SongVersionLink {
  id: string;
  type: string;
  value: string;
  sourceUrl: string | null;
}

export interface SongVersionDetail extends SongVersionSummary {
  sortTitle: string | null;
  album: string | null;
  /** Written or published; separate from copyrightYear. */
  year: number | null;
  copyright: string | null;
  copyrightYear: number | null;
  publisher: string | null;
  /** Compact: USRC17607839. */
  isrc: string | null;
  /** E.g. the scripture a song draws on. */
  reference: string | null;
  notes: string | null;
  relationshipType: string | null;
  /** The version this one derives from, e.g. the original of a translation. */
  parentVersion: { id: string; title: string; language: string } | null;
  /** The music (SongDocument v2); key, tempo, time signature and duration are in `documentJson.defaults`. */
  documentJson: SongDocumentV2;
  /** Capo fret; moves to arrangements once they exist. */
  capo: number | null;
  contributors: VersionContributor[];
  identifiers: SongVersionLink[];
  /** Whether the current user may change its chart, details and credits. */
  canEdit: boolean;
  /** Whether they may delete, publish or share it, or change its links and everyone's files (#77). */
  canManage: boolean;
  /** In the user's favorites (issue #81). */
  isFavorite?: boolean;
}

/** A song's optional fields. A field left out is left alone; null clears it. */
export type SongFieldsInput = Omit<UpdateSongVersionRequest, "title" | "language" | "artists" | "revision">;

export type CreateSongVersionInput = CreateSongVersionRequest;

export type UpdateSongVersionInput = UpdateSongVersionRequest;

/** A name already credited on songs you can see. */
export interface CreditSuggestion {
  name: string;
  /** Every role they're credited in: PERFORMER, COMPOSER, LYRICIST... */
  roles: string[];
  songCount: number;
}

/** A song in your library with the title you're adding, and its versions. */
export interface SongMatch {
  workId: string;
  versions: {
    id: string;
    workId: string;
    title: string;
    versionName: string | null;
    language: string;
    ownerScope: "GLOBAL" | "TEAM" | "USER";
    teamName: string | null;
    key: string | null;
    artists: string[];
    /** This version has the title (the others are its song's other versions). */
    matchesTitle: boolean;
  }[];
}

export interface WorkIdentifier {
  id: string;
  workId: string;
  type: string;
  value: string;
  sourceUrl: string | null;
  verifiedAt: string | null;
  note: string | null;
}

export interface WorkDetail {
  id: string;
  preferredOriginalVersionId: string | null;
  versions: Array<{
    id: string;
    title: string;
    language: string;
    ownerScope: string;
    publicationState: string;
    /** The song it's linked to, as a translation or adaptation of it (issue #78). */
    parentVersionId: string | null;
    relationshipType: string | null;
    createdAt: string;
  }>;
  identifiers: WorkIdentifier[];
}

/**
 * `message` is the API's human-readable message when the body is a NestJS
 * error ({ message, code? }), otherwise the raw body; `code` is the
 * machine-readable one, when the API sent one (e.g. STORAGE_LIMIT_EXCEEDED).
 */
export type SubmissionState = "SUBMITTED" | "UNDER_REVIEW" | "NEEDS_CHANGES" | "APPROVED" | "REJECTED" | "WITHDRAWN";

/** A global song that looks like the one being published. */
export interface CatalogueMatch {
  id: string;
  title: string;
  versionName: string | null;
  language: string;
  artists: string[];
  reason: "titleAndArtist" | "title" | "ccli";
}

/** A song put forward for the global catalogue. */
export interface Submission {
  id: string;
  state: SubmissionState;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  submitterMessage: string | null;
  duplicateReason: string | null;
  reviewNotes: string | null;
  mergeTargetId: string | null;
  publishedVersionId: string | null;
  submitter: { id: string; displayName: string; email: string };
  reviewer: { id: string; displayName: string } | null;
  publishedVersion: { id: string; title: string } | null;
  /** Global look-alikes when it was submitted. */
  matches: CatalogueMatch[];
  song: {
    id: string;
    title: string;
    versionName: string | null;
    language: string;
    ownerScope: "GLOBAL" | "TEAM" | "USER";
    ownerUserId: string | null;
    ownerTeamId: string | null;
    teamName: string | null;
    artists: string[];
  };
}

/** Where a song stands with the global catalogue, for its page. */
export interface SongPublication {
  submission: Submission | null;
  /** The global song it's linked to, once approved. */
  published: { id: string; title: string } | null;
  matches: CatalogueMatch[];
  canSubmit: boolean;
  canPublishDirectly: boolean;
}

export class ApiError extends Error {
  readonly code?: string;

  constructor(
    public readonly status: number,
    body: string,
    /** Said instead of the server's message (a 429's, in the reader's language). */
    message?: string,
  ) {
    const parsed = parseErrorBody(body);
    super(message ?? parsed.message ?? body);
    this.name = "ApiError";
    this.code = parsed.code;
  }
}

function parseErrorBody(body: string): { message?: string; code?: string } {
  try {
    const json = JSON.parse(body) as { message?: unknown; code?: unknown };
    const message = Array.isArray(json.message) ? json.message.join(", ") : json.message;
    return {
      message: typeof message === "string" ? message : undefined,
      code: typeof json.code === "string" ? json.code : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Thin fetch wrapper shared by every Songverse client (web now, React
 * Native later — see spec §5 "the web frontend and the React Native app
 * share only the packages/core layer"). Each app supplies its own
 * `getToken`; this client only knows how to attach it and parse JSON.
 */
export function createApiClient({ baseUrl, getToken, onUnauthorized, onChange, rateLimitedMessage }: ApiClientOptions) {
  async function failed(response: Response): Promise<ApiError> {
    if (response.status === 401) onUnauthorized?.();
    return new ApiError(response.status, await response.text(), response.status === 429 ? rateLimitedMessage?.() : undefined);
  }

  /**
   * A read the API refused as one too many (429, issue #113) is tried again
   * once it says it may be (Retry-After), twice at most and never after
   * waiting long: the stems or a page shouldn't fail on a burst the device
   * made itself. Anything that changes something isn't retried.
   */
  async function fetchRetrying(url: string, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, init);
      const wait = Number(response.headers.get("Retry-After"));
      if (response.status !== 429 || (method !== "GET" && method !== "HEAD") || attempt >= 2 || !(wait > 0) || wait > 20) return response;
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    // A FormData body (attachment upload) must NOT get an explicit
    // Content-Type - the browser sets one itself, including the
    // multipart boundary, only when it's left unset.
    if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const response = await fetchRetrying(`${baseUrl}${path}`, { ...init, headers });
    if (!response.ok) throw await failed(response);
    if (init?.method && init.method !== "GET" && init.method !== "HEAD") onChange?.();
    // NestJS sends an empty body (Content-Length: 0) for a handler that
    // returns `null` or `undefined` — not the 4-byte JSON literal "null" —
    // and it does this on a plain 200, not just 204. `response.json()` on
    // an empty body throws ("Unexpected end of JSON input"), so check the
    // raw text first rather than trusting status code alone.
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  return {
    getMe: () => request<UserProfile>("/users/me"),
    /** Omitted fields are left as they are; `instruments`/`techRoles` replace the whole list. */
    updateMe: (data: {
      locale?: string;
      displayName?: string;
      instruments?: string[];
      techRoles?: TechRoleValue[];
      capoDisplayMode?: CapoDisplayModeValue;
      chordNotation?: ChordNotationValue;
      chordDiagrams?: ChordDiagramsValue;
      chordColors?: boolean;
      leftHanded?: boolean;
      guitarTuning?: string;
      ukuleleTuning?: string;
      pianoSmooth?: boolean;
      pianoHands?: string;
      pianoNoteNames?: string;
      liveView?: LiveViewValue;
      /** A mode's display settings (issue #209), merged into what's kept; null back to the account's. */
      displaySettings?: Partial<Record<AppModeValue, { [K in keyof DisplaySettings]?: DisplaySettings[K] | null }>>;
    }) =>
      request<UserProfile>("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
    getMyStorage: () => request<StorageUsage>("/users/me/storage"),
    uploadAvatar: (file: Blob, filename = "avatar") => {
      const form = new FormData();
      form.append("file", file, filename);
      return request<UserProfile>("/users/me/avatar", { method: "PUT", body: form });
    },
    removeAvatar: () => request<UserProfile>("/users/me/avatar", { method: "DELETE" }),
    getTransfer: (token: string) => request<TransferPreview>(`/transfers/${encodeURIComponent(token)}`),
    claimTransfer: (token: string) =>
      request<void>(`/transfers/${encodeURIComponent(token)}/claim`, { method: "POST" }),
    /** Songverse's teams; with `all`, an organisation's groups that only plan too (issue #241). */
    listTeams: (all = false) => request<TeamSummary[]>(all ? "/teams?all=true" : "/teams"),
    createTeam: (data: { name: string; slug?: string; description?: string }) =>
      request<TeamSummary>("/teams", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    getTeam: (teamId: string) => request<TeamSummary>(`/teams/${teamId}`),
    deleteTeam: (teamId: string) => request<void>(`/teams/${teamId}`, { method: "DELETE" }),
    updateTeam: (teamId: string, data: UpdateTeamRequest) => request<TeamSummary>(`/teams/${teamId}`, { method: "PATCH", body: JSON.stringify(data) }),
    /** A team's or a songbook's picture (issue #161), normalised by the API. */
    uploadPicture: (owner: "teams" | "songbooks", id: string, file: Blob, filename = "picture") => {
      const form = new FormData();
      form.append("file", file, filename);
      return request<{ avatarUrl: string }>(`/${owner}/${id}/avatar`, { method: "PUT", body: form });
    },
    removePicture: (owner: "teams" | "songbooks", id: string) => request<void>(`/${owner}/${id}/avatar`, { method: "DELETE" }),
    joinTeamByToken: (token: string) => request<TeamSummary>(`/teams/join/${token}`, { method: "POST" }),
    listTeamMembers: (teamId: string) => request<TeamMember[]>(`/teams/${teamId}/members`),
    updateTeamMemberRole: (teamId: string, memberUserId: string, role: TeamRole) =>
      request<TeamMember>(`/teams/${teamId}/members/${memberUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    removeTeamMember: (teamId: string, memberUserId: string) =>
      request<void>(`/teams/${teamId}/members/${memberUserId}`, { method: "DELETE" }),
    leaveTeam: (teamId: string) => request<void>(`/teams/${teamId}/leave`, { method: "POST" }),
    listTeamInviteLinks: (teamId: string) => request<TeamInviteLink[]>(`/teams/${teamId}/invite-links`),
    createTeamInviteLink: (teamId: string, data: CreateInviteLinkInput) =>
      request<TeamInviteLink>(`/teams/${teamId}/invite-links`, { method: "POST", body: JSON.stringify(data) }),
    revokeTeamInviteLink: (teamId: string, linkId: string) =>
      request<void>(`/teams/${teamId}/invite-links/${linkId}`, { method: "DELETE" }),
    /** The organisation a team is part of (issue #241), or null for none. */
    setTeamOrganization: (teamId: string, organizationId: string | null) =>
      request<TeamSummary>(`/teams/${teamId}/organization`, { method: "PUT", body: JSON.stringify({ organizationId }) }),

    // Organisations (issue #241).
    listMyOrganizations: () => request<MyOrganizations>("/organizations"),
    createOrganization: (data: CreateOrganizationRequest) => request<OrganizationSummary>("/organizations", { method: "POST", body: JSON.stringify(data) }),
    getOrganization: (organizationId: string) => request<OrganizationDetail>(`/organizations/${organizationId}`),
    updateOrganization: (organizationId: string, data: UpdateOrganizationRequest) =>
      request<OrganizationDetail>(`/organizations/${organizationId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteOrganization: (organizationId: string) => request<void>(`/organizations/${organizationId}`, { method: "DELETE" }),
    listOrganizationMembers: (organizationId: string) => request<OrganizationMember[]>(`/organizations/${organizationId}/members`),
    updateOrganizationMemberRole: (organizationId: string, userId: string, role: TeamRole) =>
      request<OrganizationMember>(`/organizations/${organizationId}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    removeOrganizationMember: (organizationId: string, userId: string) => request<void>(`/organizations/${organizationId}/members/${userId}`, { method: "DELETE" }),
    leaveOrganization: (organizationId: string) => request<void>(`/organizations/${organizationId}/leave`, { method: "POST" }),
    listOrganizationInviteLinks: (organizationId: string) => request<TeamInviteLink[]>(`/organizations/${organizationId}/invite-links`),
    createOrganizationInviteLink: (organizationId: string, data: CreateInviteLinkInput) =>
      request<TeamInviteLink>(`/organizations/${organizationId}/invite-links`, { method: "POST", body: JSON.stringify(data) }),
    revokeOrganizationInviteLink: (organizationId: string, linkId: string) => request<void>(`/organizations/${organizationId}/invite-links/${linkId}`, { method: "DELETE" }),
    joinOrganizationByToken: (token: string) => request<OrganizationSummary>(`/organizations/join/${token}`, { method: "POST" }),
    /** A group of the organisation (its admins), run by whoever makes it. */
    createOrganizationGroup: (organizationId: string, data: CreateGroupRequest) =>
      request<TeamSummary>(`/organizations/${organizationId}/groups`, { method: "POST", body: JSON.stringify(data) }),
    /** Whether a team uses Songverse, and the group it's under (its admins). */
    updateTeamGroup: (teamId: string, data: UpdateGroupRequest) => request<TeamSummary>(`/teams/${teamId}/group`, { method: "PATCH", body: JSON.stringify(data) }),
    listTeamPositions: (teamId: string) => request<TeamPosition[]>(`/teams/${teamId}/positions`),
    createTeamPosition: (teamId: string, name: string) => request<TeamPosition>(`/teams/${teamId}/positions`, { method: "POST", body: JSON.stringify({ name }) }),
    renameTeamPosition: (teamId: string, positionId: string, name: string) =>
      request<TeamPosition>(`/teams/${teamId}/positions/${positionId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    deleteTeamPosition: (teamId: string, positionId: string) => request<void>(`/teams/${teamId}/positions/${positionId}`, { method: "DELETE" }),
    /** The positions someone covers in a group: themselves, or its admins. */
    setTeamMemberPositions: (teamId: string, userId: string, positionIds: string[]) =>
      request<{ positionIds: string[] }>(`/teams/${teamId}/members/${userId}/positions`, { method: "PUT", body: JSON.stringify({ positionIds }) }),
    // An organisation's events (issue #241).
    listOrganizationEvents: (organizationId: string) => request<OrganizationEvent[]>(`/organizations/${organizationId}/events`),
    listOrganizationEventDates: (organizationId: string, from: string, to: string) =>
      request<OrganizationEventDate[]>(`/organizations/${organizationId}/event-dates?${new URLSearchParams({ from, to })}`),
    createOrganizationEvent: (organizationId: string, data: CreateOrganizationEventRequest) =>
      request<OrganizationEvent>(`/organizations/${organizationId}/events`, { method: "POST", body: JSON.stringify(data) }),
    updateOrganizationEvent: (organizationId: string, eventId: string, data: UpdateOrganizationEventRequest) =>
      request<OrganizationEvent>(`/organizations/${organizationId}/events/${eventId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteOrganizationEvent: (organizationId: string, eventId: string) => request<void>(`/organizations/${organizationId}/events/${eventId}`, { method: "DELETE" }),
    setOrganizationEventDateCancelled: (organizationId: string, eventId: string, date: string, cancelled: boolean) =>
      request<void>(`/organizations/${organizationId}/events/${eventId}/dates/${date}`, { method: "PATCH", body: JSON.stringify({ cancelled }) }),
    listOrganizationEventPresets: (organizationId: string) => request<OrganizationEventPreset[]>(`/organizations/${organizationId}/event-presets`),
    createOrganizationEventPreset: (organizationId: string, data: OrganizationEventPresetRequest) =>
      request<OrganizationEventPreset>(`/organizations/${organizationId}/event-presets`, { method: "POST", body: JSON.stringify(data) }),
    deleteOrganizationEventPreset: (organizationId: string, presetId: string) => request<void>(`/organizations/${organizationId}/event-presets/${presetId}`, { method: "DELETE" }),
    /** Takes a team out of the organisation (its admins). */
    removeOrganizationTeam: (organizationId: string, teamId: string) => request<void>(`/organizations/${organizationId}/teams/${teamId}`, { method: "DELETE" }),

    // A team's calendar (issue #235).
    listTeamEvents: (teamId: string) => request<TeamEvent[]>(`/teams/${teamId}/events`),
    listTeamEventDates: (teamId: string, from: string, to: string) =>
      request<TeamEventDateSummary[]>(`/teams/${teamId}/event-dates?${new URLSearchParams({ from, to })}`),
    createTeamEvent: (teamId: string, data: CreateTeamEventRequest) =>
      request<TeamEvent>(`/teams/${teamId}/events`, { method: "POST", body: JSON.stringify(data) }),
    updateTeamEvent: (teamId: string, eventId: string, data: UpdateTeamEventRequest) =>
      request<TeamEvent>(`/teams/${teamId}/events/${eventId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteTeamEvent: (teamId: string, eventId: string) => request<void>(`/teams/${teamId}/events/${eventId}`, { method: "DELETE" }),
    updateTeamEventDate: (teamId: string, eventId: string, date: string, data: UpdateTeamEventDateRequest) =>
      request<TeamEventDateSummary>(`/teams/${teamId}/events/${eventId}/dates/${date}`, { method: "PATCH", body: JSON.stringify(data) }),
    ensureTeamEventDateSet: (teamId: string, eventId: string, date: string) =>
      request<{ setlistId: string }>(`/teams/${teamId}/events/${eventId}/dates/${date}/set`, { method: "POST" }),
    answerTeamEventDate: (teamId: string, eventId: string, date: string, data: AnswerEventDateRequest) =>
      request<MyEventAnswer>(`/teams/${teamId}/events/${eventId}/dates/${date}/answer`, { method: "PUT", body: JSON.stringify(data) }),
    clearTeamEventDateAnswer: (teamId: string, eventId: string, date: string) =>
      request<void>(`/teams/${teamId}/events/${eventId}/dates/${date}/answer`, { method: "DELETE" }),
    listTeamEventDateAnswers: (teamId: string, eventId: string, date: string) =>
      request<MemberEventAnswer[]>(`/teams/${teamId}/events/${eventId}/dates/${date}/answers`),
    answerTeamEventDateFor: (teamId: string, eventId: string, date: string, userId: string, data: AnswerEventDateRequest) =>
      request<MyEventAnswer>(`/teams/${teamId}/events/${eventId}/dates/${date}/answers/${userId}`, { method: "PUT", body: JSON.stringify(data) }),
    clearTeamEventDateAnswerFor: (teamId: string, eventId: string, date: string, userId: string) =>
      request<void>(`/teams/${teamId}/events/${eventId}/dates/${date}/answers/${userId}`, { method: "DELETE" }),
    listMyEventDates: (from: string, to: string) => request<MyEventDate[]>(`/users/me/event-dates?${new URLSearchParams({ from, to })}`),
    getMyCalendarFeed: () => request<{ url: string | null }>("/users/me/calendar-feed"),
    resetMyCalendarFeed: () => request<{ url: string }>("/users/me/calendar-feed", { method: "POST" }),
    turnOffMyCalendarFeed: () => request<void>("/users/me/calendar-feed", { method: "DELETE" }),
    getTeamCalendarFeed: (teamId: string) => request<{ url: string | null }>(`/teams/${teamId}/calendar-feed`),
    resetTeamCalendarFeed: (teamId: string) => request<{ url: string }>(`/teams/${teamId}/calendar-feed`, { method: "POST" }),
    turnOffTeamCalendarFeed: (teamId: string) => request<void>(`/teams/${teamId}/calendar-feed`, { method: "DELETE" }),
    listMyAway: () => request<AwayDays[]>("/users/me/away"),
    addMyAway: (data: CreateAwayRequest) => request<AwayDays>("/users/me/away", { method: "POST", body: JSON.stringify(data) }),
    updateMyAway: (id: string, data: UpdateAwayRequest) => request<AwayDays>(`/users/me/away/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    removeMyAway: (id: string) => request<void>(`/users/me/away/${id}`, { method: "DELETE" }),
    listMyNotifications: (before?: string, limit?: number) =>
      request<NotificationPage>(`/users/me/notifications?${new URLSearchParams({ ...(before ? { before } : {}), ...(limit ? { limit: String(limit) } : {}) })}`),
    getMyUnreadNotifications: () => request<{ unread: number }>("/users/me/notifications/unread"),
    getMyNotificationPreferences: () => request<MyNotificationPreferences>("/users/me/notifications/settings"),
    updateMyNotificationPreferences: (data: UpdateNotificationPreferencesRequest) =>
      request<MyNotificationPreferences>("/users/me/notifications/settings", { method: "PUT", body: JSON.stringify(data) }),
    listMyPushDevices: () => request<PushDevice[]>("/users/me/push-subscriptions"),
    addMyPushDevice: (data: CreatePushSubscriptionRequest) => request<PushDevice>("/users/me/push-subscriptions", { method: "POST", body: JSON.stringify(data) }),
    removeMyPushDevice: (id: string) => request<void>(`/users/me/push-subscriptions/${id}`, { method: "DELETE" }),
    testMyPushDevices: () => request<void>("/users/me/push-subscriptions/test", { method: "POST" }),
    markMyNotificationsRead: (ids?: string[]) => request<{ unread: number }>("/users/me/notifications/read", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) }),
    assignTeamEventPart: (teamId: string, eventId: string, date: string, data: AssignPartRequest) =>
      request<LineupPlace>(`/teams/${teamId}/events/${eventId}/dates/${date}/lineup`, { method: "POST", body: JSON.stringify(data) }),
    unassignTeamEventPart: (teamId: string, eventId: string, date: string, assignmentId: string) =>
      request<void>(`/teams/${teamId}/events/${eventId}/dates/${date}/lineup/${assignmentId}`, { method: "DELETE" }),
    respondTeamEventPart: (teamId: string, eventId: string, date: string, assignmentId: string, data: RespondAssignmentRequest) =>
      request<{ id: string; status: AssignmentStatus; note: string | null }>(`/teams/${teamId}/events/${eventId}/dates/${date}/lineup/${assignmentId}/response`, { method: "PUT", body: JSON.stringify(data) }),
    requestTeamEventSwap: (teamId: string, eventId: string, date: string, assignmentId: string, data: RequestSwapRequest = {}) =>
      request<{ id: string; swapRequestedAt: string; notified: number }>(`/teams/${teamId}/events/${eventId}/dates/${date}/lineup/${assignmentId}/swap`, { method: "POST", body: JSON.stringify(data) }),
    cancelTeamEventSwap: (teamId: string, eventId: string, date: string, assignmentId: string) =>
      request<void>(`/teams/${teamId}/events/${eventId}/dates/${date}/lineup/${assignmentId}/swap`, { method: "DELETE" }),
    takeTeamEventSwap: (teamId: string, eventId: string, date: string, assignmentId: string) =>
      request<{ id: string; userId: string; partKey: string; status: AssignmentStatus }>(`/teams/${teamId}/events/${eventId}/dates/${date}/lineup/${assignmentId}/take`, { method: "POST" }),
    listTeamAnswerRequests: (teamId: string) => request<TeamAnswerRequest[]>(`/teams/${teamId}/answer-requests`),
    askTeamForAnswers: (teamId: string, data: CreateAnswerRequestRequest) =>
      request<TeamAnswerRequest & { notified: number }>(`/teams/${teamId}/answer-requests`, { method: "POST", body: JSON.stringify(data) }),
    removeTeamAnswerRequest: (teamId: string, requestId: string) => request<void>(`/teams/${teamId}/answer-requests/${requestId}`, { method: "DELETE" }),
    setTeamEventDateReady: (teamId: string, eventId: string, date: string) =>
      request<{ setReadyAt: string; notified: number }>(`/teams/${teamId}/events/${eventId}/dates/${date}/set-ready`, { method: "POST" }),
    getTeamCalendarSettings: (teamId: string) => request<TeamCalendarSettings>(`/teams/${teamId}/calendar-settings`),
    updateTeamCalendarSettings: (teamId: string, data: TeamCalendarSettings) =>
      request<TeamCalendarSettings>(`/teams/${teamId}/calendar-settings`, { method: "PUT", body: JSON.stringify(data) }),

    listSongbooks: () => request<SongbookSummary[]>("/songbooks"),
    createSongbook: (data: CreateSongbookInput) =>
      request<SongbookSummary>("/songbooks", { method: "POST", body: JSON.stringify(data) }),
    getSongbook: (songbookId: string) => request<SongbookDetail>(`/songbooks/${songbookId}`),
    updateSongbook: (songbookId: string, data: UpdateSongbookInput) =>
      request<SongbookSummary>(`/songbooks/${songbookId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteSongbook: (songbookId: string) => request<void>(`/songbooks/${songbookId}`, { method: "DELETE" }),
    importSongbookFromCatalog: (data: ImportSongbookFromCatalogInput) =>
      request<SongbookSummary>("/songbooks/import-from-catalog", { method: "POST", body: JSON.stringify(data) }),
    materializeSongbookCatalogEntry: (songbookId: string, catalogEntryId: string) =>
      request<SongbookEntry>(`/songbooks/${songbookId}/catalog-entries/${catalogEntryId}/materialize`, {
        method: "POST",
      }),
    addSongbookEntry: (songbookId: string, songVersionId: string, entryCode?: string) =>
      request<SongbookEntry>(`/songbooks/${songbookId}/entries`, {
        method: "POST",
        body: JSON.stringify({ songVersionId, entryCode }),
      }),
    previewBulkUpload: (songbookId: string, filenames: string[], type?: BulkUploadContentType) =>
      request<BulkUploadFileMatch[]>(`/songbooks/${songbookId}/bulk-upload/preview`, {
        method: "POST",
        body: JSON.stringify({ filenames, ...(type && { type }) }),
      }),
    commitBulkUpload: (songbookId: string, type: BulkUploadContentType, files: File[]) => {
      const form = new FormData();
      form.append("type", type);
      for (const file of files) form.append("files", file);
      return request<BulkUploadCommitResult>(`/songbooks/${songbookId}/bulk-upload`, {
        method: "POST",
        body: form,
      });
    },
    removeSongbookEntry: (songbookId: string, entryId: string) =>
      request<void>(`/songbooks/${songbookId}/entries/${entryId}`, { method: "DELETE" }),

    listSongbookCatalogs: () => request<SongbookCatalogSummary[]>("/songbook-catalogs"),
    getSongbookCatalog: (catalogId: string) => request<SongbookCatalogDetail>(`/songbook-catalogs/${catalogId}`),
    createSongbookCatalog: (data: CreateSongbookCatalogInput) =>
      request<SongbookCatalogSummary>("/songbook-catalogs", { method: "POST", body: JSON.stringify(data) }),
    updateSongbookCatalog: (catalogId: string, data: UpdateSongbookCatalogInput) =>
      request<SongbookCatalogSummary>(`/songbook-catalogs/${catalogId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    deleteSongbookCatalog: (catalogId: string) =>
      request<void>(`/songbook-catalogs/${catalogId}`, { method: "DELETE" }),
    addSongbookCatalogEntry: (catalogId: string, data: SongbookCatalogEntryInput & { entryCode: string; title: string }) =>
      request<SongbookCatalogEntry>(`/songbook-catalogs/${catalogId}/entries`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    /** Changes only the fields given. */
    updateSongbookCatalogEntry: (catalogId: string, entryId: string, data: SongbookCatalogEntryInput) =>
      request<SongbookCatalogEntry>(`/songbook-catalogs/${catalogId}/entries/${entryId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    removeSongbookCatalogEntry: (catalogId: string, entryId: string) =>
      request<void>(`/songbook-catalogs/${catalogId}/entries/${entryId}`, { method: "DELETE" }),
    /** A CSV or JSON catalogue file (see docs/songbook-catalog-format.md); `dryRun` previews. */
    importSongbookCatalogEntries: (
      catalogId: string,
      file: { content: string; filename?: string; mode?: "merge" | "replace"; dryRun?: boolean },
    ) =>
      request<SongbookCatalogImportResult>(`/songbook-catalogs/${catalogId}/entries/import`, {
        method: "POST",
        body: JSON.stringify(file),
      }),
    /** A new catalogue, details and entries, from a JSON export. */
    createSongbookCatalogFromFile: (file: { content: string; filename?: string }) =>
      request<{ catalog: SongbookCatalogSummary; import: SongbookCatalogImportResult }>("/songbook-catalogs/import", {
        method: "POST",
        body: JSON.stringify(file),
      }),
    exportSongbookCatalog: async (catalogId: string, format: "csv" | "json"): Promise<Blob> => {
      const token = await getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(`${baseUrl}/songbook-catalogs/${catalogId}/export?format=${format}`, { headers });
      if (!response.ok) throw await failed(response);
      return response.blob();
    },

    getWork: (workId: string) => request<WorkDetail>(`/works/${workId}`),
    listSongVersions: (query: ListSongVersionsQuery = {}) => {
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value !== undefined && value !== "")
          .map(([key, value]) => [key, String(value)]),
      );
      return request<SongPage>(`/song-versions${params.size ? `?${params}` : ""}`);
    },
    getLibraryHome: () => request<LibraryHome>("/library/home"),
    getArtworkCandidates: (songVersionId: string) => request<ArtworkCandidate[]>(`/song-versions/${songVersionId}/artwork/candidates`),
    setArtwork: (songVersionId: string, url: string) => request<void>(`/song-versions/${songVersionId}/artwork`, { method: "PUT", body: JSON.stringify({ url }) }),
    clearArtwork: (songVersionId: string) => request<void>(`/song-versions/${songVersionId}/artwork`, { method: "DELETE" }),
    getArtworkSettings: () => request<ArtworkSettings>("/admin/artwork"),
    saveArtworkSettings: (change: { enabled?: boolean; country?: string }) => request<ArtworkSettings>("/admin/artwork", { method: "PUT", body: JSON.stringify(change) }),
    resetArtworkSettings: () => request<ArtworkSettings>("/admin/artwork", { method: "DELETE" }),
    /** An image of the editor's own for the song (issue #88). */
    uploadArtwork: (songVersionId: string, file: Blob, filename = "artwork") => {
      const form = new FormData();
      form.append("file", file, filename);
      return request<void>(`/song-versions/${songVersionId}/artwork/upload`, { method: "POST", body: form });
    },
    /** Starts finding artwork for songs without one, as a background job (issue #92); false when one is already waiting or running. */
    backfillArtwork: () => request<{ queued: boolean; jobId: string | null }>("/admin/artwork/backfill", { method: "POST" }),
    backfillRepeats: (data: RepeatsBackfillRequest) => request<{ queued: boolean; jobId: string | null }>("/admin/repeats/backfill", { method: "POST", body: JSON.stringify(data) }),
    /** Who runs background jobs, each queue's counts and the last jobs (issue #92). */
    getJobsStatus: () => request<JobsStatus>("/admin/jobs"),
    /** Clears the failed jobs, once their errors have been read (issue #93). */
    clearFailedJobs: () => request<{ cleared: number }>("/admin/jobs/failed", { method: "DELETE" }),
    runScheduledJob: (name: "make-event-sets" | "event-reminders" | "clean-up-notifications") => request<{ queued: string }>(`/admin/jobs/run/${name}`, { method: "POST" }),
    /** The songs before and after one in a list of the library, searched and filtered as `query` says (issue #84). */
    getSongNeighbors: (songVersionId: string, query: ListSongVersionsQuery = {}) => {
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(([key, value]) => value !== undefined && value !== "" && key !== "page" && key !== "pageSize")
          .map(([key, value]) => [key, String(value)]),
      );
      return request<SongNeighbors>(`/song-versions/${songVersionId}/neighbors${params.size ? `?${params}` : ""}`);
    },
    /** The user opened the song (Recently viewed, and their teams' Popular). */
    recordSongView: (songVersionId: string) => request<void>(`/song-versions/${songVersionId}/views`, { method: "POST" }),
    setFavorite: (songVersionId: string, on: boolean) => request<void>(`/song-versions/${songVersionId}/favorite`, { method: on ? "PUT" : "DELETE" }),
    listArtists: (q?: string) => request<ArtistCount[]>(`/song-versions/artists${q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`),
    getArtist: (name: string) => request<ArtistDetail>(`/artists/detail?${new URLSearchParams({ name })}`),
    /** Asks the providers about them: once for anyone, again (`force`) for admins. */
    lookUpArtist: (name: string, force = false) => request<ArtistDetail>("/artists/lookup", { method: "POST", body: JSON.stringify({ name, force }) }),
    uploadArtistPicture: (name: string, file: Blob, filename = "artist.webp") => {
      const form = new FormData();
      form.append("file", file, filename);
      return request<void>(`/artists/picture?${new URLSearchParams({ name })}`, { method: "POST", body: form });
    },
    removeArtistPicture: (name: string) => request<void>(`/artists/picture?${new URLSearchParams({ name })}`, { method: "DELETE" }),
    /** An empty text removes the bio written here. */
    saveArtistBio: (name: string, language: string, text: string) =>
      request<void>("/artists/bio", { method: "PUT", body: JSON.stringify({ name, language, text }) }),
    getArtistSettings: () => request<ArtistSettings>("/admin/artists"),
    saveArtistSettings: (enabled: boolean) => request<ArtistSettings>("/admin/artists", { method: "PUT", body: JSON.stringify({ enabled }) }),
    resetArtistSettings: () => request<ArtistSettings>("/admin/artists", { method: "DELETE" }),
    backfillArtists: () => request<{ queued: boolean; jobId: string | null }>("/admin/artists/backfill", { method: "POST" }),
    listSmartLists: () => request<SmartList[]>("/smart-lists"),
    createSmartList: (name: string, filters: SmartListFilters) => request<SmartList>("/smart-lists", { method: "POST", body: JSON.stringify({ name, filters }) }),
    updateSmartList: (id: string, change: { name?: string; filters?: SmartListFilters }) =>
      request<SmartList>(`/smart-lists/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
    deleteSmartList: (id: string) => request<void>(`/smart-lists/${id}`, { method: "DELETE" }),
    getSongStats: () => request<{ songCount: number; artistCount: number }>("/song-versions/stats"),
    getSongVersion: (songVersionId: string) => request<SongVersionDetail>(`/song-versions/${songVersionId}`),
    getSongVersionSongbooks: (songVersionId: string) =>
      request<SongVersionSongbookMembership[]>(`/song-versions/${songVersionId}/songbooks`),
    listAttachments: (songVersionId: string) => request<Attachment[]>(`/song-versions/${songVersionId}/attachments`),
    /** A file of your own on the song; only you see it unless `audience` says otherwise (issue #72). */
    uploadAttachment: (songVersionId: string, type: AttachmentType, file: File, stemPart?: StemPart | null, audience?: AttachmentAudience, recording?: RecordingDetails) => {
      const form = new FormData();
      form.append("type", type);
      if (stemPart) form.append("stemPart", stemPart);
      if (audience) form.append("visibility", audience.visibility);
      if (audience?.teamId) form.append("teamId", audience.teamId);
      for (const [field, value] of Object.entries(recording ?? {})) if (value !== null && value !== undefined) form.append(field, String(value));
      form.append("file", file);
      return request<Attachment>(`/song-versions/${songVersionId}/attachments`, { method: "POST", body: form });
    },
    /** An audio file's part (a stem) and its recording's key and tempo; what's left out stays, null clears. */
    updateAttachment: (
      songVersionId: string,
      attachmentId: string,
      change: { stemPart?: StemPart | null; visibility?: AttachmentVisibility; teamId?: string | null } & { [K in Exclude<keyof RecordingDetails, "process" | "otherTake">]?: RecordingDetails[K] | null } & { otherTake?: boolean; cuePoints?: CuePoint[] | null; locked?: boolean; confirmDetected?: true },
    ) => request<Attachment>(`/song-versions/${songVersionId}/attachments/${attachmentId}`, { method: "PATCH", body: JSON.stringify(change) }),
    /** Cleans up an audio file afterwards (issue #132): RNNoise on a voice, its level, its noise - in the background, back as Opus. */
    processAttachment: (songVersionId: string, attachmentId: string, steps: ("voice" | "level" | "noise")[]) =>
      request<Attachment>(`/song-versions/${songVersionId}/attachments/${attachmentId}/process`, { method: "POST", body: JSON.stringify({ steps }) }),
    /** Plays this take of its part (issue #127), instead of `instead` (kept as another take) if given; answers the song's files. */
    useTake: (songVersionId: string, attachmentId: string, instead: string | null = null) =>
      request<Attachment[]>(`/song-versions/${songVersionId}/attachments/${attachmentId}/use-take`, { method: "POST", body: JSON.stringify({ instead }) }),
    deleteAttachment: (songVersionId: string, attachmentId: string) =>
      request<void>(`/song-versions/${songVersionId}/attachments/${attachmentId}`, { method: "DELETE" }),
    /** The file; `onProgress` hears each chunk as it arrives (bytes so far, and the size if the server says). */
    downloadAttachment: async (
      songVersionId: string,
      attachmentId: string,
      onProgress?: (received: number, total: number | null) => void,
    ): Promise<Blob> => {
      const token = await getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetchRetrying(`${baseUrl}/song-versions/${songVersionId}/attachments/${attachmentId}/download`, { headers });
      if (!response.ok) throw await failed(response);
      if (!onProgress || !response.body) return response.blob();
      const total = Number(response.headers.get("Content-Length")) || null;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress(received, total);
      }
      return new Blob(chunks as BlobPart[], { type: response.headers.get("Content-Type") ?? undefined });
    },
    /** A lossless upload's original, as FLAC (issue #182), when one was kept (`original` on the file). */
    downloadAttachmentOriginal: async (songVersionId: string, attachmentId: string): Promise<Blob> => {
      const token = await getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetchRetrying(`${baseUrl}/song-versions/${songVersionId}/attachments/${attachmentId}/original`, { headers });
      if (!response.ok) throw await failed(response);
      return response.blob();
    },
    /**
     * A short-lived link to the file (issue #33), for an <audio src> that
     * streams and seeks without the Bearer token. Ask again once it expires.
     */
    getAttachmentLink: async (songVersionId: string, attachmentId: string): Promise<{ url: string; expiresAt: string }> => {
      const { path, expiresAt } = await request<{ path: string; expiresAt: string }>(`/song-versions/${songVersionId}/attachments/${attachmentId}/link`, { method: "POST" });
      return { url: `${baseUrl}${path}`, expiresAt };
    },
    /**
     * A resized WebP rendition of an image attachment. `width` snaps up to
     * one of 32-2048 on the server, and images are never enlarged.
     */
    getAttachmentImage: async (songVersionId: string, attachmentId: string, width: number): Promise<Blob> => {
      const token = await getToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(
        `${baseUrl}/song-versions/${songVersionId}/attachments/${attachmentId}/image?w=${width}`,
        { headers },
      );
      if (!response.ok) throw await failed(response);
      return response.blob();
    },
    listSetlists: () => request<SetlistSummary[]>("/setlists"),
    createSetlist: (data: { name?: string; eventDate?: string; teamId?: string }) =>
      request<SetlistSummary>("/setlists", { method: "POST", body: JSON.stringify(data) }),
    getSetlist: (setlistId: string) => request<SetlistDetail>(`/setlists/${setlistId}`),
    /** `teamId` moves the set to that team, or (null) makes it the current user's personal set. */
    updateSetlist: (setlistId: string, data: { name?: string | null; eventDate?: string | null; teamId?: string | null }) =>
      request<SetlistDetail>(`/setlists/${setlistId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteSetlist: (setlistId: string) => request<void>(`/setlists/${setlistId}`, { method: "DELETE" }),
    searchSetlistSongs: (setlistId: string, query: string) =>
      request<SetlistSongRef[]>(`/setlists/${setlistId}/song-candidates?q=${encodeURIComponent(query)}`),
    addSetlistItem: (setlistId: string, data: z.input<typeof AddSetlistItemSchema>) =>
      request<SetlistDetail>(`/setlists/${setlistId}/items`, { method: "POST", body: JSON.stringify(data) }),
    updateSetlistItem: (
      setlistId: string,
      itemId: string,
      data: UpdateSetlistItemRequest,
    ) => request<SetlistDetail>(`/setlists/${setlistId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    /** The current user's own preferences for this song as the set plays it (guests too). */
    setSetlistChartPreferences: (setlistId: string, itemId: string, preferences: Partial<ChartPreferences>) =>
      request<ChartPreferences>(`/setlists/${setlistId}/items/${itemId}/chart-preferences`, {
        method: "PUT",
        body: JSON.stringify({ preferences }),
      }),
    /** Gives a song of the set its own arrangement for this set (a copy of the one it played, or the song's order) and plays it. */
    createSetArrangement: (setlistId: string, itemId: string, name: string) =>
      request<{ arrangementId: string }>(`/setlists/${setlistId}/items/${itemId}/set-arrangement`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    listArrangements: (songVersionId: string) => request<ArrangementSummary[]>(`/song-versions/${songVersionId}/arrangements`),
    /** A new arrangement: the song's order to start with, or a copy of `copyFromId`; a team's when `teamId` is given. */
    createArrangement: (songVersionId: string, data: { name: string; description?: string | null; teamId?: string; copyFromId?: string }) =>
      request<ArrangementDetail>(`/song-versions/${songVersionId}/arrangements`, { method: "POST", body: JSON.stringify(data) }),
    getArrangement: (arrangementId: string) => request<ArrangementDetail>(`/arrangements/${arrangementId}`),
    /** Omitted fields are left alone; `updatedAt` (as loaded) refuses a save over a newer one (409). */
    updateArrangement: (
      arrangementId: string,
      data: { name?: string; description?: string | null; document?: ArrangementDocumentV2; isTeamDefault?: boolean; updatedAt?: string },
    ) => request<ArrangementDetail>(`/arrangements/${arrangementId}`, { method: "PATCH", body: JSON.stringify(data) }),
    markArrangementReviewed: (arrangementId: string) => request<ArrangementDetail>(`/arrangements/${arrangementId}/reviewed`, { method: "POST" }),
    deleteArrangement: (arrangementId: string) => request<void>(`/arrangements/${arrangementId}`, { method: "DELETE" }),
    /** Songs whose chords go like `q` ("1 5 6m 4"), in any key (issue #204). */
    searchProgressions: (q: string) =>
      request<{ query: string[] | null; songs: (SongVersionSummary & { sections: SectionProgression[] })[] }>(`/progressions/search?q=${encodeURIComponent(q)}`),
    /** A song's progressions, and the songs that move most like it (issue #204). */
    getSongProgressions: (songVersionId: string) =>
      request<{ sections: SectionProgression[]; similar: (SongVersionSummary & { score: number; shared: string[] })[] }>(`/progressions/songs/${songVersionId}`),
    /** The shapes this player chose for the song's chords (issue #207). */
    getChordShapeChoices: (songVersionId: string) => request<ChordShapeChoice[]>(`/song-versions/${songVersionId}/chord-shapes`),
    /** Keeps a shape for a chord of the song (frets null: back to the usual one); all of the song's choices back. */
    chooseChordShape: (songVersionId: string, choice: { instrument: "guitar" | "ukulele" | "piano"; tuning: string; chord: string; frets: string | null }) =>
      request<ChordShapeChoice[]>(`/song-versions/${songVersionId}/chord-shapes`, { method: "PUT", body: JSON.stringify(choice) }),
    getChartPreferences: (songVersionId: string, arrangementId?: string | null) =>
      request<ChartPreferences>(`/chart-preferences?songVersionId=${songVersionId}${arrangementId ? `&arrangementId=${arrangementId}` : ""}`),
    saveChartPreferences: (songVersionId: string, arrangementId: string | null, preferences: Partial<ChartPreferences>) =>
      request<ChartPreferences>("/chart-preferences", { method: "PUT", body: JSON.stringify({ songVersionId, arrangementId, preferences }) }),
    removeSetlistItem: (setlistId: string, itemId: string) =>
      request<SetlistDetail>(`/setlists/${setlistId}/items/${itemId}`, { method: "DELETE" }),
    getSetlistSong: (setlistId: string, itemId: string) => request<SetlistSongView>(`/setlists/${setlistId}/items/${itemId}/song`),
    getSetlistOffline: (setlistId: string) => request<SetlistOfflineCopy>(`/setlists/${setlistId}/offline`),
    syncOffline: (body: {
      days?: number;
      known: { id: string; version: string }[];
      knownSongs?: { id: string; version: string }[];
      knownSongbooks?: { id: string; version: string }[];
    }) => request<OfflineSyncResponse>("/offline/sync", { method: "POST", body: JSON.stringify(body) }),
    /** The same sync, asking first whether anything changed (issue #121). */
    checkOffline: (body: { days?: number; fingerprint: string; known: { id: string; version: string }[] }) =>
      request<OfflineSyncCheck>("/offline/sync", { method: "POST", body: JSON.stringify(body) }),
    listOfflinePins: () => request<OfflinePin[]>("/offline/pins"),
    pinOffline: (kind: OfflinePinKind, targetId: string, includeAudio = false) =>
      request<OfflinePin>("/offline/pins", { method: "PUT", body: JSON.stringify({ kind, targetId, includeAudio }) }),
    unpinOffline: (kind: OfflinePinKind, targetId: string) => request<void>(`/offline/pins/${kind}/${targetId}`, { method: "DELETE" }),
    getOfflineSongs: (ids: string[]) => request<SongOfflineCopy[]>("/offline/songs", { method: "POST", body: JSON.stringify({ ids }) }),
    getSongbookOffline: (songbookId: string) => request<SongbookOfflineCopy>(`/offline/songbooks/${songbookId}`),
    /** Entries by number (issue #213): exactly it, then starting with it, then containing it; `more` for Show more. */
    searchSongbookEntries: (q: string, more = false) => request<SongbookEntryHit[]>(`/songbook-entries?q=${encodeURIComponent(q)}${more ? "&more=true" : ""}`),
    /** The notes one sees on a song (issue #256), opened in a set or not, and where a new one may go. */
    getSongNotes: (songVersionId: string, context: { setlistId?: string; songbookId?: string } = {}) => {
      const query = new URLSearchParams(Object.entries(context).filter((entry): entry is [string, string] => !!entry[1]));
      return request<SongNotes>(`/song-versions/${songVersionId}/notes${query.size ? `?${query}` : ""}`);
    },
    createNote: (body: CreateNoteRequest) => request<SongNote>("/notes", { method: "POST", body: JSON.stringify(body) }),
    updateNote: (noteId: string, body: UpdateNoteRequest) => request<SongNote>(`/notes/${noteId}`, { method: "PATCH", body: JSON.stringify(body) }),
    deleteNote: (noteId: string) => request<void>(`/notes/${noteId}`, { method: "DELETE" }),
    replyToNote: (noteId: string, content: string) => request<SongNote>(`/notes/${noteId}/replies`, { method: "POST", body: JSON.stringify({ content }) }),
    updateNoteReply: (noteId: string, replyId: string, content: string) =>
      request<SongNote>(`/notes/${noteId}/replies/${replyId}`, { method: "PATCH", body: JSON.stringify({ content }) }),
    deleteNoteReply: (noteId: string, replyId: string) => request<SongNote>(`/notes/${noteId}/replies/${replyId}`, { method: "DELETE" }),
    requestSongOwnership: (setlistId: string, itemId: string) =>
      request<SetlistDetail>(`/setlists/${setlistId}/items/${itemId}/ownership-request`, { method: "POST" }),
    getSetlistSharing: (setlistId: string) => request<SetlistSharing>(`/setlists/${setlistId}/sharing`),
    /** Turns the share link on, or replaces it (the old one stops working). */
    resetSetlistShareLink: (setlistId: string) => request<SetlistSharing>(`/setlists/${setlistId}/share-link`, { method: "POST" }),
    removeSetlistShareLink: (setlistId: string) => request<SetlistSharing>(`/setlists/${setlistId}/share-link`, { method: "DELETE" }),
    removeSetlistGuest: (setlistId: string, userId: string) =>
      request<SetlistSharing>(`/setlists/${setlistId}/guests/${userId}`, { method: "DELETE" }),
    leaveSetlist: (setlistId: string) => request<void>(`/setlists/${setlistId}/leave`, { method: "POST" }),
    getSetInvite: (token: string) => request<SetInvitePreview>(`/set-invites/${encodeURIComponent(token)}`),
    joinSetInvite: (token: string) =>
      request<{ setlistId: string }>(`/set-invites/${encodeURIComponent(token)}/join`, { method: "POST" }),
    listOwnershipRequests: () => request<SongOwnershipRequest[]>("/ownership-requests"),
    acceptOwnershipRequest: (requestId: string) => request<void>(`/ownership-requests/${requestId}/accept`, { method: "POST" }),
    declineOwnershipRequest: (requestId: string) => request<void>(`/ownership-requests/${requestId}/decline`, { method: "POST" }),
    reorderSetlistItems: (setlistId: string, itemIds: string[]) =>
      request<SetlistDetail>(`/setlists/${setlistId}/items/order`, { method: "PUT", body: JSON.stringify({ itemIds }) }),
    createSongVersion: (data: CreateSongVersionInput) =>
      request<SongVersionSummary>("/song-versions", { method: "POST", body: JSON.stringify(data) }),
    updateSongVersion: (songVersionId: string, data: UpdateSongVersionInput) =>
      request<SongVersionDetail>(`/song-versions/${songVersionId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteSongVersion: (songVersionId: string) =>
      request<void>(`/song-versions/${songVersionId}`, { method: "DELETE" }),
    /** A change to a catalogue song, made as the song editor would save it, for a reviewer to accept (issue #74). */
    suggestChange: (songVersionId: string, data: UpdateSongVersionInput & { message?: string }) =>
      request<Suggestion>(`/song-versions/${songVersionId}/suggestions`, { method: "POST", body: JSON.stringify(data) }),
    /** Your own suggestions on a song. */
    listSongSuggestions: (songVersionId: string) => request<Suggestion[]>(`/song-versions/${songVersionId}/suggestions`),
    listSuggestions: (state: "open" | "closed" = "open") => request<Suggestion[]>(`/suggestions?state=${state}`),
    mySuggestions: () => request<Suggestion[]>("/suggestions/mine"),
    getSuggestion: (id: string) => request<SuggestionDetail>(`/suggestions/${id}`),
    acceptSuggestion: (id: string, notes?: string) =>
      request<Suggestion>(`/suggestions/${id}/accept`, { method: "POST", body: JSON.stringify({ notes }) }),
    declineSuggestion: (id: string, notes: string) =>
      request<Suggestion>(`/suggestions/${id}/decline`, { method: "POST", body: JSON.stringify({ notes }) }),
    withdrawSuggestion: (id: string) => request<Suggestion>(`/suggestions/${id}/withdraw`, { method: "POST" }),
    getPeople: () => request<PeopleOverview>("/people"),
    /** Asks someone to connect, by email or (someone from your teams) id; `connected` when they'd already asked you. */
    requestConnection: (to: { email?: string; userId?: string }) =>
      request<{ connected: boolean }>("/people/requests", { method: "POST", body: JSON.stringify(to) }),
    acceptConnection: (id: string) => request<void>(`/people/requests/${id}/accept`, { method: "POST" }),
    declineConnection: (id: string) => request<void>(`/people/requests/${id}/decline`, { method: "POST" }),
    cancelConnection: (id: string) => request<void>(`/people/requests/${id}`, { method: "DELETE" }),
    removePerson: (userId: string) => request<void>(`/people/${userId}`, { method: "DELETE" }),
    getSongShares: (songVersionId: string) => request<SongShare[]>(`/song-versions/${songVersionId}/shares`),
    shareSong: (songVersionId: string, userId: string, canEdit: boolean) =>
      request<SongShare[]>(`/song-versions/${songVersionId}/shares/${userId}`, { method: "PUT", body: JSON.stringify({ canEdit }) }),
    unshareSong: (songVersionId: string, userId: string) => request<void>(`/song-versions/${songVersionId}/shares/${userId}`, { method: "DELETE" }),
    getSongbookShares: (songbookId: string) => request<SongbookShare[]>(`/songbooks/${songbookId}/shares`),
    shareSongbook: (songbookId: string, to: { userId: string } | { teamId: string }, canEdit: boolean) =>
      request<SongbookShare[]>(`/songbooks/${songbookId}/shares/${"userId" in to ? `users/${to.userId}` : `teams/${to.teamId}`}`, { method: "PUT", body: JSON.stringify({ canEdit }) }),
    unshareSongbook: (songbookId: string, to: { userId: string } | { teamId: string }) =>
      request<SongbookShare[]>(`/songbooks/${songbookId}/shares/${"userId" in to ? `users/${to.userId}` : `teams/${to.teamId}`}`, { method: "DELETE" }),
    /** Takes a songbook shared with you out of your songbooks. */
    leaveSharedSongbook: (songbookId: string) => request<void>(`/songbooks/${songbookId}/shares/users/me`, { method: "DELETE" }),
    /** Takes a song shared with you out of your library. */
    leaveSharedSong: (songVersionId: string) => request<void>(`/song-versions/${songVersionId}/shares/me`, { method: "DELETE" }),
    getSongHistory: (songVersionId: string) => request<SongRevisionEntry[]>(`/song-versions/${songVersionId}/history`),
    /** Its sections that repeat an earlier one (issue #231), for its editors. */
    getSongRepeats: (songVersionId: string) => request<{ revision: number; repeats: SongRepeat[] }>(`/song-versions/${songVersionId}/repeats`),
    linkSongRepeats: (songVersionId: string, data: LinkRepeatsRequest) =>
      request<{ linked: number; revision: number }>(`/song-versions/${songVersionId}/repeats`, { method: "POST", body: JSON.stringify(data) }),
    getSongRevision: (songVersionId: string, revisionId: string) =>
      request<SongRevisionDetail>(`/song-versions/${songVersionId}/history/${revisionId}`),
    restoreSongRevision: (songVersionId: string, revisionId: string) =>
      request<SongVersionDetail>(`/song-versions/${songVersionId}/history/${revisionId}/restore`, { method: "POST" }),
    searchCredits: (query: string) => request<CreditSuggestion[]>(`/song-versions/credits?q=${encodeURIComponent(query)}`),
    findSongMatches: (title: string) => request<SongMatch[]>(`/song-versions/matches?title=${encodeURIComponent(title)}`),
    exportChordPro: (songVersionId: string) =>
      request<{ content: string }>(`/song-versions/${songVersionId}/chordpro`),
    setStreamingLink: (songVersionId: string, type: StreamingLinkType, url: string) =>
      request<SongVersionLink>(`/song-versions/${songVersionId}/links/${type}`, {
        method: "PUT",
        body: JSON.stringify({ url }),
      }),
    removeStreamingLink: (songVersionId: string, type: StreamingLinkType) =>
      request<void>(`/song-versions/${songVersionId}/links/${type}`, { method: "DELETE" }),
    listTagCategories: () => request<TagCategory[]>("/tags/categories"),
    listTags: () => request<Tag[]>("/tags"),
    /** Auto detect's search across the metadata providers that are on, merged and ranked (issue #22). */
    searchMetadata: (title: string, artist?: string) => {
      const params = new URLSearchParams({ title });
      if (artist) params.set("artist", artist);
      return request<MetadataSearchResult>(`/metadata/search?${params}`);
    },
    /** Which services a song's links can be searched at (issue #169). */
    linkSearchServices: () => request<LinkSearchServices>("/metadata/links"),
    /** A song looked up at one service, for its link (issue #169). */
    searchLinks: (type: StreamingLinkType, title: string, artist?: string) => {
      const params = new URLSearchParams({ title });
      if (artist) params.set("artist", artist);
      return request<LinkCandidate[]>(`/metadata/links/${type}/search?${params}`);
    },
    searchMusicBrainzWorks: (title: string) =>
      request<MusicBrainzWorkMatch[]>(`/musicbrainz/works/search?${new URLSearchParams({ title })}`),

    getSongMetadata: (songVersionId: string) => request<MetadataMatch | null>(`/song-versions/${songVersionId}/metadata`),
    /** Links a match (looked up again from its sources): its streaming links and artwork come with it. */
    linkSongMetadata: (songVersionId: string, match: Pick<MetadataMatch, "sources">) =>
      request<MetadataMatch>(`/song-versions/${songVersionId}/metadata-link`, {
        method: "POST",
        body: JSON.stringify({ sources: match.sources.map(({ provider, id }) => ({ provider, id })) }),
      }),
    unlinkSongMetadata: (songVersionId: string) => request<void>(`/song-versions/${songVersionId}/metadata-link`, { method: "DELETE" }),
    getMetadataSettings: () => request<MetadataSettings>("/admin/metadata"),
    saveMetadataSettings: (providers: ({ key: MetadataProviderKey } & Partial<Record<MetadataCapability, boolean>>)[]) =>
      request<MetadataSettings>("/admin/metadata", { method: "PUT", body: JSON.stringify({ providers }) }),
    resetMetadataSettings: () => request<MetadataSettings>("/admin/metadata", { method: "DELETE" }),
    /** A field left out keeps its value; an empty one clears it. */
    saveAppleMusicKey: (key: { teamId?: string; keyId?: string; privateKey?: string; tokenUrl?: string }) =>
      request<MetadataSettings>("/admin/metadata/apple-music", { method: "PUT", body: JSON.stringify(key) }),
    resetAppleMusicKey: () => request<MetadataSettings>("/admin/metadata/apple-music", { method: "DELETE" }),
    testAppleMusicKey: () => request<{ ok: boolean; message: string }>("/admin/metadata/apple-music/test", { method: "POST" }),
    /** Spotify's developer app (issue #89): a field left out keeps its value; an empty one clears it. */
    saveSpotifyApp: (app: { clientId?: string; clientSecret?: string; market?: string }) =>
      request<MetadataSettings>("/admin/metadata/spotify", { method: "PUT", body: JSON.stringify(app) }),
    resetSpotifyApp: () => request<MetadataSettings>("/admin/metadata/spotify", { method: "DELETE" }),
    testSpotifyApp: () => request<{ ok: boolean; message: string }>("/admin/metadata/spotify/test", { method: "POST" }),
    /** The YouTube Data API's key (issue #169); empty clears it. */
    saveYouTubeKey: (apiKey: string) => request<MetadataSettings>("/admin/metadata/youtube", { method: "PUT", body: JSON.stringify({ apiKey }) }),
    resetYouTubeKey: () => request<MetadataSettings>("/admin/metadata/youtube", { method: "DELETE" }),
    testYouTubeKey: () => request<{ ok: boolean; message: string }>("/admin/metadata/youtube/test", { method: "POST" }),
    /** Which outside Bible providers are set up (issue #304). */
    getScriptureProviders: () => request<{ youversion: boolean }>("/scriptures/providers"),
    getYouVersionBibles: (language: string) => request<YouVersionBible[]>(`/scriptures/youversion/bibles?${new URLSearchParams({ language })}`),
    getYouVersionPassage: (bibleId: number, reference: string) =>
      request<YouVersionPassage>(`/scriptures/youversion/bibles/${bibleId}/passage?${new URLSearchParams({ reference })}`),
    /** Bibles imported from files (issue #301): those anyone can read, and a passage of one. */
    listBibles: () => request<ImportedBible[]>("/scriptures/bibles"),
    getBiblePassage: (bibleId: string, reference: string) =>
      request<BiblePassage>(`/scriptures/bibles/${encodeURIComponent(bibleId)}/passage?${new URLSearchParams({ reference })}`),
    /** The admin's: every imported Bible, a file to import (by the Worker), its details and rights, deleting one. */
    listAdminBibles: () => request<AdminBible[]>("/admin/scriptures/bibles"),
    importBible: (file: Blob, filename = "bible.xml") => {
      const form = new FormData();
      form.append("file", file, filename);
      return request<AdminBible>("/admin/scriptures/bibles", { method: "POST", body: form });
    },
    updateBible: (bibleId: string, data: z.input<typeof BibleUpdateSchema>) =>
      request<AdminBible>(`/admin/scriptures/bibles/${encodeURIComponent(bibleId)}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteBible: (bibleId: string) => request<void>(`/admin/scriptures/bibles/${encodeURIComponent(bibleId)}`, { method: "DELETE" }),
    /** YouVersion's App Key (issue #304); empty clears it. */
    getYouVersionSettings: () => request<YouVersionSettings>("/admin/scriptures/youversion"),
    saveYouVersionKey: (appKey: string) => request<YouVersionSettings>("/admin/scriptures/youversion", { method: "PUT", body: JSON.stringify({ appKey }) }),
    resetYouVersionKey: () => request<YouVersionSettings>("/admin/scriptures/youversion", { method: "DELETE" }),
    testYouVersionKey: () => request<{ ok: boolean; message: string }>("/admin/scriptures/youversion/test", { method: "POST" }),
    /** MusicBrainz's contact, in its User-Agent; empty goes back to MUSICBRAINZ_CONTACT. */
    saveMusicBrainzContact: (contact: string) => request<MetadataSettings>("/admin/metadata/musicbrainz", { method: "PUT", body: JSON.stringify({ contact }) }),

    getWorkMusicBrainz: (workId: string) => request<MusicBrainzWorkMatch | null>(`/works/${workId}/musicbrainz`),
    linkWorkMusicBrainz: (workId: string, mbid: string) =>
      request<MusicBrainzWorkMatch>(`/works/${workId}/musicbrainz-link`, {
        method: "POST",
        body: JSON.stringify({ mbid }),
      }),
    unlinkWorkMusicBrainz: (workId: string) =>
      request<void>(`/works/${workId}/musicbrainz-link`, { method: "DELETE" }),

    adminMigrationStatus: () => request<AdminCommandResult>("/admin/migrations/status"),
    adminRunSeed: () => request<AdminCommandResult>("/admin/seed", { method: "POST" }),
    getSongPublication: (songVersionId: string) => request<SongPublication>(`/song-versions/${songVersionId}/publication`),
    submitSong: (songVersionId: string, data: { message?: string; duplicateReason?: string }) =>
      request<Submission>(`/song-versions/${songVersionId}/submissions`, { method: "POST", body: JSON.stringify(data) }),
    /** Global admins: into the catalogue without a review. */
    publishSong: (songVersionId: string, data: { duplicateReason?: string; trustLabel?: string }) =>
      request<Submission>(`/song-versions/${songVersionId}/publish`, { method: "POST", body: JSON.stringify(data) }),
    /** The review queue (reviewers and global admins). */
    listSubmissions: (state: "open" | "closed" = "open") => request<Submission[]>(`/submissions?state=${state}`),
    mySubmissions: () => request<Submission[]>("/submissions/mine"),
    getSubmission: (submissionId: string) => request<Submission>(`/submissions/${submissionId}`),
    withdrawSubmission: (submissionId: string) => request<Submission>(`/submissions/${submissionId}/withdraw`, { method: "POST" }),
    resubmitSubmission: (submissionId: string, data: { message?: string }) =>
      request<Submission>(`/submissions/${submissionId}/resubmit`, { method: "POST", body: JSON.stringify(data) }),
    startReview: (submissionId: string) => request<Submission>(`/submissions/${submissionId}/start-review`, { method: "POST" }),
    approveSubmission: (submissionId: string, data: { notes?: string; trustLabel?: string }) =>
      request<Submission>(`/submissions/${submissionId}/approve`, { method: "POST", body: JSON.stringify(data) }),
    mergeSubmission: (submissionId: string, data: { targetId: string; notes?: string }) =>
      request<Submission>(`/submissions/${submissionId}/merge`, { method: "POST", body: JSON.stringify(data) }),
    requestSubmissionChanges: (submissionId: string, notes: string) =>
      request<Submission>(`/submissions/${submissionId}/request-changes`, { method: "POST", body: JSON.stringify({ notes }) }),
    rejectSubmission: (submissionId: string, notes: string) =>
      request<Submission>(`/submissions/${submissionId}/reject`, { method: "POST", body: JSON.stringify({ notes }) }),

    adminListUsers: () => request<AdminUserSummary[]>("/admin/users"),
    adminUpdateUser: (userId: string, data: UpdateUserByAdminInput) =>
      request<void>(`/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(data) }),
    /** Resolves to the transfer link for contentAction "transfer", otherwise undefined. */
    adminDeleteUser: (userId: string, data: { contentAction: "delete" | "transfer"; retentionDays?: number }) =>
      request<TransferLink | undefined>(`/admin/users/${userId}/delete`, { method: "POST", body: JSON.stringify(data) }),
    adminRegenerateTransferLink: (userId: string) =>
      request<TransferLink>(`/admin/users/${userId}/transfer-link`, { method: "POST" }),
    adminGetStorageLimits: () => request<StorageLimits>("/admin/storage/limits"),
    /** The largest song file of each type, in MB (issue #163). */
    /** What the viewer may upload (issues #163, #183): each type's largest file, and whether audio files at all (recording in Songverse needs no role). */
    getUploadLimits: () => request<{ limitsMb: Record<AttachmentTypeValue, number>; canUploadAudio: boolean }>("/uploads/limits"),
    adminGetFileSizeLimits: () => request<FileSizeLimits>("/admin/storage/file-size-limits"),
    adminSaveFileSizeLimits: (data: SaveFileSizeLimitsRequest) =>
      request<void>("/admin/storage/file-size-limits", { method: "PUT", body: JSON.stringify(data) }),
    adminSaveStorageLimits: (limits: SaveStorageLimitsRequest) =>
      request<void>("/admin/storage/limits", { method: "PUT", body: JSON.stringify(limits) }),
    adminStorageStats: () => request<AdminStorageStats>("/admin/storage"),
    adminGetStorageConfig: () => request<StorageConfigSummary>("/admin/storage/config"),
    adminSaveStorageConfig: (data: SaveStorageConfigInput) =>
      request<void>("/admin/storage/config", { method: "PUT", body: JSON.stringify(data) }),
    adminClearStorageConfig: () => request<void>("/admin/storage/config", { method: "DELETE" }),

    getAuthPublicConfig: () => request<AuthPublicConfig>("/auth/public-config"),
    /** Sign-up by invitation (issue #198). */
    getSignupInvitation: (token: string) => request<SignupInvitationPreview>(`/auth/invitations/${encodeURIComponent(token)}`),
    adminListSignupInvitations: () => request<SignupInvitationSummary[]>("/admin/invitations"),
    adminCreateSignupInvitation: (data: CreateSignupInvitationRequest) => request<SignupInvitationSummary>("/admin/invitations", { method: "POST", body: JSON.stringify(data) }),
    adminDeleteSignupInvitation: (id: string) => request<void>(`/admin/invitations/${id}`, { method: "DELETE" }),
    adminGetAuthConfig: () => request<AuthConfigSummary>("/admin/auth"),
    adminSaveAuthConfig: (data: SaveAuthConfigInput) =>
      request<void>("/admin/auth", { method: "PUT", body: JSON.stringify(data) }),
    adminClearAuthEmailConfig: () => request<void>("/admin/auth/email", { method: "DELETE" }),
    adminClearAuthGoogleConfig: () => request<void>("/admin/auth/google", { method: "DELETE" }),
    listStemSeparations: (songVersionId: string) => request<StemSeparations>(`/song-versions/${songVersionId}/stem-separations`),
    separateStems: (songVersionId: string, attachmentId: string, parts: StemSeparationParts, replace = false) =>
      request<StemSeparation>(`/song-versions/${songVersionId}/attachments/${attachmentId}/separate`, { method: "POST", body: JSON.stringify({ parts, ...(replace && { replace }) }) }),
    retryStemSeparation: (separationId: string) => request<void>(`/stem-separations/${separationId}/retry`, { method: "POST" }),
    adminGetStemSeparation: () => request<StemSeparationSummary>("/admin/stem-separation"),
    adminSaveStemSeparation: (data: SaveStemSeparationSettingsRequest) => request<void>("/admin/stem-separation", { method: "PUT", body: JSON.stringify(data) }),
    adminClearStemSeparation: () => request<void>("/admin/stem-separation", { method: "DELETE" }),
    adminTestStemSeparation: () => request<StemSeparationTest>("/admin/stem-separation/test", { method: "POST" }),
    adminListSonicServers: () => request<ConnectedSonicServer[]>("/admin/stem-separation/servers"),
    getSonicServer: (owner: SonicServerOwnerRef) => request<SonicServerSummary>(sonicServerPath(owner)),
    saveSonicServer: (owner: SonicServerOwnerRef, data: SaveSonicServerRequest) => request<void>(sonicServerPath(owner), { method: "PUT", body: JSON.stringify(data) }),
    removeSonicServer: (owner: SonicServerOwnerRef) => request<void>(sonicServerPath(owner), { method: "DELETE" }),
    testSonicServer: (owner: SonicServerOwnerRef) => request<StemSeparationTest>(`${sonicServerPath(owner)}/test`, { method: "POST" }),
    adminListRoles: () => request<AdminRole[]>("/admin/roles"),
    /** The instruments an admin added (issue #166), for everyone's pickers and badges. */
    listCustomInstruments: () => request<CustomInstrument[]>("/instruments"),
    adminListInstruments: () => request<AdminCustomInstrument[]>("/admin/instruments"),
    /** Screens (issue #186): a code a screen shows, before confirming it. */
    checkScreenCode: (code: string) => request<{ code: string; expiresAt: string }>(`/screens/pairings/${encodeURIComponent(code)}`),
    confirmScreenPairing: (code: string, data: ConfirmScreenPairingRequest) =>
      request<ScreenSummary>(`/screens/pairings/${encodeURIComponent(code)}/confirm`, { method: "POST", body: JSON.stringify(data) }),
    /** The screens showing a set (for who leads it), or the user's own. */
    listScreens: (setlistId?: string) => request<ScreenSummary[]>(`/screens${setlistId ? `?setlistId=${encodeURIComponent(setlistId)}` : ""}`),
    updateScreen: (screenId: string, data: UpdateScreenRequest) => request<ScreenSummary>(`/screens/${screenId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteScreen: (screenId: string) => request<void>(`/screens/${screenId}`, { method: "DELETE" }),
    /** Screen themes (issue #194): the user's own and their teams'. */
    listScreenThemes: () => request<ScreenThemeSummary[]>("/screen-themes"),
    createScreenTheme: (data: CreateScreenThemeRequest) => request<ScreenThemeSummary>("/screen-themes", { method: "POST", body: JSON.stringify(data) }),
    updateScreenTheme: (themeId: string, data: UpdateScreenThemeRequest) => request<ScreenThemeSummary>(`/screen-themes/${themeId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteScreenTheme: (themeId: string) => request<void>(`/screen-themes/${themeId}`, { method: "DELETE" }),
    /** Widgets' default looks (issue #273): the user's own and their teams'. */
    listScreenWidgetDefaults: () => request<ScreenWidgetDefault[]>("/screen-widget-defaults"),
    saveScreenWidgetDefault: (kind: ScreenWidgetKind, data: SaveScreenWidgetDefaultRequest) => request<ScreenWidgetDefault>(`/screen-widget-defaults/${kind}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteScreenWidgetDefault: (kind: ScreenWidgetKind, teamId?: string) => request<void>(`/screen-widget-defaults/${kind}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`, { method: "DELETE" }),
    /** Templates' parts (issue #281): content themes, background themes, effects - the user's own and their teams'. */
    listScreenParts: (kind?: ScreenPartKind) => request<ScreenPartSummary[]>(`/screen-parts${kind ? `?kind=${kind}` : ""}`),
    createScreenPart: (data: CreateScreenPartRequest) => request<ScreenPartSummary>("/screen-parts", { method: "POST", body: JSON.stringify(data) }),
    updateScreenPart: (partId: string, data: UpdateScreenPartRequest) => request<ScreenPartSummary>(`/screen-parts/${partId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteScreenPart: (partId: string) => request<void>(`/screen-parts/${partId}`, { method: "DELETE" }),
    /** A background theme's picture or video ("media"), or a content theme's font. */
    uploadScreenPartAsset: (partId: string, kind: "media" | "font" | "shader", file: Blob, filename: string) => {
      const form = new FormData();
      form.append("file", file, filename);
      return request<ScreenThemeAsset>(`/screen-parts/${partId}/assets?kind=${kind}`, { method: "POST", body: form });
    },
    deleteScreenPartAsset: (partId: string, assetId: string) => request<void>(`/screen-parts/${partId}/assets/${assetId}`, { method: "DELETE" }),
    listBrands: (owner: { teamId?: string; organizationId?: string } = {}) => {
      const query = new URLSearchParams(Object.entries(owner).filter((entry): entry is [string, string] => !!entry[1]));
      return request<Brand[]>(`/brands${query.size ? `?${query}` : ""}`);
    },
    getBrand: (brandId: string) => request<Brand>(`/brands/${brandId}`),
    createBrand: (data: CreateBrandRequest) => request<Brand>("/brands", { method: "POST", body: JSON.stringify(data) }),
    updateBrand: (brandId: string, data: UpdateBrandRequest) => request<Brand>(`/brands/${brandId}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteBrand: (brandId: string) => request<void>(`/brands/${brandId}`, { method: "DELETE" }),
    uploadBrandAsset: (brandId: string, kind: BrandAssetKind, file: Blob, filename: string, name?: string) => {
      const form = new FormData();
      form.append("file", file, filename);
      const query = new URLSearchParams({ kind, ...(name && { name }) });
      return request<BrandAsset>(`/brands/${brandId}/assets?${query}`, { method: "POST", body: form });
    },
    deleteBrandAsset: (brandId: string, assetId: string) => request<void>(`/brands/${brandId}/assets/${assetId}`, { method: "DELETE" }),
    adminCreateInstrument: (data: CreateInstrumentRequest) => request<CustomInstrument>("/admin/instruments", { method: "POST", body: JSON.stringify(data) }),
    adminUpdateInstrument: (id: string, data: UpdateInstrumentRequest) => request<CustomInstrument>(`/admin/instruments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    adminDeleteInstrument: (id: string) => request<void>(`/admin/instruments/${id}`, { method: "DELETE" }),
    adminCreateRole: (data: CreateRoleRequest) => request<{ id: string }>("/admin/roles", { method: "POST", body: JSON.stringify(data) }),
    adminUpdateRole: (roleId: string, data: UpdateRoleRequest) => request<void>(`/admin/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(data) }),
    adminDeleteRole: (roleId: string) => request<void>(`/admin/roles/${roleId}`, { method: "DELETE" }),
    adminSetUserRoles: (userId: string, data: AssignRolesRequest) => request<void>(`/admin/users/${userId}/roles`, { method: "PUT", body: JSON.stringify(data) }),
    adminListTeams: () => request<AdminTeamSummary[]>("/admin/teams"),
    adminSetTeamRoles: (teamId: string, data: AssignRolesRequest) => request<void>(`/admin/teams/${teamId}/roles`, { method: "PUT", body: JSON.stringify(data) }),
    adminGetCollaborationSettings: () => request<CollaborationSettingsSummary>("/admin/collaboration"),
    adminSaveCollaborationSettings: (data: SaveCollaborationSettingsRequest) => request<void>("/admin/collaboration", { method: "PUT", body: JSON.stringify(data) }),
    adminClearCollaborationSettings: () => request<void>("/admin/collaboration", { method: "DELETE" }),
    adminGetSecuritySettings: () => request<SecuritySettingsSummary>("/admin/security"),
    adminSaveSecuritySettings: (data: SaveSecuritySettingsRequest) => request<void>("/admin/security", { method: "PUT", body: JSON.stringify(data) }),
    adminClearSecuritySettings: () => request<void>("/admin/security", { method: "DELETE" }),
    adminGetOrganizations: () => request<AdminOrganizations>("/admin/organizations"),
    adminSaveOrganizationSettings: (data: SaveOrganizationSettingsRequest) => request<void>("/admin/organizations/settings", { method: "PUT", body: JSON.stringify(data) }),
    adminClearOrganizationSettings: () => request<void>("/admin/organizations/settings", { method: "DELETE" }),
    adminCreateOrganization: (data: CreateOrganizationRequest) => request<AdminOrganization>("/admin/organizations", { method: "POST", body: JSON.stringify(data) }),
    adminDeleteOrganization: (organizationId: string) => request<void>(`/admin/organizations/${organizationId}`, { method: "DELETE" }),
    adminGetNotificationSettings: () => request<NotificationServerSettingsSummary>("/admin/notifications"),
    adminSaveNotificationSettings: (data: SaveNotificationServerSettingsRequest) => request<void>("/admin/notifications", { method: "PUT", body: JSON.stringify(data) }),
    adminClearNotificationSettings: () => request<void>("/admin/notifications", { method: "DELETE" }),
    adminGeneratePushKeys: () => request<{ publicKey: string }>("/admin/notifications/vapid-keys", { method: "POST" }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
