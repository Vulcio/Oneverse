# Oneverse — notes for Claude

This repository is Oneverse's monorepo (renamed from Songverse): the shared
core - the API, the database, `@oneverse/core` - and the apps built on it,
Songverse (`apps/web`) and Planiverse (`apps/planiverse`), and Oneverse
(`apps/oneverse`), where people sign in. Where it's going:
`docs/oneverse-architecture.md`, a direction rather than what's built. The
workspace packages are `@oneverse/*` (`@songverse/*` before); each app has its own
domain since #303 (`oneverse.top` and `api.oneverse.top`, `songverse.top`,
`planiverse.top`; the docs and the website stay on `songverse.one`). The rules below are unchanged by the
rename.

## Issues first

Before starting an enhancement or a fix, make sure a GitHub issue describes
it: create one, or update the existing one (the open issues are the plan -
check them before creating a duplicate). Reference it in the commits
(`Closes #n` in the one that finishes it). Once the work is merged to
`main`, close the issue if the merge didn't already, with a comment naming
the commit. Anything planned but not started gets an issue too, so nothing
agreed in a conversation lives only there.

## Keep the user docs current

The user documentation lives in `apps/docs` (Starlight, published at
docs.songverse.one), in English (`src/content/docs/`) and French
(`src/content/docs/fr/`, same file names). A feature or fix that changes
what users see updates its page, in both languages, in the same change:
- name buttons and menus exactly as the app's locale files do
  (`packages/core/src/i18n/locales/`);
- link to other pages with absolute paths (`/sets/`, `/fr/sets/`); the
  build fails on a link to a missing page or heading;
- new or changed screens: extend `e2e/docs/capture.mjs` and rerun
  `node e2e/docs/screenshots.mjs` (see `apps/docs/README.md`).
The in-app Help link picks the page from the URL (`apps/web/src/lib/docs.ts`):
add new areas of the app there.
A part for reviewers, people with a role such as stem separation, or admins
is wrapped in `<div data-audience="…">` so others don't see it (issue #160,
see `apps/docs/README.md`).

## Roles

What someone may do beyond their own and their teams' songs - review,
split stems, a storage tier, later plugins' permissions - comes from roles
(issue #160, Admin > Roles), given to users and to teams; worked out by
`apps/api/src/roles/capabilities.ts`, fresh on each request. A new right
is a field on `Role`, read through `capabilitiesOf`, never a column on
`User` or `Team`. A team's songs' files count against the team's storage
pool (`StorageQuotaService.assertCanStore` with the song).
Uploading audio files is a role's too (`canUploadAudio`, issue #183): people
who sign up can't, except what they record in Songverse. The e2e harness's
`user()` gives the built-in `AUDIO_UPLOADS` role; a suite that sets a user's
roles (`PUT /admin/users/:id/roles`) replaces it, so keep
`role_audio_uploads` in the list if they upload audio.

## Keep the Admin UI current

Whenever a change introduces or touches operator-facing configuration
(new env var, feature flag, credential, service toggle, etc.), give it a
home in the Admin UI rather than leaving it env-var-only — don't let the
admin dashboard drift out of sync with what's actually configurable.

Established pattern for admin-editable settings backed by a database
singleton row (see `packages/db/prisma/schema.prisma`'s `StorageSettings`
and `AuthSettings` models):
- A singleton Prisma model, `id` fixed to the literal string `"singleton"`.
- Non-secret fields stored directly; secrets encrypted at rest via
  `@oneverse/secret-crypto` (`encryptSecret`/`decryptSecret`), keyed by
  the `SETTINGS_ENCRYPTION_KEY` env var. Never decrypt a secret just to
  display it in a summary — only report whether the database holds one
  (`hasDatabaseXxx: boolean`), and let the UI say "leave blank to keep the
  current one".
- Resolution order: database row → matching env var → hardcoded default
  (see `apps/api/src/auth/auth-settings.ts`'s `getEffectiveAuthSettings()`
  and `apps/api/src/storage/storage.service.ts`'s `resolveDriver()`).
  Resolve fresh on every use rather than caching across calls or
  processes — the API/Worker each run as separate processes with no
  shared memory, so an admin's save through one needs to be visible to
  requests served by another without a restart.
- Partial-update ("PATCH-like") save semantics: a field left `undefined`
  keeps its current value, an empty string clears it.
- A matching Admin page (`apps/web/src/routes/_protected/admin/*.tsx`)
  with a "Currently using: database / env / nothing configured" line, and
  a "Revert to environment variables" action (with a confirm step) beside
  "Save configuration". These pages always call the NestJS API via
  `apiClient` (see `packages/core/src/api-client/index.ts`) - the web app
  has no direct database access at all (see below).

Both `StorageSettings` and `AuthSettings` are managed through
`AdminController`/`AdminService` in `apps/api` (`GET/PUT/DELETE
/admin/storage/*` and `/admin/auth/*`), guarded by `GlobalAdminGuard`.
There's no more "settings only used by the web app, so it skips the API"
case — see the next section for why.

## Organisations

A server has none (Songverse on its own, the default), one that everyone is
in, or several (issue #241, Planiverse; Admin > Organisations,
`apps/api/src/organizations/`). With none, nothing about them shows: keep
Songverse working the same without them. A team may be part of one
(`Team.organizationId`); a team's members are always its organisation's
members - add people to a team's organisation with `joinTeamOrganization()`
wherever they join a team. Songs, songbooks and sets stay owned by people
and teams, never by an organisation.
An organisation's groups are teams too: one that only plans
(`usesSongverse: false`) owns no songs, songbooks, sets or arrangements -
`AccessPolicyService.assertSongverseTeam()` where a team becomes an owner -
and isn't in `GET /teams` unless asked (`?all=true`). Groups sit under one
another (`Team.parentId`, same organisation) without sharing members, and
have positions of their own (`TeamPosition`, `TeamMembership.positionIds`).
An organisation's event (`OrganizationEvent`, its host and the groups it
needs) is one `TeamEvent` per group (`organizationEventId`), made, changed
and removed only through `OrganizationEventsService`, which passes
`planned = true` to `TeamEventsService`; a group's admins change only its
parts. Everything a team event does (answers, line-up, sets, reminders)
works for it unchanged.

## Shared UI

The UI primitives (button, dialog, sidebar…), `cn`, and the shared theme
(colour tokens, `@theme`, base styles) live in `packages/ui`
(`@oneverse/ui`, issue #241), for Songverse's web app and Planiverse's.
It's source only: the apps compile it (`@oneverse/ui/components/button`,
`@oneverse/ui/lib/utils`), and an app's CSS imports
`@oneverse/ui/theme.css` after Tailwind, then sets its own looks by
overriding the tokens (Songverse's modes in `apps/web/src/styles/app.css`).
Add a new primitive there, not in an app.

What every web app needs to sign people in and reach the API lives in
`packages/app` (`@oneverse/app`, also source only): the API's address
(`public-env`), the session and API token forwarded to the API
(`session`, with the server functions alone in `server-auth`), the API
client (`createAppApiClient`, one per app), the languages (`i18n`,
`LocaleProvider`), the auth client, and the signed-out pages' parts
(`AuthCard`, `ResetPasswordCard`, `AuthPage` with the app's name passed
in, invite links' `JoinPage` with `openInviteLink`), and the account's own
cards (`account-cards`: name and picture, email, passkeys, language). An app
keeps its routes; a change to signing in or the account goes there, once.

People sign in at Oneverse (`apps/oneverse`, issue #303,
`docs/sign-in-with-oneverse.md`): accounts, passkeys and BetterAuth's cookie
live there. Songverse and Planiverse are OAuth clients of the API
(`apps/api/src/auth/oauth-clients.ts`), each with its own session: its
`/auth/sign-in`, `/auth/callback` and `/auth/sign-out` routes and its tokens
in a cookie of its own (`packages/app/src/oauth.ts`, the client fixed by its
`vite.config.ts`). A page that needs someone signed in sends them to the app's
`/auth/sign-in?next=…`, never to a sign-in page of the app's own; an account
setting goes on Oneverse's account page.

The planning screens - a team's calendar, line-up, answers, My calendar,
organisations, groups, positions, their events - live in `packages/planning`
(`@oneverse/planning`), for both apps. They reach the app through
`PlanningProvider` (`host.tsx`): its API client, its pages' addresses
(`links`), and its sets (`sets`: Songverse's, null in an app without). Never
link to a Songverse page from there by its path: add it to the host.
Generic parts (confirm button, date picker, avatars) are in `packages/ui`.

Planiverse (`apps/planiverse`, issue #241) is the second web app: those
screens on their own, same accounts and API, deployed where an admin wants it
(`Dockerfile.planiverse`; Songverse's is `Dockerfile.songverse`). The API trusts it when `PLANIVERSE_URL` is set
(`common/utils/web-apps.ts`: CORS, BetterAuth's trusted origins, passkeys,
one cookie domain for all). Its paths match Songverse's (`/calendar`,
`/teams/$id`, `/organizations/…`) so a notification's `url` works in both; a
notification is Planiverse's (`Notification.app`) when it's about a group that
only plans or an organisation's event - pass `teamId` (or `app`) to
`NotificationsService.notify()` - and its email links there, its push goes to
the devices turned on there (`PushSubscription.app`, from the page's origin).
Both web apps run on the shared server (`packages/app/server/web-server.mjs`).

## The player screen

`apps/web/src/player-screen/` builds `ScreenStage` on its own, client-only (`vite.player.config.ts`,
`pnpm --filter @oneverse/web build:player-screen`), for songverse-player, the Rust mini-PC player
(issue #247, its own repository). A change to `ScreenStage` or what it needs (providers, messages,
CSS) must keep that build working: `e2e/web/player-screen.test.mjs` builds it and checks it renders.
The player never gets a stage of its own; what it needs goes in here.

## Song content

`SongVersion.documentJson` is a SongDocument v2 (`docs/song-document-v2.md`):
the music only - sections, lines with chords pinned to characters, the
order it's sung in (`flow`) and a `revision`. Title, credits, rights and
the capo are columns; never copy them into the document.
- Read it with `readSongDocument()` from `@oneverse/core`, never by
  casting the JSON. (Every stored song is v2; v1 was migrated and its code
  removed, issue #60.)
- Section, line and chord IDs must survive edits. The structured editor
  (`apps/web/src/components/song-editor/structured/`) keeps them itself
  and saves `sections`, turned into a document by
  `songDocumentFromSections(previous, …)`; edited text goes through
  `songDocumentFromText(previous, …)`, which matches the new content to
  the old IDs. Both bump the revision.
- ChordPro is only an import/export format (`sectionsFromText`,
  `songToChordPro`), not how songs are stored.
- Every save is kept in the song's history (`SongVersionRevision`,
  issue #71): a write to the chart, the details or the credits goes with
  `SongHistoryService.before()`/`record()` in the same transaction (see
  `SongVersionsService.update`). A new way of changing a song needs it too,
  or that change can't be seen or undone.
- A song is never copied into another (issue #75). A duplicate goes into
  the song it duplicates through `SongFoldService.fold`
  (`apps/api/src/publishing/`): arrangements are pointed at the other
  song's IDs (`mapChartIds`/`remapArrangement` in `@oneverse/core`), and how
  its owner had it becomes their arrangement (`arrangementFromChart`). A new
  model with a foreign key to `SongVersion` that should follow the song
  needs handling there too.

## Background jobs

Slow or outside work (bulk uploads, lookups at the metadata providers,
backfills, scheduled clean-ups) goes on a BullMQ queue, run by the Worker
(`apps/api/src/worker.ts`, issue #92); the API only adds jobs, unless
`JOBS_IN_API` says it runs them too (by default only out of production).
Processors are created stopped (`JOB_WORKER_OPTIONS`) and started by
`startJobs()` - **a new processor must be added to its list in
`apps/api/src/jobs/start-jobs.ts`**, and its queue to `JobsService`, or no
process runs it and Admin doesn't show it. Don't fire-and-forget work
inside a request instead: it's lost on a restart. A rate limit an outside
service sets per client (MusicBrainz's) goes through `sharedTurn()`, so it
holds across the API's instances and the Worker. The Worker is deployed without
`BETTER_AUTH_SECRET` (Deploy.md), and CI runs it that way: a job must not
build anything signed with it - a song's or artist's image address, a file
link - so don't return a response DTO from a service method a job calls.

## Sync play

Sync play (issue #13) shares a set's metronome and song between devices:
a WebSocket on the API at `/sync` (`apps/api/src/sync/sync.server.ts`,
attached in `main.ts` - not in the Worker), its session and who's there
in Redis, announced across the API's instances on a Redis channel. The
messages and the clock maths are in `@oneverse/core` (`sync/`), kept
small and JSON for a headless device (#62). Only the timeline crosses the
network - "beat N at server time T" - never the beat: each device plays
it on its own clock (`apps/web/src/lib/sync-client.ts` and the metronome
engine's anchor on the device's clock). The stems follow the same way
(issue #100: `followStems` in `stem-engine.ts`). Both place sound through
`lib/output-clock.ts`, which pairs an AudioContext's clock with the
device's; use it for anything else that must sound in time. A new thing to
share goes in the session (`SyncSession`) the same way, as the leader's
`update`. Screens (issue #186, `apps/api/src/screens/`) are read-only members
of a set's session, signed in by their own token (`{type: "screen"}`); what
they show is `SyncSession.presenting` - "this song, slide N" - and every
client cuts a song into the same slides with `lyricSlides()` from core.
Live notes (issue #27) use the same socket: a device `watch`es the songs it
shows (only ones it can open), `NotesService` announces a change on
`NOTES_CHANNEL` after each write, and the device reads the notes again with
its own rights - the signal never carries content. A song's save is heard the
same way (`announceSongSaved`, from `SongHistoryService.record`: every change
to a song goes through it), and who's editing it or replying to one of its
notes is presence (`presence` messages, kept in Redis by connection). A new
thing to make live works the same way.

## Tests

Features are covered end to end by the suites in `e2e/` (API calls and
Playwright browser steps against the running app; CI runs them on every
push to `main`). Add or extend a suite there with each feature or fix -
see `e2e/README.md` - rather than keeping test scripts outside the repo.

The workspace's checks run on Vite+ (issue #159): `pnpm lint` (Oxlint, its
rules in the root `vite.config.ts`), `pnpm type-check` and `pnpm test`, through
`vp run`, which replays a package's result when nothing it reads changed. Unit
tests import from `vite-plus/test`, not `vitest`.

What `@oneverse/core` does - the song format, chords, the chart, the
timeline, what the API accepts - is also written down as shared test cases
(`packages/core/conformance/`, issue #170) that the native apps (#165) will
run too. A change to that behaviour fails core's tests until
`pnpm --filter @oneverse/core conformance` writes the answers again: review
the diff, it's the behaviour every client must follow. Add a case to
`src/conformance/suites.ts` for new behaviour every client needs. The API's
request messages are worded in core (`requests/messages.ts`) for the same
reason.

## Deleting users

Admin > Users can delete an account, either with everything the user
personally owns or keeping that content behind a one-time transfer link
(`apps/api/src/user-management/`). `UserDeletionService` handles every
relation to `User`, `SongVersion`, `Arrangement`, `Songbook`, `Tag` and `Setlist`
that doesn't cascade on delete. **If you add a model with a foreign key to
any of those without `onDelete: Cascade`/`SetNull`, handle it there too**,
or deleting a user who has such a row will fail with a foreign-key error.
New user-owned content types also need adding to its transfer step
(as `SetlistItem.sharedByUserId` - songs shared into team sets - and
`Submission.submitterId` - songs submitted to the global catalogue - do,
so they follow the songs to their new owner).

Storage objects are content-addressed and shared (attachments, avatars,
song images, artist pictures, team and songbook pictures, screen themes'
and brands' files with identical bytes are one object). Delete them only
through `StorageService.deleteUnreferenced()`, which checks every one of
them - a new kind of stored file needs adding there too.

## Requests

What the API takes is described once, as zod schemas in `@oneverse/core`
(`packages/core/src/requests/`, issue #118): the API validates with them
and clients take their types from them (`z.input<typeof XSchema>`).
- A request DTO is `class XDto extends zodDto(XSchema) {}`
  (`apps/api/src/common/zod-validation.ts`); the global pipe refuses a
  whole `@Body()`/`@Query()` that isn't one. No class-validator.
- Objects are `z.strictObject` (an unknown field is refused, by name).
  Use the helpers in `requests/fields.ts`: `optional()` (null is left
  out), `clearableText()`/`clearableInt()` (null or "" clears),
  `nameList()`, `queryInt()`/`queryBoolean()` for query strings.
- A failed request answers 400 with `message: string[]`, worded like
  "year must not be less than 1000"; a message a schema sets itself is
  used as it is, so write it as a sentence with the field's name.
- The API's docs (`/api/docs`, OpenAPI 3.1) describe bodies and queries
  from the same schemas; `z.custom` can't be described - type an unknown
  value with a transform instead.

## Files, addresses and outside downloads

The code review (issue #112, `docs/code-review.md`) left one way for each:
- A user's file is sent through `apps/api/src/files/send-file.ts`, which
  shows only types that can't run script (`inlineSafeType` in
  `@oneverse/core`) and sandboxes the rest. The web app opens a file
  (a blob, offline) the same way, or downloads it. Never serve or open an
  upload with the type it came with.
- An address that works without the Bearer token (`<audio src>`,
  `<img src>`) is signed with `signAddress`/`isValidAddress`
  (`apps/api/src/common/utils/signed-address.ts`), with its own purpose.
- The server downloads an address it was given only through
  `fetchProviderImage` (`apps/api/src/images/provider-image.ts`: provider
  hosts only, every redirect checked before it's followed, size capped).
  A new kind of outside download gets the same checks, not a bare `fetch`.
- An address someone other than the instance's admin entered (a team's or
  an organisation's Sonic server, issue #300) is called only through
  `apps/api/src/security/outside-address.ts`: `checkOutsideUrl` before
  anything is sent (https, no private host) and `outsideDispatcher` for the
  connection, which checks every address the name resolves to as it
  connects; redirects refused, answers size capped.
- A call to an outside service waits `PROVIDER_TIMEOUT_MS` at most.

## Where auth lives

BetterAuth is mounted in `apps/api` (`apps/api/src/auth/`, wired up in
`main.ts` via `better-auth/node`'s `toNodeHandler`), not in `apps/web`.
This was a deliberate migration (see git history around
`apps/api/src/auth/better-auth.ts`'s introduction): with a mobile app on
the roadmap, every client should authenticate against the same backend
the API already serves, rather than the web app's own server being a
second, unrelated auth surface.

Consequences worth knowing before touching auth-adjacent code:
- **The web app has zero direct Prisma/`@oneverse/db` access.** It talks
  to the API over HTTP for everything, auth included -
  `packages/app/src/session.ts` forwards the incoming request's
  session cookie to `${API_URL}/api/auth/get-session` /
  `/api/auth/token`, rather than calling `auth.api.getSession()`
  in-process. If you find yourself wanting to import `@oneverse/db` in
  `apps/web`, that's a sign the logic belongs in `apps/api` instead.
- **`AUTH_URL` is the API's own address; `WEB_URL` is the web app's** -
  easy to get backwards. `WEB_URL` matters because a WebAuthn passkey is
  checked against the browser's origin (the web app), not wherever the
  auth server lives - its relying-party ID is the parent domain the two
  share (`auth/auth-domains.ts`), so passkeys survive the web app changing
  subdomain - and because verification/reset-password redirect links
  point back into the web app, which BetterAuth has to explicitly trust
  via `trustedOrigins` now that it's a different origin.
- **The session cookie is cross-origin (web ↔ API, different
  subdomains).** `advanced.crossSubDomainCookies` with an explicit
  `domain` (the shared parent of `AUTH_URL`/`WEB_URL`, derived in
  `better-auth.ts` - BetterAuth's own default is `AUTH_URL`'s full
  hostname, which the web app can't read) and explicit
  `credentials: true` CORS naming the web app's exact origin (never a
  wildcard) are both required for the cookie to survive the round trip.
  Local dev (both on `localhost`) can't catch a mistake here, since
  cookies ignore ports -
  see Deploy.md's gotcha #6 if sign-in stops persisting after a deploy
  change.
- **`/api/auth/get-session` and `/api/auth/token` are exempt from
  BetterAuth's rate limiter** (`rateLimit.customRules` in
  `better-auth.ts`). The web app's *server* calls them on every user's
  behalf, so they'd all share that server's one per-IP bucket (100 per
  10s by default, production only - it's off in dev, so local testing
  won't show it), and a few quick page changes by anyone locked everyone
  out with "Missing bearer token". Relatedly, `packages/app/src/api-client.ts`
  reuses one API token until shortly before it expires (browser) or per
  page render (server) - keep it that way rather than minting a token per
  API call.
- **`isGlobalAdmin`/`locale` are BetterAuth `additionalFields` with
  `input: false`.** They come back for free on `/api/auth/get-session`'s
  `user` object (so the web app doesn't need a second call to
  `/users/me` just to build a session), and `input: false` makes
  BetterAuth's own update-user endpoint reject any client attempt to set
  them directly - the only legitimate way to set `isGlobalAdmin` is the
  `databaseHooks.user.create.after` bootstrap-admin-emails hook, or a
  dedicated API endpoint that itself re-derives authorization first.
- **If you touch `apps/api/src/auth/better-auth.ts` or `main.ts`'s auth
  mount**, keep `apps/api/tsconfig.json`'s `declaration: false`. Without
  it, `tsc` demands every type nested in BetterAuth's inferred config
  be nameable from the API, and some come from packages pnpm keeps out of
  its reach (`@simplewebauthn/server`, BetterAuth's own zod) - this isn't
  a style preference, the build doesn't type-check without it. (The API
  is ESM with `NodeNext` resolution since issue #117; relative imports
  end in `.js`.)
- A `createServerFn` used from client-reachable code must live in a file
  that exports *only* `createServerFn` results, calling plain functions
  defined in a *different* module for the actual logic - a plain function
  living alongside a `createServerFn` in the same file has, in practice,
  ended up bundled into the client JS (verified by inspecting
  `dist/client` output). This mattered most while auth lived in
  `apps/web`; now that it doesn't, the server functions
  (`packages/app/src/server-auth.ts`) are thin HTTP-forwarding wrappers with no
  Prisma/crypto dependencies to leak in the first place, but the
  discipline still applies to anything else added there later.
