# The live session

Issue #247 (and #305, #270). **Agreed, being built** (the questions are answered under "Decided"). It turns sync play's set session (issue #13), today a value in Redis,
into a thing of its own that Oneverse Pulse can mirror and take over, that every
controller changes the same way, and that keeps a record of what happened.
Written 2026-10-22 from the architecture review of `main` at 103bc4e.

## What it is today

| Aspect | Today (`apps/api/src/sync/sync.server.ts`, `packages/core/src/sync/`) |
| --- | --- |
| Identity | A Redis key per set (`songverse:sync:session:<setId>`), 12 hours after the last change; no row, no id |
| Control | The leader and the screens' operator are stored by WebSocket connection (`instance:connectionId`); since #312 the operator's hold waits a minute for a dropped connection |
| Order | Three counters: `rev`, `presentingRev` (checked against `basedOn`, which is optional), and the stage's own `rev` in another key |
| What's shown | `presenting = {itemId, slide, black}`: slide N as each client cuts the item, with nothing to tell that the item changed |
| Record | None: a change replaces the last |
| Messages | Typed in core, checked by hand in the server (`validPresenting`, `validStems`…) |
| Code | One class serving the session, the stage, screens, notes, presence and co-editing |

## What it should give

1. **An id.** A session is something Pulse mirrors, a screen follows and a record belongs to.
2. **Control that belongs to a person on a device**, not to a connection: a reload or a Wi-Fi blip changes nothing; a hand-over is explicit and the one who loses control is told.
3. **One way to change it.** Every change is a command: checked (who, against what it was decided from), ordered, applied by one reducer, acknowledged, and logged.
4. **A takeover without split brain.** Pulse runs the session on the venue's network when the internet goes, and the room's version wins when it comes back (#247).
5. **Today's clients keep working** while it's built: the messages they send now are translated.

Not now: a session without a set, rooms and output groups (#284), the Cue capability's
interface for singers. The design leaves room for them.

## The model

```prisma
/// A set run live (issue #247): what Pulse mirrors and the record belongs to.
model LiveSession {
  id          String            @id @default(cuid())
  setlistId   String
  status      LiveSessionStatus @default(LIVE) // LIVE | ENDED
  /// Goes up each time another authority takes the session (Pulse offline, the cloud back).
  epoch       Int               @default(0)
  /// "cloud", or "pulse:<node id>" while a Pulse runs it on its own.
  authority   String            @default("cloud")
  startedById String?
  startedAt   DateTime          @default(now())
  endedAt     DateTime?

  setlist  Setlist              @relation(fields: [setlistId], references: [id], onDelete: Cascade)
  startedBy User?               @relation(fields: [startedById], references: [id], onDelete: SetNull)
  commands LiveSessionCommand[]

  @@index([setlistId])
  // One LIVE session per set: a partial unique index in the migration.
}

/// One accepted command (the record): who, from which device, at which revision and epoch.
model LiveSessionCommand {
  id        String   @id @default(cuid())
  sessionId String
  rev       Int
  epoch     Int
  at        DateTime
  userId    String?
  deviceId  String?
  /// "cloud" or "pulse:<node id>": where it was accepted.
  origin    String
  op        Json

  session LiveSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user    User?       @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([sessionId, rev])
}
```

`UserDeletionService` needs nothing new (`SetNull`, `Cascade`). A session nobody changed
for 12 hours is ended by a scheduled job on the Worker, as other clean-ups are.

The state stays in Redis while it's live, under the set's key as before (one live session
per set), carrying its `sessionId` and `epoch`. A session running when this is deployed is
given its row and id at its next change and carried on.

## The state

```ts
interface LiveState {
  sessionId: string;
  epoch: number;
  /** Goes up with every accepted command. */
  rev: number;
  /** The revision at which each part last changed: what a command is checked against. */
  changed: { lead: number; tempo: number; presenting: number; screens: number; stage: number };
  leader: Lease | null;
  screens: (Lease & { exclusive: boolean }) | null;
  presenters: { id: string; name: string }[];
  metronome: SyncMetronome | null;
  stems: SyncStems | null;
  itemId: string | null;
  presenting: { itemId: string; slideKey: string; slide: number; black: boolean } | null;
  stage: { timer: SyncTimer | null; message: { text: string; at: number } | null; layers: SyncLayers };
}

/** Control held by a person on a device, renewed while they're there. */
interface Lease {
  userId: string;
  name: string;
  deviceId: string;
  leaseId: string;
  /** Server time (ms); renewed by the device's pings. */
  expiresAt: number;
}
```

One `rev` orders everything, so the stage and the slides can't pass each other any more.
A command is refused as stale only when **the part it changes** changed after the revision
it was decided from (`changed`): a new message to the stage doesn't make a Next pressed
at the same moment stale, two Nexts do.

## Commands

Every change is a command, sent by any controller, the leader's Live, the operator's
console, a Stream Deck, or Pulse:

```ts
type LiveCommand = {
  type: "command";
  /** Chosen by the device: a command sent twice (a resend after a drop) is applied once. */
  id: string;
  session: string;
  epoch: number;
  /** The rev the device had when it decided. Required. */
  basedOn: number;
  op:
    | { kind: "present"; presenting: Presenting | null }
    | { kind: "stage"; command: SyncStageCommand }
    | { kind: "tempo"; metronome?: SyncMetronome | null; stems?: SyncStems | null; itemId?: string | null }
    | { kind: "take"; part: "lead" | "screens"; exclusive?: boolean }
    | { kind: "release"; part: "lead" | "screens" }
    | { kind: "presenter"; userId: string; allow: boolean }
    | { kind: "end" };
};
```

The server answers `{type: "ack", id, rev}`, or `{type: "error", id, code}` with `stale`,
`forbidden`, `epoch` or `bad-request`; the state that follows says where things are.

- **One reducer**, `applyLiveCommand(state, command, now)`, pure, in `@oneverse/core`
  (`live/`), with **conformance cases** (`packages/core/conformance/`). The API runs it, and
  so does Pulse (in Rust, against the same cases), so the two can't disagree on what a
  command does. Pulse runs this same TypeScript in a small Node process (brice, 2026-10-22);
  its Rust part keeps what Rust is for (NDI output, audio and timing, later MIDI and DMX).
- **Messages as zod schemas in core**, like the API's requests: the server validates with
  them, Pulse and the native apps (#171) get the same definitions and cases.
- **Who may** is decided before the reducer, by capability (below), fresh as today (every
  30 seconds, and on each command).
- **Today's messages** (`present`, `update`, `stage`, `screens`, `presenter`, `lead`,
  `end`) are translated to commands by the gateway, with `basedOn` taken from the part's
  last change when they don't say. The `session` message keeps its shape, plus
  `sessionId`, `epoch` and the presenting's `slideKey`.

## Leases

- A device has an id: a random one kept on the device (a browser's storage, a native app's
  settings), a screen's own id, a Pulse's node id.
- Taking the lead or the screens gives a lease of **60 seconds**, renewed by the device's
  pings. A dropped connection doesn't end it; its expiry, or a release, does. Coming back on
  the same device within it, the device is still the leader or the operator, without asking.
  (#312's minute of grace becomes this.)
- **Taking over is explicit.** Someone who may lead takes the lead from someone else (as
  today); the previous holder gets `{type: "taken", part, by}` and Live says so. An exclusive
  hold on the screens refuses others' commands; the set's editors may break it with
  "Take back", logged and told.
- The session's `presenters` (handed over live, #305) are the session-scoped grant; a role
  assignment scoped to a set or a session (#270) comes later the same way.

## Who may do what

| Command | May | Today's equivalent |
| --- | --- | --- |
| Follow (join, hear the state) | Anyone who can open the set; screens of the set | `canView` |
| `tempo`, `take lead` | Who can edit the set | `canLead` |
| `present` | The leader, the screens' holder, presenters, a role that runs screens (`canOperateScreens`) where the set's team or organisation has it; not while someone else holds the screens alone | `mayPresent` |
| `stage`, `take screens` | Who can edit the set, or a role that runs screens | `canLead \|\| canOperate` |
| `presenter` | The leader | same |
| `end` | Who can edit the set | same |

Cue (next song or section for singers), Route and Manage devices are added as rows here
when they're built; each is a field on `Role` read through `capabilitiesIn`, as
`canOperateScreens` is.

## What's on the screens: the slide key

`presenting` carries a `slideKey`: a short hash of everything `setItemSlides()` cuts the
item from: a song's chart revision and arrangement (and its revision), a text's content,
a passage's reference, translation and template. `slideKey(item)` lives in core beside
`setItemSlides()`. A client whose own key for the item differs fetches the item again;
still different, it shows the slide's label rather than another slide's words. A slide
number then always means the same words on every screen, even when someone edits the song
mid-service. For a YouVersion passage the key covers what we ask for; if YouVersion answers
one screen differently, that screen can't know.

## The record

Each change applied (a command, an old message, or the server's own `leave` and `back`) is
appended to one Redis stream (`songverse:live:record`, capped) as it's applied, and the Worker
writes the stream to `LiveSessionCommand` every minute; an entry whose session has no row is
dropped. It's what Pulse sends back after an outage, and later what a set's page shows ("who
moved the screens at 10:42"). It's kept 90 days after the session ends.

## Pulse: offline and back

- **Online**, Pulse is a member signed in with its own token (paired and owned like a screen):
  it follows the state and the stream, and keeps the sets it needs (#195, #247's local copy).
- **The internet goes.** Clients that lose the cloud find Pulse on the network (#247's
  discovery) and join it. Pulse takes the session on from its mirror, the same revision,
  slide and metronome timeline: `epoch + 1`, `authority: "pulse:<id>"`, revisions going on
  from where it was. Commands on the network carry the new epoch; Pulse runs the same reducer
  and keeps its own record.
- **It comes back.** Pulse sends the cloud its state and its record since the revision it last
  had from it. Under the session's lock the cloud takes the room's state as it is (the room
  wins), adds Pulse's commands to the record with their origin, and sets the epoch and
  `authority: "cloud"`. A command still carrying the old epoch is refused (`epoch`), so a
  device that kept talking to the cloud during the outage is told to load the state again,
  never silently rolled back or forward. Changes to the **set itself** during the outage are
  not the session's: they're applied between songs, as #247 says.
- **How the room's devices reach Pulse** (brice, 2026-10-22): Pulse serves the console and
  Live itself, on its own address. A page from the cloud (https) can't open a connection to
  a box on the local network, so it can't switch over by itself; the cloud knows Pulse's
  local address while Pulse is online, and when the cloud is gone the page shows
  **Continue on Pulse**, a link to it, which works with no internet. An automatic switch
  (a name and certificate per Pulse under oneverse.top) may come later on top of it.
- **Signing in to Pulse offline** (brice, 2026-10-22): a pass from the cloud. While it's there,
  a device in a set asks for one (`{type: "pass"}`) and gets it signed with the cloud's
  Ed25519 key (derived from `BETTER_AUTH_SECRET`): who, on which device, for which set, what
  they may do there (`canLead`, `canOperate`), for 12 hours (`LIVE_PASS_MS`). "Continue on
  Pulse" carries it; Pulse checks it with the cloud's public key, which it's sent with its own
  pass, and `verifyLivePass` in core (live/pass.ts), without the internet. The same rights in
  the room as in the cloud, as of when the pass was signed. Pulse's room server (`apps/pulse/src/room.ts`) is the
  cloud's `/sync` for the venue's network, entered with a pass (`{type: "enter", pass}`).
- While the room runs offline, the cloud keeps accepting commands from anyone still
  connected to it: it can't tell an outage from a Pulse that stopped,
  and refusing everyone because a mini PC was unplugged would be worse. On reconnection
  the room's state replaces what they did, and the record keeps both.

## Where the code goes

- `@oneverse/core`: `live/`: the state, the commands as zod schemas, `applyLiveCommand`,
  `slideKey`, and a headless `LiveClient` (connection, sign-in, clock, join, reconnect
  with its lease, commands with acks) that Songverse's sync client, the operator console,
  the screen display and the native apps build on.
- `apps/api/src/sync/`: a gateway (connections, sign-in, pings, rate limits, the old
  messages translated) handing to `LiveSessionService` (`apps/api/src/live/`), and to the
  notes, presence and co-editing services, each in its own file as they are in the class
  today.
- Oneverse Pulse: the live engine is this code, in a Node process on the mini PC; its Rust
  part sends the screens' output over NDI and, later, plays audio and drives MIDI and DMX.

## Order of work

1. Split the sync server into the gateway and its services, behaviour unchanged (the e2e
   suites as they are). **Done** (#314).
2. The reducer and the messages' schemas in core, with conformance cases; the server uses
   them on today's state. **Done**: `applyLiveOp` in `packages/core/src/live/`, its cases in
   `conformance/live.json`; the stage's commands still go through `applyStageCommand`.
3. `LiveSession` and its id; `sessionId` and `epoch` in `session`. **Done**: the row is
   made when a session starts and ended when it ends, or hourly by the Worker once its state
   is gone from Redis (`apps/api/src/sync/live-sessions.ts`).
4. Leases in place of connections. **Done, first part**: a device says its id when it joins
   (`syncDeviceId()`, one per browser tab, kept across reloads); the lead and the screens are
   held by `d:<userId>:<deviceId>`, so the same device back within the minute holds them again
   without asking, and another account can't claim them by the id. The lease is still the
   minute after a drop (`LIVE_SCREENS_GRACE_MS`) rather than renewed by pings, and the leader
   keeps the lead while away, as before.
5. Commands with ids and acks; the old messages translated; `basedOn` required for new clients.
   **Done, server side**: `{type: "command", id, epoch?, op}` is answered with `ack` (and the
   revision) or an `error` carrying its id; a resend is acknowledged, not applied again; another
   epoch is refused (`epoch`). The old messages go through the same code without an id. The
   clients move to commands with the shared `LiveClient` (step 8).
6. The record (stream, then the table). **Done**: one stream for every session, written by the
   Worker every minute (`record-live-sessions`); sessions ended more than 90 days ago are
   deleted with their record by the hourly clean-up. Both can be run from Admin > Background
   jobs.
7. `slideKey` in `presenting`. **Done**: `slideKey(slides)` in core hashes the slides' words
   (FNV-1a, shared cases in `screens.json`); the operator's controls and the console send it, a
   screen app whose own key differs loads the set again (once per key) and shows no words while
   it still differs, and the same slide with another key is a change (`samePresenting`, now
   shared by the clients). Pulse's player screen doesn't check it yet: it moves to it
   with the `LiveClient` (step 8).
8. `LiveClient` in core, and the apps moved onto it. **Done, first part**: `LiveCommands` in
   core (`live/commands.ts`) keeps each command until the server answers it, sends again what
   wasn't answered once the device is back in the set, and shows the slide asked for while it's
   on its way (`view`), so a phone on a weak signal doesn't see the slide jump back, and the
   screens get it when the connection returns. Songverse's sync client and the console's live
   client send their slides through it, and show "sending…" meanwhile
   (`e2e/web/live-weak-connection.test.mjs`). The other messages (lead, metronome, stage) are
   still the old ones, and the two clients aren't one `LiveClient` yet.
9. Pulse's mirror and takeover: the same engine in Node on the mini PC. **Done, first part**
   (the engine and the cloud's side): `LiveEngine` in core (`live/engine.ts`) follows the
   cloud's session (`mirror`), takes it over one epoch up (`takeOver`), applies the room's
   commands with the same reducer, once each, keeping their record, and hands both back
   (`handBack`). The cloud sends the kept session (`live`, holders' devices and all) to a
   device that asked to `mirror` it, and takes a `handback` under the set's lock
   (`liveHandedBack`: the room's state, one more epoch up, its revisions past both sides'),
   adds the room's changes to the record with their origin, and marks the row. A revision
   is unique within its epoch in the record now, since both sides go on from the same one.
   For now a handback is taken from anyone who can edit the set (who could make the same
   changes one by one); Pulse's own sign-in comes with its pairing. The Node process is
   `apps/pulse` (`@oneverse/pulse`): `CloudLink` mirrors one set, runs it in the room after
   `OUTAGE_MS` without the cloud, and hands it back first when it's back
   (`e2e/api/pulse-link.test.mjs`). Still to do: the room's side (Pulse's own page, how the
   room's devices reach it, below, and sign in to it offline), Pulse's own sign-in, and
   running it on the mini PC.

Each step is its own commit with its tests; steps 1 to 8 change nothing a user sees except
#312's behaviour, at step 7 screens that no longer show the wrong words after an edit, and at
step 8 a slide that waits for a weak connection rather than jumping back.

## Decided

brice answered the four questions on 2026-10-22:

1. **During an outage the cloud keeps accepting commands.** Not every venue has a Pulse, so
   a session must work both ways: without one, the cloud is the only authority and nothing
   about an outage changes; with one, the room's state wins when Pulse comes back, and the
   record keeps both.
2. **The set's editors may break an exclusive hold** ("Take back"): explicitly, logged, and
   the operator is told.
3. **The record is kept 90 days** after the session ends, then removed by the Worker.
4. **A lease lasts 60 seconds**, renewed by the device's pings.
