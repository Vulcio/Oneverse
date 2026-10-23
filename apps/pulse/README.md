# Oneverse Pulse's live engine

The Node process Oneverse Pulse runs on the mini PC (issue #247,
[docs/live-session.md](../../docs/live-session.md), "Pulse: offline and back"). Pulse's own
repository (Vulcio/oneverse-pulse) keeps what Rust is for (NDI, audio, timing); the live session
runs here, with the same reducer as the cloud (`LiveEngine` in `@oneverse/core`).

What it does today: `CloudLink` joins one set's session as a device of its own and mirrors it.
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
Pulse's own sign-in (paired like a screen; until then `PULSE_TOKEN` is an API token of someone who
can edit the set), and following the sets of an event rather than one set. It has not run on a
mini PC yet: only in tests (`src/__tests__/`, `e2e/api/pulse-link`, `pulse-room`,
`e2e/web/pulse-console`) against the API.

```sh
pnpm --filter @oneverse/pulse build
pnpm --filter @oneverse/screen-app build:pulse
ONEVERSE_API_URL=https://api.oneverse.top PULSE_SET_ID=… PULSE_NODE_ID=pulse-hall-1 PULSE_TOKEN=… \
  node apps/pulse/dist/main.js
```
