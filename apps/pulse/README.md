# Oneverse Pulse's live engine

The Node process Oneverse Pulse runs on the mini PC (issue #247,
[docs/live-session.md](../../docs/live-session.md), "Pulse: offline and back"). Pulse's own
repository (Vulcio/oneverse-pulse) keeps what Rust is for (NDI, audio, timing); the live session
runs here, with the same reducer as the cloud (`LiveEngine` in `@oneverse/core`).

What it does today: `CloudLink` joins one set's session as a device of its own and mirrors it.
When the cloud is gone for longer than `OUTAGE_MS` (10 s), the room runs the session, one epoch
up; when it's back, the room's session and record go to the cloud first, which takes them as they
are, and Pulse mirrors again.

Not yet: the room's side (Pulse's own page for Live and the console, reached by "Continue on
Pulse", and how the room's devices sign in to it without the internet), Pulse's own sign-in
(paired like a screen; until then `PULSE_TOKEN` is an API token of someone who can edit the set),
and following the sets of an event rather than one set. It has not run on a mini PC yet: only in
tests (`src/__tests__/`, `e2e/api/pulse-link.test.mjs`) against the API.

```sh
pnpm --filter @oneverse/pulse build
ONEVERSE_API_URL=https://api.oneverse.top PULSE_SET_ID=… PULSE_NODE_ID=pulse-hall-1 PULSE_TOKEN=… \
  node apps/pulse/dist/main.js
```
