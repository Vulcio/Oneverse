# Oneverse ecosystem — architecture blueprint

**Status:** Agreed product direction; proposed technical boundaries, **not** a description of completed migrations.  
**Date:** 2026-10-23 (revision 4: the live session and Pulse's offline side built, locations)  
**Audience:** engineering and coding agents  
**Parent-company branding:** out of scope.

## 0. Decisions so far

| Decision | Status |
|---|---|
| Stay in one monorepo, renamed `Vulcio/Oneverse` (was `Vulcio/Songverse`); Sonic and the player stay in their own repositories | Decided (2026-10-21) |
| The operator is Oneverse's: authorised by Oneverse, its console a Oneverse surface | Decided (2026-10-21) |
| Scriptures start with imported Bibles (Zefania, Beblia, OSIS XML), stored in one JSON format compatible with json-bible | Done (2026-10-21) |
| YouVersion's licensing is settled with YouVersion, not managed in Oneverse: its passages go on screens, read live, never stored or offline | Decided (2026-10-22) |
| Workspace packages renamed `@oneverse/*` (was `@songverse/*`); Songverse's image is `Dockerfile.songverse` (was `Dockerfile.web`) | Decided (2026-10-21) |
| Each app on its own domain: oneverse.top, songverse.top, planiverse.top (replacing songverse.one), sign-in through Oneverse ("Sign in with Oneverse": accounts and passkeys at oneverse.top, each app its own session) | Decided (2026-10-21) |
| The live session is its own entity, its design in `docs/live-session.md` (#247): commands checked against a revision, device leases of 60 s, a record kept 90 days, an epoch for Pulse's takeover; the cloud keeps taking commands during an outage (not every venue has a Pulse) | Built (2026-10-22, steps 1 to 9) |
| Pulse runs the same TypeScript live engine as the cloud, in Node; Rust keeps what needs it (NDI output, audio, timing, MIDI and lighting) | Decided (2026-10-22) |
| Offline, phones and tablets reach Pulse through "Continue on Pulse": a link to Pulse's own page, carrying a pass the cloud signed (valid 12 hours, checked by Pulse offline); no automatic switch | Built (2026-10-23) |
| Native apps (#165): native shell, UI and playback for stage views; they share logic only (core's JS, or native ports checked against the shared tests), decided per feature; the web UI stays for editing, sets, admin and planning | Decided (2026-10-22) |
| Locations (#320): an organisation's or a team's, picked by events beside their free-text place; a Pulse can follow every event at one | Built (2026-10-23) |
| NDI (#196): Oneverse Screen shows any NDI source on the network - Pulse's output or a video mixer's; what a Screen contributes (its camera, its screen capture) goes to a video mixer, not to Pulse, which doesn't take NDI in | Decided (2026-10-23) |
| Oneverse Screen is hybrid: an NDI feed under the web content, the operator switching between the NDI sources the Screen sees, the theme placing the feed (its video layer gains an `ndi` source and a position and scale); browsers show the base instead (#196) | Decided (2026-10-23), not built |
| Organisations govern their teams' Sets rather than owning Sets | Decided (2026-10-23) |
| Joining an organisation needs no owner's approval: a link the organisation gave is its consent (step 5 of the 2026-10-22 plan, an approval request, dropped) | Decided (2026-10-23) |
| An imported Bible's licence is the importer's to settle before importing it, as YouVersion's is settled with YouVersion; its per-Bible rights stay as built | Decided (2026-10-23) |

## 1. Product map

```mermaid
flowchart TB
  CORE["ONEVERSE CORE<br/>Identity · Workspaces · Permissions · Universal Sets<br/>Scriptures · Screens · Live sessions · Operator · Shared APIs"]
  S["Songverse (Web)<br/>Music and musicians"]
  SA["Songverse (App)<br/>Native iOS + Android · offline-first"]
  P["Planiverse<br/>Events · Rotas · Groups · Schedules"]
  SL["Slideverse<br/>Presentations · PPTX/PDF imports · Slide editing later"]
  SO["Songverse Sonic<br/>Stem separation and music analysis API"]
  SW["Oneverse Screens Web<br/>Built into Oneverse"]
  SN["Oneverse Screen<br/>Android · Android TV · iOS · iPadOS · tvOS<br/>Web + NDI display"]
  PLAYER["Oneverse Pulse<br/>Rust on-site runtime · LAN/offline fallback"]
  CORE --> S & SA & P & SL
  CORE --> SW & SN & PLAYER
  S -. "Music processing" .-> SO
  SA -. "Songverse music services" .-> SO
  S & SL & SW -. "Shared live-session controls" .-> CORE
```

**Product naming:** Use **Songverse (Web)** for the browser application and **Songverse (App)** for native Android/iOS musician clients. Never label the latter “Songverse Native.” The presentation application is **Slideverse** (decided 2026-10-22). **Oneverse Screens Web** is built into Oneverse; the separate native display receiver is **Oneverse Screen** (`Vulcio/oneverse-screen`). **Oneverse Pulse** (`Vulcio/oneverse-pulse`, renamed from `songverse-player` on 2026-10-22) is the Rust on-site runtime; its Cargo package and binary still use the transitional name `songverse-player`.

## 2. Responsibility and ownership boundaries

| Product / component | Owns | Does not own |
|---|---|---|
| **Oneverse Core** | Identity, account/session management, personal workspaces, Teams/Organizations, membership, roles and scoped capabilities, invitations, universal Sets, scripture catalog/access, shared device registry, screens/outputs/profiles, shared live sessions, the operator console, content/media contracts and APIs | Song editing, music analysis, general rota workflows, presentation authoring |
| **Songverse (Web)** | Song library, charts, chords, arrangements, music-specific Set behavior, practice/live musician UX, narrowly scoped musician controls of a session | Device ownership or authoritative live-session state |
| **Songverse (App)** | Native mobile experience for musicians, locally cached content, reliable offline usage and reconciliation, native-specific UX | Separate identity/ownership model |
| **Songverse Sonic** | Independently deployable audio processing API: stem separation, tempo/key/beat/section analysis | User/Team/Organization identity, universal Sets |
| **Planiverse** | Events, recurring schedules, homegroups, cleaning rotas, assignments, calendars, planning UX | Core membership and permission primitives |
| **Slideverse** | Import PowerPoint (PPTX) and PDF, presentation organization and playback semantics, scripture presentation layouts; later simple slide editing | Screen registration, scripture-provider account authority |
| **Oneverse Screens Web** | Oneverse-integrated management and browser receiver/control UI | Separate ownership and permissions |
| **Oneverse Screen** | Native display app on Android, Android TV, iOS, iPadOS and tvOS (`Vulcio/oneverse-screen`, code published 2026-10-22): NDI playback and contribution, hybrid display of the web screen with NDI sources, cached display content and resilient playback | Song and presentation editors |
| **Oneverse Pulse** | Rust on-site runtime and fallback node on a venue mini PC: local services and session mirror, cached authorised data, LAN takeover on WAN loss, screens (HDMI, future NDI) through the shared renderer; later audio and timing, local orchestration, MIDI and lighting | Alternate content models or duplicated screen renderer |

**Principle:** Oneverse owns reusable identities, assets, permissions, devices and coordination; each application owns its domain-specific authoring, rendering adapters and workflows. Logical ownership is **not** a mandate for separate repositories, servers or databases.

## 3. What Core already is (2026-10-21)

Most of Core exists today inside `apps/api` and the shared packages. Core is first a boundary to draw, then three real migrations (section 6).

| Concept | Today | Gap |
|---|---|---|
| One account, personal space, Teams, Organisations | BetterAuth in `apps/api`; `Team.organizationId`; organisation mode NONE / SINGLE / MULTI (#241) | Joining an organisation follows joining a team (`joinTeamOrganization()`), not an owner-approved request |
| Planiverse on the same accounts | `apps/planiverse`, `packages/planning`, `packages/app` (#241, #242) | None |
| Scoped capabilities | `Role` + `RoleAssignment` to a user or a team, combined by `capabilitiesOf()`; an assignment scoped to a team or an organisation (#270), given by its admins for team-assignable roles (Media operator), read by `capabilitiesIn()` for running screens | Scoped to a set or a session; the plan's other capabilities (follow, cue, route, manage devices) |
| Universal Sets | `Setlist` owned by a user or a team; `SetlistItem.kind`: songs, texts (#305), Bible passages (#301) | PDF pages, PPTX slides, media |
| Screens owned by person, Team or Organisation | `Screen.owner*` (#222), token hash, revocable | Profiles and pairing again: #284 |
| Layer stack, templates, brands | #280, #287, #281, #279 | None |
| Live session | `LiveSession` row with an `epoch`, `SyncSession` in Redis, one per set: `rev`, leader, `presenting`, media operator (#190, #275); commands through `applyLiveOp` in core (`conformance/live.json`), acknowledged and resent after a drop; device leases; the record (90 days) | Keyed by set; scoped to a set or session in roles |
| Locations | `Location` owned by an organisation or a team (#320); `locationId` on events and presets | Pulse following one |
| Common slide protocol | `setItemSlides()` in core for songs, texts and passages (a passage's template sets its verses per slide, #310); `SyncPresenting` = item + slide number, commands checked against `basedOn` (#305) | Image and media slides |
| Oneverse Pulse | Rust daemon serving Songverse's `ScreenStage` bundle (`Vulcio/oneverse-pulse`); `apps/pulse` in the monorepo: the live engine in Node, mirroring the cloud, taking over after 10 s offline and handing back, the set copied to disk, the operator console served to the venue's network with passes checked offline | Live on its page, the room's screens offline, a run on the mini PC (`Vulcio/oneverse-pulse`'s `docs/roadmap.md`) |
| Sonic | Independent; Teams and Organisations can bring their own server (#300) | None |

## 4. Shared models and invariants

- **Identity/workspaces:** one Oneverse account; personal space without a Team; Teams may exist without an Organization; a Team joins an Organization through the Organization's own link or one of its admins, with no separate approval step. Planiverse's team-centric onboarding may differ from Songverse's. Applications remain independently usable.
- **Permissions:** authorize by capability and scope (personal / Team / Organization / specific Set or live session), not solely a global flag. A role assignment carries its scope; a new right stays a field on `Role`. Organization administrators do not implicitly own members' personal data. Keep a distinction between *resource ownership* and *permission to use*: an Organization owns its screens and brands; it governs, not owns, its Teams' Sets.
- **Universal Sets:** ordered, typed references to songs, scripture passages, Slideverse decks/slides, media and future items. A set item has a `kind` and one nullable foreign key per kind (not a generic JSON reference), so deletion, song folding and access checks keep working in the database. Passages are the deliberate exception: a reference plus a translation (`{bibleId}` or `{youversionId}`), since a translation can be deleted and a provider's has no row of ours. Set ownership, sharing, item resolution and live sequence state belong to Oneverse; interpretation of a song/deck remains with its product. Existing Songverse Sets migrate compatibly (every existing item is `SONG`); a resource reference never grants unrestricted access to its entire source library.
- **Common slide protocol:** each item kind has an adapter in `@oneverse/core` turning it into slides of a few generic kinds: lines of text (songs, passages), an image (a PDF page, a PPTX slide rendered at import) and media. `ScreenStage` renders those kinds only, so a screen never needs the authoring app installed. `presenting` carries the item's revision with the slide number, so a slide number stays meaningful when an item changes mid-service.
- **Scriptures:** see section 5.
- **Screens:** persistently owned by person, Team or Organization irrespective of who paired the device. Oneverse stores pairing credentials, revocation, capabilities, output assignments, and active display profiles; the screen's current configuration follows the selected profile. Rendering uses a fixed-order configurable layer stack: base → video input → media → content → overlays → final mask. Templates compose reusable themes; shared edits propagate, subject to explicit screen-level overrides.

## 5. Scriptures

- **Translations** are imported files or, later, provider-backed. Imports first: Zefania XML, Beblia XML and OSIS XML, detected from the file, converted to one JSON format: the [json-bible](https://github.com/ChurchApps/json-bible) shape (`name`, `metadata`, `books[].chapters[].verses[]`, `endNumber` for combined verses) with a few fields of our own (each book's OSIS id, the language, the abbreviation, the source format). json-bible is what FreeShow uses, so a Bible converted for one works in the other.
- **Rights are data:** each translation records what it may be used for (search, offline copies, projection, export) and its copyright line, checked wherever the text goes: the API, offline caches, the player's snapshot, exports. Public-domain texts (KJV, Louis Segond 1910, WEB, …) and texts the Organisation is licensed for are the safe start.
- **Who has them:** an instance's admin imports translations for everyone; later an Organisation or Team imports its own, licensed to it.
- **Passage references** ("John 3:16-18", "Jn 3:16; 4:1-3") are parsed in `@oneverse/core`, with book names and abbreviations in each language, and resolved against a translation. A Set holds a passage as a reference plus a translation, never a copy of the text.
- **YouVersion** (#304, #310): a provider through its Platform API, with an App Key set in Admin > Bibles. Licensing is settled with YouVersion, not managed in Oneverse: a set holds a YouVersion passage as `{youversionId, reference}`, its text read from YouVersion each time it's shown - on screens too - with the version's copyright line and link, never stored and never in the copies kept offline.

## 6. Operator and live-session model — agreed direction

**Operator is a Oneverse capability and a Oneverse surface.** Oneverse authorises session and output control, and the operator console is Oneverse's own, not Songverse's. Its code lives in a shared package (as the planning screens live in `packages/planning`), `packages/operator`, served by the screen app at screen.oneverse.top/operate (signed in through Oneverse, #305) and embedded in Songverse's Live. App surfaces offer tailored controls:

- **Oneverse operator console:** general-purpose Set navigation, preview/program, screen and output routing, overlays, black/clear, profile selection, session health and takeover.
- **Songverse (Web/App):** singers and leaders may get narrowly scoped controls (e.g., next song/section, advance, cue) for their assigned Set/session **without** permission to re-pair devices, alter Team ownership or manage unrelated outputs.
- **Slideverse:** presentation-specific navigation, cues and slide controls against the **same** Oneverse session.

Capabilities, each scoped to an Organisation, Team, Set or session:

| Capability | Can |
|---|---|
| Follow | See the session |
| Cue | Next/previous song or section in their assigned Set |
| Present | Drive slides, black, clear |
| Route | Layers, outputs, profiles, overlays |
| Manage devices | Pair, re-pair, revoke screens |

Precedence follows #275: an exclusive operator holds Present and Route; the leader keeps Cue. Built: Follow, Present, and Cue (#322, a `cue` command and `Role.canCue`, scoped like `canOperateScreens`). Handoff is an explicit "take" with a lease, logged, and the previous holder is told. #270 (the media operator as a role of its own) is where this lands first.

The authoritative **Oneverse Live Session** tracks active Set/item/slide, target output groups, control privileges, sequence/revision, and active controller state. It evolves `SyncSession` rather than replacing it: commands carry the `rev` they expect, so they are idempotent and a stale controller is refused. Screen apps render the session; they do not independently decide its truth. Its design - commands, leases, who may do what, the slide key, the record, Pulse's offline side - is in `docs/live-session.md`, built in nine steps on main (2026-10-22 and 23).

**Offline safety:** normally the cloud Oneverse session leads. Oneverse Pulse runs the same engine (TypeScript, in Node), mirrors the session and keeps a copy of the set, and takes over as the room's authority after 10 s without the cloud. The session carries an **epoch**: the takeover starts a new one, the cloud keeps accepting commands meanwhile (a venue may have no Pulse), and on reconnect the room's state is handed back (#247: the room wins), its commands kept in the record. Phones and tablets follow through "Continue on Pulse", with a pass the cloud signed while online. This is tested end to end in CI (`e2e/web/pulse-console.test.mjs`); it has **not** run on the mini PC yet, so it is not a guarantee at a venue.

## 7. Implementation strategy / migration

1. **Stay in the monorepo.** `Vulcio/Oneverse` (renamed from `Vulcio/Songverse`) hosts Songverse, Planiverse, the NestJS API, Prisma DB, and shared packages `@oneverse/core`, `@oneverse/app`, `@oneverse/ui`, `@oneverse/planning`. One schema, one API, one e2e harness and atomic changes across them are worth more than separate repositories. Sonic (Python) and the player (Rust) stay separate: different languages, deployed on their own. Map dependencies and preserve working routes, contracts and deployed behavior.
2. **First vertical slice: a scripture passage on the screens.** It exercises typed Set items, the common slide protocol and licensing, without Slideverse, renames or a new session model:
   1. Scriptures: Bible imports (Zefania, Beblia, OSIS) to the JSON format, passage references, rights fields. *(done; the whole slice is on main, #301, #305, #310)*
   2. Typed Set items, songs only: `SetlistItem.kind`, no behaviour change.
   3. The slide contract in core, with conformance cases, and the item revision in `presenting`.
   4. A `PASSAGE` item kind, rendered by `ScreenStage`.
3. **Then** scoped role assignments (starting with #270's operator), then the session as its own entity, designed with the player's snapshot contract (#247). *(done: scoped roles, and `docs/live-session.md` steps 1 to 9)*
4. **Done** (#320, 2026-10-23): locations, Pulse paired like a screen and shown as a Pulse node, following every event at a location with its own token. **Next:** Live itself on Pulse's page and a first run on the mini PC (Pulse's roadmap), and the remaining operator capabilities (section 6).
5. **Evolve existing issues, don't duplicate them.** Shipped foundations: #241, #242, #222, #279, #280, #281, #287, #190, #275. Open and relevant: #247 (offline player), #270 (operator role), #284 (profiles, pairing again), #195 (offline screen), #196 (NDI), #187 (Google TV), #165 and #171 (native apps), #243 (custom domains), #26 (offline creation). Inspect open **and closed** issues before drafting changes.
6. **The player is now Oneverse Pulse** (`Vulcio/oneverse-pulse`, 2026-10-22): the repository, README and scope are renamed; its Cargo package, binary and service units still say `songverse-player`, to rename through an issue. Preserve the upstream shared `ScreenStage` renderer; do not fork rendering implementations. `vulcio/songverse-sonic` remains independent.
7. **Agent rules:** read each repository's `AGENTS.md` and `CLAUDE.md` before editing. GitHub issue first, reference issue(s) in commits, tests/docs with every change, no unverified claims of hardware/offline reliability, no push with failing checks. This document does not override repository-specific instructions.

## 8. Open design questions

Proposed answers are in sections 4–7; still open:

- Oneverse's own entry point and domain topology (Home, operator console), with self-hosting on one server; tied to #243.
- What a guest may do in a session (lease length, 60 s, and the record's retention, 90 days, are decided).
- Which item kinds after passages: PDF pages or PPTX slides first.
- How Oneverse Screen (now on GitHub, with NDI playback and contribution and a hybrid Web+NDI display) reaches release on each platform, validated on hardware, measured with #286's reports.

**Guiding rule:** one shared model and authority, multiple purpose-built applications, independent entry points and resilient display clients.
