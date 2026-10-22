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

The state stays in Redis while it's live, keyed by the session's id
(`live:session:<id>`, with `live:set:<setId>` naming the set's live session). A session
running when this is deployed is read from the old key once and carried on.

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
  command does.
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

Each accepted command is appended to a Redis stream (`live:log:<id>`) as it's applied, and
the Worker writes the stream to `LiveSessionCommand` every few minutes and when the session
ends. It's what Pulse sends back after an outage, and later what a set's page shows ("who
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
- Oneverse Pulse: the same state, schemas and conformance cases, in Rust.

## Order of work

1. Split the sync server into the gateway and its services, behaviour unchanged (the e2e
   suites as they are).
2. The reducer and the messages' schemas in core, with conformance cases; the server uses
   them on today's state.
3. `LiveSession` and its id; Redis by session; `sessionId` and `epoch` in `session`.
4. Leases in place of connections.
5. Commands with ids and acks; the old messages translated; `basedOn` required for new clients.
6. The record (stream, then the table).
7. `slideKey` in `presenting`.
8. `LiveClient` in core, and the apps moved onto it.
9. Pulse's mirror and takeover, against the conformance cases.

Each step is its own commit with its tests; steps 1 to 8 change nothing a user sees except
#312's behaviour and, at step 7, screens that no longer show the wrong words after an edit.

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
