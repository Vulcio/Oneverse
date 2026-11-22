# One live session engine, run by the cloud and by Pulse

Decided 2026-10-22 (#247, docs/live-session.md). A live session is an entity of its own, changed only by commands
checked against the revision they were decided from and applied by one reducer in `@oneverse/core`. Oneverse Pulse
runs that same TypeScript engine in Node at the venue; Rust keeps only what needs it (NDI output, audio, timing, MIDI
and lighting). During an outage the cloud keeps taking commands, because not every venue has a Pulse; when Pulse
comes back, the room's state wins (a new epoch), and the record keeps both.

## Considered Options

- A Rust engine in Pulse: rejected for now, two engines would drift; shared test cases (`live.json`) keep the door open.
