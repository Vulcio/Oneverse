# Oneverse Pulse's live engine

The Node process Oneverse Pulse runs on the mini PC (issue #247,
[docs/live-session.md](../../docs/live-session.md), "Pulse: offline and back"). Pulse's own
repository (Vulcio/oneverse-pulse) keeps what Rust is for (NDI, audio, timing); the live session
runs here, with the same reducer as the cloud (`LiveEngine` in `@oneverse/core`).

What it does today: Pulse is paired like a screen (issue #320, `Pairing`): with no token of its
own yet, it asks the cloud for a code as a Pulse and shows it on `GET /health` and in its log until
someone confirms it in Screens (where it shows as a Pulse), then keeps its token in
`PULSE_DATA_DIR/token`. Paired to a set, or to follow a location (the set of the event on there
now, or next today), `CloudLink` signs in with that token, is put in that set's session by the
cloud, and mirrors it; the next event at its location moves it to that set's session.
When the cloud is gone for longer than `OUTAGE_MS` (10 s), the room runs the session, one epoch
up; when it's back, the room's session and record go to the cloud first, which takes them as they
are, and Pulse mirrors again.

`Room` is the room's server: the cloud's `/sync` for the devices on the venue's network
(`PULSE_ROOM_PORT`, 8788, on every address by default), entered with a pass the cloud signed
(`{type: "enter", pass}`, checked offline with the cloud's key). A device joins the set, hears
its session and sends commands, applied by the engine while the room runs the session. `GET
/health` says whether the cloud is there.

`SetCopy` keeps the set as the screens show it (without anyone's notes) on disk
(`PULSE_DATA_DIR`), fetched when the cloud's there and every five minutes; the room gives it at
`GET /set` to a pass (`Authorization: Pass <pass>`). Pulse's own page, at `/`, is the operator's
console built for it by the screen app (`pnpm --filter @oneverse/screen-app build:pulse`, served
from `PULSE_CONSOLE_DIR`, its `dist/pulse` by default): opened with `#pass=<pass>`, it shows that
copy and runs the screens through the room (`e2e/web/pulse-console.test.mjs`).

It tells the cloud its page's address (`PULSE_ROOM_URL`, by default its first local IPv4
address), which the set's devices hear: when they lose the cloud, Live and the console offer
"Continue on Pulse", a link to that page with a pass.

Not yet: Live itself on Pulse's page (the console only), the stage (timers, messages) and most of the old messages in the room,
and handing back a session the room ran when the cloud has meanwhile moved Pulse to another set
(the next event): that one stays in Pulse's log only. It has not run on a mini PC yet: only in
tests (`src/__tests__/`, `e2e/api/pulse-link`, `pulse-room`, `pulse-pairing`,
`e2e/web/pulse-console`) against the API.

```sh
pnpm --filter @oneverse/pulse build
pnpm --filter @oneverse/screen-app build:pulse
ONEVERSE_API_URL=https://api.oneverse.top PULSE_NODE_ID=pulse-hall-1 node apps/pulse/dist/main.js
# shows a code: pair it in Screens > Pair a screen, as a set's or to follow a location
```
