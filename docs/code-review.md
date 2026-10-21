# Code review, September 2026

Issue #112. A pass over the whole repository covering:
- security;
- code left over from migrations and changed features;
- places that do one thing several ways;
- what the planned features will run into.

Small fixes went in with the review. Anything bigger has its own issue,
linked below.

## Summary

- **One serious hole, fixed.** A file uploaded to a song could be an HTML
  or SVG page. Opened from its link, it ran as the person who opened it:
  on the API's origin, where the sign-in cookie can mint an API token, or
  on the web app's origin through the offline copy.
- **Otherwise sound.** Access checks are consistent, secrets are handled
  as CLAUDE.md says, and raw SQL is parameterised. CORS names the web
  app's exact origin, and tokens come from a secure random source.
- **Hardening added:**
  - security headers on the API and the web app;
  - a message limit on the Sync play WebSocket;
  - a Sync play connection whose access is taken away is dropped within
    30 s;
  - image downloads from the providers check every redirect before
    following it, and have a size limit.
- **Leftovers removed:** an unused endpoint and its client call, unused
  offline helpers, Meilisearch, stale environment examples, and an unused
  dependency. The API also now uses the same `jose` major version that
  Better Auth needs.
- **Merged into one:** four pieces of code that existed in two or three
  copies each.
- **Planned features (#103–#111):** the main risks are anchoring (notes,
  assignments and cue points must survive edits and folds), per-pass
  tempo, and the rules CLAUDE.md sets for new models.

## Security

### Fixed

| What | Risk | Fix |
| --- | --- | --- |
| Uploaded files served with the type they were uploaded with, shown in place (`/files/:id` links, `…/download`) | **High.** An `.html` or `.svg` attachment runs script on the API's origin. There, `fetch("/api/auth/token", { credentials: "include" })` returns the viewer's API token. The link needs no sign-in, so sending it to someone was enough. | Only types that can't run script are shown in place: PDF, raster images, audio, video and plain text. The list is `inlineSafeType` in `@oneverse/core`. Anything else is sent as `application/octet-stream` with `Content-Disposition: attachment`. Every attachment response also carries `Content-Security-Policy: sandbox` and `nosniff`. Song images, artist pictures and avatars are re-encoded to WebP by `sharp`, so they can't carry script. Signed links are only given out for audio, the one thing that needs them (`<audio src>`). |
| The offline song page opened a kept file with `window.open(URL.createObjectURL(blob))` | **High.** The same attack, but on the web app's origin. | The page uses the same `inlineSafeType` check. Anything else is downloaded, not opened. |
| No security headers | Medium: clickjacking, MIME sniffing, and the referrer leaking signed addresses. | The API sends `nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`, and no `X-Powered-By`. The web app's server (`server.mjs`) sends `nosniff`, `SAMEORIGIN` and `strict-origin-when-cross-origin`. |
| Sync play's WebSocket took any number of messages | Medium: one client could keep the API and Redis busy. | Each connection gets a burst of 60 messages, refilled at 20 per second. Going over closes the connection with 1008. |
| Sync play checked access only when a device joined a set | Medium: someone removed from a team, banned, or no longer an editor kept following the set, and could keep leading it, until they reconnected. | Access is checked again at most every 30 s, on pings, lead, update and end. A device that has lost access is taken out of the set and told, and the web app stops following. |
| Provider images: the API followed redirects before checking the address, and read the whole body before checking its size | Medium: server-side request forgery (SSRF) through an allowed host's redirect, and memory use. | `fetchProviderImage` (`apps/api/src/images/provider-image.ts`) is now the one place the server downloads an address it was given. Before each request it checks for HTTPS and a provider image host. It follows at most 3 redirects, checking each one before requesting it, and stops reading at 5 MB. |
| The public env script (`window.__PUBLIC_ENV__`) wrote `JSON.stringify` into a `<script>` | Low: the values are set by the operator. | `<` is escaped. |
| The arrangement ID from a fold came from `Math.random` | Low: it was not a security value, but it was the one ID not made by `generateId`. | It now uses `generateId`. |

e2e coverage:
- `api/file-streaming`: HTML downloaded as bytes, no link for it, the
  sandbox header, and the security headers on both apps.
- `api/artwork`: a redirect elsewhere is refused and never requested, and
  an image over 5 MB is refused.
- `api/sync`: someone taken off the team stops following the set.
- Core unit tests: `inlineSafeType`.

### Checked and fine

- **Access.** Every controller is behind the global auth guard. The
  routes marked public are sign-in, share-link previews, and the signed
  file, image and avatar addresses. Song, set, songbook and arrangement
  reads and writes all go through their access services. The guard is
  global (`APP_GUARD`), so a new controller is protected unless it opts
  out.
- **SQL.** Every `$queryRaw` is a tagged template (parameterised) or a
  constant. There is no `$queryRawUnsafe` with user input.
- **Secrets.** Settings secrets are encrypted at rest and never sent back
  (`hasDatabaseXxx`). Tokens and transfer links come from `randomBytes`.
- **Signed addresses.** HMAC-SHA256 with a separate key for each purpose,
  checked with `timingSafeEqual`. The expiry is covered by the signature.
- **Auth.** CORS uses `credentials: true` with the exact web origin. The
  cookie domain is derived, not a wildcard. `isGlobalAdmin` can't be set
  by a client (`input: false`). The Worker runs without
  `BETTER_AUTH_SECRET`, which CI enforces.
- **Avatars.** They are public by design, but their addresses are content
  hashes, so they can't be listed.

### Recommended, not done here

- **Rate limits on the API**, per user and per address, and the Swagger
  page (`/api/docs`) off in production or for admins only. See #113.
- **A Content-Security-Policy for the web app.** See #114.

## Leftovers

### Removed

- `GET /works` (`WorksController.findAll`), `WorksService.findVisibleToUser`,
  `WorkResponseDto` and the core client's `listWorks`. Nothing called
  them since works became part of a song's credits.
- `keptSets` in `apps/web/src/lib/offline-data.ts`, a wrapper around
  core's `allKeptSets` that nothing called.
- Meilisearch, from `docker-compose.yml` and `apps/api/.env.example`.
  Search is Postgres (`search-text`).
- The root `.env.example`:
  - `AUTH_URL` pointed at the web app's port;
  - `WEB_URL` and `API_URL` were missing;
  - `VITE_API_URL` is no longer read.
  `JOBS_IN_API` is now documented.
- `@tonaljs/tonal` in `packages/core`. It was never imported, because
  chords are read by our own `parseChord`. The parser's comment about
  "wiring Tonal in" is gone.
- CLAUDE.md still said `readSongDocument()` upgrades v1 songs. The v1
  songs were migrated and that code was removed (#60).

### Dependencies

- The API asked for `jose ^5` while Better Auth needs `jose ^6.1` as a
  peer. The lockfile only worked because it happened to hold both
  versions. Any fresh resolve printed an unmet-peer warning and gave
  Better Auth jose 5. The API now uses jose 6. The lockfile has one
  jose and one Better Auth core. The API itself became ESM afterwards
  (#117), so it no longer needs Node's `require(esm)` to load either.

### Kept on purpose

- **Models with no code yet.** Each is on the roadmap (#41):
  - `GrooveCategory`, `GrooveStyle`, `GroovePattern` and
    `ArrangementGroove` are for the drum patterns (#105);
  - `ChordVoicing`, `TuningPreset`, `DisplayMode` and `VoicingPreference`
    are for the chord diagrams (#111);
  - `InkAnnotation` is for handwriting;
  - `WorkTag` is for tagging works.
  The look-ahead below says what each will need.
- **The docs for v1 of the song and arrangement documents**, marked as
  superseded. They explain the migration.
- **The old way of reading a MusicBrainz link** in `getMetadataMatch`, for
  songs linked before song info was saved. A backfill can retire it: #116.
- **`normalized` on parsed chords** (always null). It is in the import
  schema, which is part of the API (`ParsedSection`). Removing it is a
  breaking change for no gain until someone needs the space.

## One way of doing things

### Merged in this review

| Was | Now |
| --- | --- |
| Signing file links (`file-links.service.ts`) and song and artist image addresses (`song-image-url.ts`) with two copies of the HMAC code | `common/utils/signed-address.ts`: `signAddress`/`isValidAddress` with a purpose. The keys and messages are the same, so existing addresses keep working. |
| Provider timeouts written out separately in six files | `PROVIDER_TIMEOUT_MS` (`metadata/provider-timeout.ts`). The metadata search's own overall wait is now named `SEARCH_WAIT_MS`. |
| Artwork and artist-picture downloads, each with its own allowlist, timeout and size check | `fetchProviderImage` (above). |
| `formatTime` in the YouTube dock and the stem dock, and duration formatting in the history tab | `formatDuration` in `@oneverse/core`. It rounds down, never goes below 0, and handles `NaN`. |
| Loading a song's stems from the API or from the device, in the set's song page and in Sync play | `apps/web/src/lib/song-files.ts` (`songFiles`, `fileLoader`). |

### Left as they are, with a plan

- Device settings are read and written by hand in 10 files, and there are
  seven hand-written `useSyncExternalStore` stores. A `deviceSetting`
  helper and a `createStore` would replace them: #115.
- **Two AudioContexts**, one for the metronome and one for the stems. This
  is by design: each engine owns its graph, and both place sound through
  `lib/output-clock.ts`, which pairs them with the device clock. A third
  engine (drum patterns #105, MIDI #99) should do the same, not share a
  context.

### Conventions that held up

These are worth keeping as the app grows:
- `readSongDocument` for song documents;
- `SongHistoryService` around every write to a song;
- `SongFoldService` for duplicates;
- `StorageService.deleteUnreferenced` for files;
- `sharedTurn()` for rate limits set by an outside service;
- `JobsService` plus `start-jobs.ts` for background work;
- the Admin settings pattern (singleton row → env → default).

## Looking ahead

What the open feature requests will run into, so it's decided before the
code is written. The rules that apply to every new model come first.

### Rules for any new model

- **A foreign key to `User`, `SongVersion`, `Arrangement`, `Songbook`,
  `Tag` or `Setlist`** needs `onDelete: Cascade` or `SetNull`, or
  handling in `UserDeletionService`. Content that belongs to a user also
  needs the transfer step.
- **Anything that follows a song** (points at its sections, lines, chords
  or passes) needs handling in `SongFoldService.fold`, with its IDs mapped
  by `mapChartIds`. Otherwise it is lost or left pointing at nothing when
  a duplicate is folded.
- **Anything that changes the song itself** goes through
  `SongHistoryService.before()`/`record()`.
- **Anything a device must keep offline** goes in the kept copy
  (`offline/`) and its e2e suite.

### #103 Assign parts of a song to people

- **Where it lives.** Who sings which line depends on the band and the
  day, not on the song. So assignments belong to an arrangement: a team's
  usual one, or a set's own. They go in the arrangement document next to
  the overrides, not on the song. That way they follow the existing
  fold and remap code for free.
- **Anchors.** Anchor on pass (item) IDs and line IDs, and on chord IDs
  for a part of a line. Never anchor on text offsets.
  `findArrangementProblems` should report an assignment whose line was
  deleted, like it does for overrides.
- **People.** Store user IDs. A user who leaves the team or is deleted
  must show as "someone" rather than break the chart. That rules out a
  foreign key inside JSON, so the renderer resolves names and treats an
  unknown ID as unassigned.
- **Colours.** Give each person a stable colour, derived from the user ID
  or chosen in the profile (#109). Check them against the chart's
  highlight colours in both themes.

### #104 Notes anywhere in a song

- **Model.** `Note` already exists (scopes `USER`, `TEAM`,
  `SETLIST_ITEM`), and set notes use it. Add an anchor
  (`anchorType` + `anchorId` + an optional character position), as
  `InkAnnotation` sketches, rather than a second notes model.
- **Syllables are the hard part.** A note on a syllable is a character
  position in a line. Editing the line's text moves it. Chords have the
  same problem, and `songDocumentFromText` re-pins them. Notes need the
  same re-pinning, which means either:
  - notes live in the document and get re-pinned with the chords (they
    then join the song's history and a fold for free, but become part of
    the song for everyone); or
  - they stay in `Note` and are re-pinned after each save, by matching
    the old line text to the new the way `songDocumentFromText` matches
    chords.

  Pick one before building. The second keeps private and team notes out
  of the song.
- **Between sections or lines.** A note after pass X, or after line Y,
  anchors on the ID. If X is deleted, show the note at the end of the
  song rather than dropping it.
- **Folds and deletion.** The fold already moves a song's notes
  (`tx.note.updateMany`), but the anchor IDs must be mapped too. User
  deletion already deletes a user's notes.

### #105 Drum pattern library

- **Tables.** They exist: `GrooveStyle`/`GroovePattern` (a 16-step grid
  per style variant), `SectionV2.groove` (a `GrooveRef` in the song
  document) and `ArrangementGroove` (per pass of an arrangement). That is
  two places for the same choice, a column table and a field in the JSON.
  **Pick the document.** Put the groove on the arrangement item, like the
  other per-pass overrides, and drop `ArrangementGroove`. It is simpler
  to fold, to keep offline and to render.
- **User-made patterns.** Built-in styles are seed data. A user's own
  patterns need an owner, and then user deletion and the transfer step.
- **Grid sizes.** The seeded `patternJson` assumes 16 steps. 6/8, 12/8
  and triplet feels need 12 or 24, so store the step count and
  subdivision with the pattern.
- **Playing it.** Use a third engine placed through `OutputClock`, driven
  from the metronome's timeline (bar and beat at a device time), not a
  second clock. In Sync play it follows the session's metronome like the
  stems follow theirs (#100). The pattern choice goes in `SyncSession`
  only if followers can't work it out from the song and pass they're on.
- **Tempo per pass.** `SectionInstance.tempo` and `timeSignature` exist,
  but the metronome plays one tempo per song. #30 (tempo map) should come
  first, or patterns will drift at a tempo change.

### #106 and #107: Singer and Drummer views in Live

- They are views of the same `renderChart` output. The Singer view drops
  chords. The Drummer view shows section badges and the pass's groove
  (#105).
- Make the view part of the player's chart preferences (`ChartPreference`),
  so a device remembers it per song or arrangement. Don't add another
  device setting (see #115).
- Live's structure bar (#69) and the metronome's bar count must stay in
  step with the Drummer view's highlighted section. Drive all three from
  one "current pass" source, Sync play's `itemId` plus the timeline,
  rather than each working it out.

### #108 A set's line-up and #109 the profile

- **Instruments.** They are already on `User.instruments`/`techRoles`, as
  keys from `INSTRUMENTS`/`TECH_ROLES`, so positions come from the same
  list.
- **Line-up model.** Add a new `SetlistPosition` (set, user, positions[])
  with `onDelete: Cascade` on both keys. Team members and guests
  (`SetlistGuest`) both take positions, so it can't hang off
  `SetlistGuest`.
- **Joining.** Choosing positions when joining through the share link
  goes into `SetlistSharingService.join`. For team members, choosing
  happens on the set page.
- **Links to other features.** #103's "who" list and the set's Sync
  "who's here" list should both read the line-up.

### #110 Cue points on recordings

- **Storage.** Cue points belong to one attachment, since the same bytes
  can be two attachments (storage is content-addressed). Store them on
  the attachment, or in a table keyed by attachment, never by storage
  object. `StorageService.deleteUnreferenced` doesn't need to know about
  them.
- **Anchors.** A cue point marks where a pass starts, so store the pass ID
  (song flow `fi_…` or arrangement item `ai_…`) and a time.
  `flowItemId` keeps the first pass's ID stable when the order is rebuilt.
  Check that later passes keep theirs through `songDocumentFromSections`
  and `songDocumentFromText` too, and add tests for it. A cue point whose pass is gone should be shown
  as a problem, not dropped (the arrangement rule).
- **Folds.** Attachments already follow a fold (`attachment.updateMany`).
  Their cue points' pass IDs must be mapped at the same time
  (`mapChartIds`).
- **Stems.** A set of stems shares one timeline, so their cue points
  belong to the song's recording as a group, not to each stem. The
  combined waveform is worth computing once (a Worker job storing peaks)
  rather than on every device.
- **Sync play.** Cue points are what lets followers jump to "Chorus 2"
  together. They travel as data the followers already have, with only the
  position in the session.

### #111 Chord diagrams

- **Data.** Use the `ChordVoicing` table, with `TuningPreset` for
  alternate tunings. Chord names on the chart go through `parseChord`
  (`@oneverse/core`). Look diagrams up by its normalised root and
  suffix, not by the raw text. That covers "Bbm7" versus "A#m7" and slash
  chords (show the shape, and the bass as the lowest note).
- **Seeding.** Seed diagrams from an open chord database. Check its
  licence first, and credit it in the README.
- **Sound.** "Heard on tap" is a small sampler or synth. It should use the
  device's own AudioContext through `OutputClock`, so a strum can land on
  the beat when the metronome is running.
- **Capo and preferences.** A player's capo and personal preferences
  change the shape shown, not the chord. The diagram takes its chord from
  `renderChart`'s output, after capo and preferences are applied.

### #62 Headless clients, and #98/#99 MIDI

- **Authentication.** Today a device signs in to Sync play with the user's
  API token (`hello`), which lasts minutes. A headless player needs its
  own long-lived credential for one set or team, one an admin can revoke.
  Don't hand it a user's session.
- **Keep the protocol small.** Sync messages are JSON and small by design
  (CLAUDE.md), and the new message limit (60 burst, 20 per second) is
  generous for that.
- **MIDI.** MIDI clock out (#98) and MIDI layers (#99) place events the
  same way the stems and metronome place sound: from the timeline,
  through `OutputClock`. Web MIDI timestamps are on `performance.now()`,
  the clock `deviceNow()` is built on, so no new pairing is needed.

### Offline

Each new kind of song content (notes, assignments, cue points, grooves)
must be in the kept copy for a set to work offline in Live. That's an
extra step for each feature, easy to forget. Add each to `offline/` and
the offline e2e suite as part of that feature, not after.
