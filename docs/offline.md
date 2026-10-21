# Working offline

Status: **agreed design**, nothing built yet. This is how Songverse keeps
working without a network, in phases. The decisions it rests on are
[below](#decisions).

## Why

Songs are used where the network is worst: a church hall, a basement
rehearsal room, a festival stage. Perform and practice modes are only
trustworthy if tonight's set opens with no Wi-Fi. Editing on a train is
nice to have; reading at the venue is essential.

## Three levels

| Level | What works offline | Conflicts | When |
|---|---|---|---|
| 1. Read | Upcoming sets, your own songs, songbooks you keep; charts and files | None: read-only | Phase 1 |
| 2. Create and personal changes | New songs; your notes, chart preferences, set order | None for new songs; rare for personal data (one owner) | Phase 2, soon after |
| 3. Shared editing | Editing songs other people also edit | Real: needs merging | Much later, with real-time collaboration |

## Decisions

1. **Start read-only.** Creating new songs offline comes soon after.
2. **Downloaded automatically:** upcoming sets and the songs in them, and
   every song the user created. A songbook can be set to **keep a local
   copy**. Audio is never downloaded by default.
3. **Real-time collaboration someday, in the distant future.** Editing
   shared songs offline waits for it.
4. **A mobile app is expected within six months, maybe sooner.** It will
   be either native or React Native (not decided), so the sync protocol
   must work for both (see [The mobile app](#the-mobile-app)).

## Where we start from

What stops it today:

- **Pages are drawn on the web server.** TanStack Start draws each page on
  the server, and route loaders call the API. `_protected.tsx`'s
  `beforeLoad` calls `loadAppData()` (`apps/web/src/lib/app-data.ts`),
  which asks the web server for the session (`server-auth.ts` forwards the
  cookie to the API). With no network that fails, and the user is sent to
  sign in.
- **Nothing is stored in the browser** except the API token and a
  one-minute in-memory cache of the sidebar lists. Every page loads its
  data fresh.

What already helps:

- **The chart is drawn in the browser** from the document alone:
  `SongChart`, `layoutChordLine`, `transposeChord` (core). An offline chart
  only needs the song's JSON.
- **Stable IDs everywhere and a `revision` per song**
  (`docs/song-document-v2.md`). Sync and merge need both.
- **Core is shared.** Offline logic (the local store's shape, the sync
  protocol, merging) belongs there, so a mobile app reuses it.

## Phase 1: reading offline

### The app itself (service worker)

- A web app manifest and a service worker make Songverse installable (a
  PWA) and keep its code: the JS and CSS bundles, fonts, icons and an
  **app shell** - a page that boots the app in the browser without the
  server. TanStack Start can build that shell next to the server-drawn
  pages.
- **Online, nothing changes:** pages are still drawn on the server.
- **Offline, the service worker serves the shell for any page** and the
  app runs entirely in the browser.
- **Updates:** a new version installs in the background and applies on the
  next launch, never in the middle of a performance.

How it's built (#49):

- **The shell** is TanStack Start's SPA-mode shell (`spa` in
  `apps/web/vite.config.ts`): the root document with no page in it,
  prerendered at build time to `dist/client/_shell.html`. Server-drawn
  pages are unaffected. `server.mjs` serves it at `/_shell`, with this
  server's `API_URL` and the real stylesheet name put in (both were fixed
  at build time).
- **The service worker** is `apps/web/public/sw.js`. `server.mjs` serves
  it with the build's ID and file list (`/assets/*`, the web app manifest,
  the icon) filled in, so a deploy is a new service worker. It keeps them
  all on install. A page request goes to the network first; if there's no
  answer in 6 seconds, or the server fails (5xx), it gets the shell
  instead. In development the placeholders stay and it does nothing.
- **The session:** once in the browser, the signed-in layout keeps the
  session and sidebar lists (`keepAppDataOffline`). `loadAppData()` falls
  back to them when a request fails for want of a network, or doesn't
  answer in 8 seconds. It then marks the data `offline`, which shows the
  banner. The server saying there's no session deletes the copy, as do the
  sign-in page and **Sign out**. An auth server error (5xx) is not "signed
  out" (`server-auth.ts`), so it never deletes the copy.
- **A page with nothing kept** fails its loader with a network error. The
  router's default error component (`components/route-error.tsx`) says
  "Not available offline".

Sets (#50):

- **`GET /setlists/:id/offline`** returns the set and each item's song view,
  exactly what the set's song page and Live render. So offline they render
  the same way; no second renderer.
- **`@oneverse/core`'s `offline/`** holds the logic over an `OfflineStorage`
  interface: `keepSet`, `keptSetDetail`, `keptSetSong`, `searchKeptSongs`,
  `findKeptSong`. The web app's adapter is `deviceStorage()` in
  `apps/web/src/lib/offline-data.ts`, over `offline-db.ts`.
- **Kept as opened:** the set page, a set's song page and Live download the
  set once they're in the browser (`useKeepSet`, at most once a minute per
  set). Their loaders use `onlineOrKept()`: the API, or with no network the
  kept copy. Offline, the set page is read-only.
- **Search and a lone song in Live** fall back to the songs of kept sets,
  played as written with the player's chord settings.

Keeping current (#51):

- **`POST /offline/sync`** replaced the planned manifest and change feed
  (see "API support"). The device sends the sets it keeps with their
  versions (`offlineCopy()`'s hash of the whole copy). The answer lists the
  upcoming sets (yesterday to `days` ahead, 14 by default) and the known
  sets still visible, each with its version, plus a copy only where the
  device's is out of date. Known sets that are deleted or no longer
  visible come back as `gone`.
- **`syncKeptSets()`** (core) stores the copies, removes what's gone and
  drops sets a day after their date; undated sets stay. The web app runs
  it on launch, every 5 minutes while open, and when the connection comes
  back (`useOfflineSync`).
- The 14 days isn't a setting yet: the API takes `days` (1 to 60), and
  #52's storage page is where a setting would go.

Songs, songbooks, pins and files (#52):

- **Pins** (`OfflinePin`: a set, song or songbook, and whether its audio
  comes too) are stored per user on the server, so they follow the user
  to a new device: `GET/PUT/DELETE /offline/pins`. "Keep a local copy" on
  a songbook is its pin.
- **The same sync** carries songs and songbooks (`knownSongs`,
  `knownSongbooks` in; `songs`, `songbooks`, `goneSongs`, `goneSongbooks`
  out). Songs: the user's own, pinned, and those in kept sets and
  songbooks, each with `audio`. A song's version is its `updatedAt`, its
  files and a stamp of its notes (how many notes and replies, and the last
  change), computed in a few queries; full copies only where they changed.
  Songbooks: pinned. It also returns the pins and the user's chord
  settings (`viewer`), for songs shown on their own offline.
- **Files:** `syncKeptFiles()` (core) downloads a kept song's files by
  attachment (they never change once uploaded) - audio only when asked
  for - and removes the ones no longer wanted.
- **Offline pages:** a kept song's page is read-only (`OfflineSongPage`:
  its chart, its files, Live); a kept songbook opens read-only; search
  finds every kept song.
- **Notes** (issue #256): a set's copy has the notes seen in it, by song
  (`notes`), and a song's copy those seen outside sets; `keptSongNotes()`
  (core) reads them. A note written offline waits in the device's outbox
  (`songverse.notes.outbox`, `apps/web/src/lib/notes.ts`) and is sent when
  the connection is back; it shows meanwhile, marked as waiting.
- **Storage page** (`/offline`): last sync and "Sync now", persistent
  storage, the days-ahead setting (kept on the device, sent as `days`),
  and what's kept with a way to remove it. Removing a pinned item unpins
  it on the server too.
- **Shared with the mobile app** in `@oneverse/core`: the network helpers
  and the offline session rule (`offline/network.ts`), and all the keep,
  read, search and sync functions over `OfflineStorage`.

### The data (IndexedDB)

One IndexedDB database per signed-in user:

| Store | Holds | Key |
|---|---|---|
| `session` | The last known session (user, locale, roles) and when it was confirmed | singleton |
| `sets` | `SetlistDetail` as the API returns it | set ID |
| `songs` | The song's detail (details, sections, flow, capo, attachments list) with its `revision` and `updatedAt` | song version ID |
| `songbooks` | Kept songbooks with their entries | songbook ID |
| `files` | Attachment blobs (PDF, images, audio when asked for) | content hash |
| `meta` | The last manifest, pins, sizes | key |

- **What's downloaded automatically:**
  - **Upcoming sets:** every set the user can open (their own and their
    teams') whose date is from yesterday to 14 days ahead, with every song
    in it. The 14 days is a user setting. A set with no date is only
    downloaded if pinned.
  - **The user's own songs:** every song they created (owner scope USER).
  - **Songbooks with "Keep a local copy" on:** the songbook's entries and
    the songs they link to. Each songbook has the setting, off by default.
  - **Anything pinned:** the user can pin any set or song ("Available
    offline").
- **Files:**
  - PDFs, images and ChordPro files of those songs come with them.
  - **Audio is never downloaded by default.** A set, song or songbook can
    add its audio on request ("Include audio").
  - Files are content-addressed, so one shared by several songs is stored
    once.
- **Storage:**
  - ask for persistent storage with `navigator.storage.persist()`,
    otherwise the browser may evict it;
  - show how much space is used, per set and songbook, with a way to
    remove it.
- **Leaving the device:** a set drops off a day after its date unless
  pinned; a song stays while any reason to keep it holds (in a kept set or
  songbook, the user's own, pinned).

### Loading pages

A small data layer sits between the route loaders and `apiClient`:

- **Online:** fetch from the API as today, and write through to IndexedDB
  for anything that's kept offline.
- **Offline (or when a request fails because there's no network):** read
  from IndexedDB. Anything not stored gets a clear "Not available offline"
  page, never a sign-in redirect.
- **Session:** `loadAppData()` falls back to the stored session when the
  network is down. The user stays signed in, read-only, and the app says
  so.
  - When the connection is back, the session is checked again first. If
    it's gone (signed out elsewhere, banned, deleted), the local data is
    wiped.
- **Offline banner:** it shows how fresh the data is ("Updated 2 hours
  ago"). Editing controls are disabled offline.

This could be TanStack Query with its persisted cache, or a hand-written
store. Choose when building it; TanStack Query is the less custom option.

### API support

- `POST /offline/sync` - what this device should keep now (#51). The
  device sends the sets it keeps with their versions; the answer lists
  the upcoming sets and the known ones still visible, each with its
  current version and, only when it differs, the full copy. Deleted and
  no longer visible sets are listed as `gone`. One request catches
  everything up: updates, deletions and **lost access** (a song
  unshared, a team left). There's no change feed to keep and no
  deletion records: a version is a hash of what the device would show.
  Songbooks and pins join it in #52.
  **Asking first (#121):** most syncs find nothing to do, so a device
  first sends only `fingerprint` - `offlineFingerprint()` (core) of the
  sets, songs (with their `audio`) and songbooks it keeps, with their
  versions - and `known` (its sets, which are few). The API works out the
  same fingerprint of what the device should keep: when they match the
  answer is `unchanged: true` with `days`, `upcoming`, `pins` and `viewer`
  (a few hundred bytes); otherwise `unchanged: false`, and the device
  syncs with its lists as above. For a 3,000-song library that's about
  0.2 KB each way every few minutes instead of about 250 KB.
  **At most 100 song copies per answer (#122):** a new device's first
  sync of a big library would otherwise be one huge answer. Songs beyond
  the first 100 out of date come with `pending: true` and no copy, and the
  device fetches them with `POST /offline/songs`, a hundred at a time.
  The API builds copies many at once (a few queries per batch, not
  several per song): a 3,000-song first sync takes about a second in
  all, not half a minute.
- `GET /setlists/:id/offline` - a set with every song as it's shown, in
  one response (#50). `GET /songbooks/:id/offline` and
  `POST /song-versions/offline` (a batch of songs) come with #52.
- The songbook's **"Keep a local copy"** and pins are stored per user on
  the server, so they follow the user to a new device.
- Attachments are content-addressed already, so they can be fetched
  once and cached indefinitely (`Cache-Control: immutable` on the
  attachment's hash URL).

### Security

- **Local data is readable by anyone who has the device unlocked.** State
  that plainly in the "Available offline" help.
- **Losing access:** songs the user no longer has access to are removed
  at the next sync, so a lost device keeps its copies until then.
- **Signing out** deletes the user's IndexedDB database and cached files.
- **Scope:** only what the user could already see is ever downloaded; the
  endpoints re-check access like every other.

## Phase 2: creating songs and personal changes offline

### New songs

A song created offline has nobody else editing it, so there's nothing to
merge:

- The editor works as usual. The song is saved to IndexedDB with a
  **local ID** and marked "Not synced yet". Its sections, lines and chords
  get their normal IDs, generated on the device.
- Its creation is queued in the **outbox** with an **idempotency key**
  (`POST /song-versions` accepts `Idempotency-Key`), so sending it twice
  after a flaky reconnect still makes one song.
- **Once it's sent,** the server's ID replaces the local one everywhere on
  the device: the local song, pins, and any set that already uses it. Set
  items point at the local ID until then.
- **Refused (a title clash the user must resolve, a quota reached):** the
  song stays local and the reason is shown, never lost.
- **Further offline edits** to a song created offline change the queued
  creation rather than adding updates on top.

**Editing your own songs offline** can follow, once creation works. Those
songs have one owner, but possibly two devices. The save carries the
`revision` it started from, as today. If the song moved on meanwhile, the
user chooses "Keep mine" or "Keep the other version", with the difference
shown. No merge.

### Personal changes

- Changes to things only the user owns are queued in the **outbox** in
  IndexedDB and sent in order when back online:
  - personal notes on a set's songs;
  - chart preferences (`chart-preferences/v1`: hidden chords, simplified
    chords);
  - their own set's order and keys.
- They're one owner, per field: **last write wins**, using the time of
  the change, so an edit made offline and synced later doesn't overwrite
  a newer one.
- **Sending:** each queued change carries an ID, so sending it twice is
  harmless.
- **Failures:** a change refused on reconnect (access lost, set deleted)
  is shown to the user, never dropped silently.

## Phase 3: editing shared songs offline (much later)

This is the same problem as **real-time collaboration**: several people
changing one song without talking to the server in between. Real-time
collaboration is for the distant future, so shared songs stay read-only
offline until then. When it comes, both are built together. The two
options, for then:

### Option A: merge on reconnect (fits what we have)

- The offline editor saves against the `revision` it started from.
- **Today:** a stale save is refused (409).
- **Instead, a three-way merge by ID:**
  - base = the revision the edit started from;
  - theirs = the stored song;
  - yours = the edit.
- Most edits merge cleanly: different lines, a chord moved in one place
  and a lyric fixed in another, a section added on each side. Only the
  same line or chord changed on both sides is a conflict, shown side by
  side for the user to pick.
- Stable section, line and chord IDs make this tractable; the merge
  lives in core.
- **Cost:** moderate. No live co-editing.

### Option B: a CRDT (Yjs)

- Each song is a Yjs document, kept locally with `y-indexeddb` and synced
  through a small sync server (or `y-websocket` / Hocuspocus). Tiptap's
  collaboration extension edits it directly.
- Offline edits merge automatically, and **live co-editing** (with other
  people's cursors) comes with it.
- **The stored SongDocument becomes a snapshot** written from the Yjs state.
  Arrangements and IDs keep working from that snapshot.
- **Cost:** larger - the Yjs model of a song, the sync server, snapshots,
  access control on the socket.

**Plan:** live co-editing is wanted someday, so when this is built, go
to Yjs directly rather than building the merge first. Until then, nothing
in Phases 1-2 gets in its way. Stable IDs and the stored SongDocument are
what a Yjs model would snapshot to.

## Testing

- Playwright can take the browser offline (`context.setOffline(true)`),
  but that doesn't reach a service worker's own requests. With
  `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1` set before Playwright
  loads, `context.route()` does, so the suites also abort every request
  (see `e2e/web/offline.test.mjs`).
- An e2e suite would:
  1. mark a set available offline, go offline, reload, and check that the
     set, a chart and a PDF open;
  2. check that an unpinned song says "Not available offline";
  3. check that nothing redirects to sign-in;
  4. come back online and check that a song unshared in the meantime is
     removed.
- Phase 2 adds:
  - create a song offline, reconnect, and check that it exists once with
    its chords' IDs, even if the connection drops mid-send;
  - change a note offline, reconnect, and see it saved;
  - the same change from two devices keeps the newer one.

## The mobile app

Expected within six months, possibly sooner; native or React Native isn't
decided. Either way, offline is its core feature (perform mode at the
venue), so the sync design has to serve it from the start:

- **The protocol is the API, documented.** The manifest, batch downloads,
  changes feed and outbox rules are plain HTTP + JSON endpoints, described
  in the OpenAPI docs the API already serves (`/api/docs`), so any client
  can implement them. Anything a client needs to decide (what to keep
  offline) is decided by the server's manifest, not reimplemented per
  client.
- **The formats are specified:** `docs/song-document-v2.md`,
  `docs/arrangement-document-v2.md`.
- **Storage:** IndexedDB on the web; SQLite and the file system on mobile.
  The same tables either way.

What the choice changes:

| | React Native (Expo) | Native (Swift + Kotlin) |
|---|---|---|
| Reuses from `@oneverse/core` | Everything in TypeScript: song and arrangement schemas, chord reading and transposition, chart layout (`layoutChordLine`), text import/export, i18n, the API client, and the web app's offline store logic | Nothing: all of it written twice more, and kept in step |
| Offline storage | SQLite (expo-sqlite), files via expo-file-system | Core Data / Room, and the platforms' file APIs |
| Chart rendering | Its own components, same layout data as the web | Its own, per platform |
| Feel, platform APIs | Very good; native modules where needed | Best |

Since the chart layout, chord logic and sync client are the hard,
must-match parts, **React Native reuses most of what matters**. Whichever
is chosen, Phase 1's sync logic goes in core, as plain functions over a
storage interface, so a React Native app gets it for free. A native app
would port it from there.

## Rough sizes

| Phase | Work |
|---|---|
| 1 | Service worker and app shell, IndexedDB store, loader fallback, offline session, manifest and batch endpoints, "Keep a local copy" for songbooks, pins, storage UI, e2e suite - about 2 weeks |
| 2 | Outbox with idempotent sends, creating songs offline (local IDs swapped for server IDs), personal changes with last write wins, failure notices - about 1 to 2 weeks; editing your own songs offline adds about a week |
| 3 | Yjs model of a song, sync server, snapshots, collaboration UI - 3 weeks or more, when real-time collaboration is taken on |
