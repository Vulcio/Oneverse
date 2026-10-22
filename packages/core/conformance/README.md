# Shared test cases

What `@oneverse/core` does, written down as cases every implementation must
pass (issue #170): the web app and API (TypeScript, this package), and the
native apps (Swift, Kotlin - #165). Each case is a function's arguments and
the answer it must give. Three implementations, one behaviour.

The cases are chosen in `src/conformance/suites.ts`; the answers are this
implementation's, written here by

```sh
pnpm --filter @oneverse/core conformance
```

A change in core that alters an answer fails core's unit tests
(`src/__tests__/conformance.test.ts`) until the files are written again, so
it shows in the diff for review. Never edit the JSON by hand.

## Areas

| File | What |
| --- | --- |
| `keys.json` | Keys: read, written, transposed |
| `chords.json` | Chord symbols: read, transposed, simplified, in letters or solfège |
| `song-document.json` | SongDocument v2: reading one, and a song after its text or sections were edited (IDs kept) |
| `chordpro.json` | ChordPro and the other text formats, for import and export |
| `chart.json` | The chart a reader sees: arrangement, transposition, capo, preferences |
| `arrangements.json` | Arrangements checked against a song, and moved to another song's IDs |
| `timeline.json` | The metronome and sync play's timeline: clock offset, positions, clicks |
| `screens.json` | A set on a big screen: songs cut into slides, pairing codes |
| `live.json` | A set's live session: each op from a person on a device, applied the same way by the API and Pulse |
| `requests.json` | What the API accepts, and the messages it refuses with |

## Format

```json
{
  "$schema": "songverse-conformance/v1",
  "area": "chords",
  "about": "…",
  "functions": {
    "transposeChord": {
      "about": "…",
      "params": ["raw", "steps", "targetKey"],
      "cases": [{ "name": "D/F# by 2 to A", "args": ["D/F#", 2, "A"], "expected": "E/G#" }]
    }
  }
}
```

A runner calls the function named with `args` (in `params`' order), turns
its answer into JSON and compares it with `expected`:

- **JSON**: maps are objects, sets are lists, a field that's absent
  (`undefined`, Swift's `nil` for an optional left out) is left out of an
  object; `null` stays `null`. A list item that's absent is `null`.
- **Failing**: `{ "$throws": true }` means the function must fail (throw,
  return a failure). The message isn't compared.
- **New IDs**: an ID the function makes (`generateId`: a prefix such as
  `sec_`, `line_`, `chd_`, `fi_`, `ins_line_`, then 16 letters and digits)
  is random, so before comparing, each one not found in `args` becomes its
  prefix, `@` and a number, in the order they first appear in the answer,
  object keys included. Two IDs with the same random part get the same
  number (`sec_@1` and its flow item `fi_@1`). IDs from `args` are left as
  they are: `"sec_verse"` in an answer means it was kept.
- **Numbers** are the same within 1e-9 (relative above 1).
- **Strings** are compared exactly, messages included (`requests.json`'s
  are what the API answers with).

The TypeScript runner is `src/__tests__/conformance.test.ts`, with
`normalizeIds`, `toJson` and `differs` in `src/conformance/format.ts`.
