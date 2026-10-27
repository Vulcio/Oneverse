# SongDocument v2

**Status:** implementation contract (schemas in `packages/core/src/schemas/song-document-v2.ts`)
**Replaces:** [SongDocument v1](song-document-v1.md)
**Example:** [`morning-light-song.v2.json`](../packages/core/src/__tests__/fixtures/morning-light-song.v2.json)

A song's music: its sections, lines, chords and timing, stored in
`SongVersion.documentJson`. The song editor edits it directly. ChordPro,
chords-over-lyrics, plain lyrics and LRC are only ways in (import, paste)
and out (export). None of them is how a song is stored.

## Status

| Part | State |
|---|---|
| Schemas, chord reader, Morning Light examples | Done, in `@oneverse/core`, with tests |
| Songs stored as v2: saving with `revision`, IDs kept through text edits, ChordPro export from the columns, chords-above-lyrics rendering | Done |
| Structured editor (the rules below), with text mode and paste | Done: `apps/web/src/components/song-editor/structured/`, covered by `e2e/web/structured-editor.test.mjs` |
| ChordPro `{comment}` as note lines; every section type as a `{start_of_x}` environment | Done |
| The song's order (`flow`) edited in the editor; `{chorus}`, mid-song `{key}` and between-section comments read and written; key changes shown on the chart | Done |
| `tempo` / `timeSignature` changes per pass in the editor | Next |

Songs saved before v2 are converted as they're read and written back by
the API at startup (`SongDocumentUpgradeService`). Until arrangements
exist, the capo is a `SongVersion.capo` column.

## What changed from v1, and why

| v1 | v2 | Why |
|---|---|---|
| A line is a list of *segments*: lyric pieces cut at every chord | A line is one `text` with `chords` pinned to characters (`at`) | Moving a chord only changes `at`, and fixing lyrics is ordinary text editing. Chord and line IDs never change. Lyrics hold no hyphens. |
| `metadata` copies title, language, CCLI, copyright… | Removed | Those are `SongVersion` columns: one source of truth, nothing to drift |
| `chord.normalized` stored beside `raw` | Only `raw` is stored; `parseChord()` reads it | Nothing stale to rebuild when the chord reader improves |
| `defaults.keyNormalized`, `defaults.capo` | Removed | The key is read from `key`; the capo belongs to an arrangement |
| Sections in singing order, repeats written out again | `sections` hold each distinct section once; `flow` is the order they're sung in | Repeats without copies. Perform mode can run a song with no arrangement. |
| No way to say "×2" or "softly" | `kind: "note"` lines | ChordPro comments and cues have somewhere to go |
| Rhythm maps point at segments | Point at chords (`chordId`) and characters (`{ lineId, at }`) | Segments no longer exist |
| No version number | `revision` | Autosave conflicts and arrangement review |

## Top level

```jsonc
{
  "$schema": "song-document/v2",
  "revision": 12,
  "defaults": { "key": "G", "tempo": 72, "timeSignature": { "numerator": 3, "denominator": 4 }, "durationSeconds": 245 },
  "sections": [ /* Section */ ],
  "flow": [ /* SectionInstance */ ]
}
```

| Field | Description |
|---|---|
| `revision` | Goes up by one with every saved change (see [Saving](#saving)). |
| `defaults.key` | As written: `"G"`, `"Bb"`, `"F#m"`. `parseKey()` reads it. Chords are stored at concert pitch in this key. |
| `defaults.tempo` | BPM. |
| `defaults.timeSignature` | `{ numerator, denominator }`. |
| `defaults.durationSeconds` | For autoscroll and set lengths. |

What the song is called, who wrote it, its rights and identifiers are
`SongVersion` columns and never appear in the document. An export composes
both.

## Sections

```jsonc
{ "id": "sec_…", "type": "chorus", "label": null, "showLabel": true, "lines": [ … ], "rhythm": null, "groove": null }
```

| Field | Description |
|---|---|
| `type` | `intro` `verse` `pre-chorus` `chorus` `post-chorus` `bridge` `instrumental` `outro` `tag` `other` |
| `label` | Shown instead of the type's (translated) name, e.g. "Verse 2" or "Tag". `null` uses the type's name. |
| `showLabel` | `false` hides the heading on the chart; it's still a section for navigation. |
| `rhythm` | Optional bar-by-bar timing (see [Rhythm](#rhythm)). |
| `groove` | Optional drum groove (unchanged from v1). |

Each distinct section is stored **once**. A chorus sung three times is one
section that appears three times in `flow`. "Duplicate section" in the
editor makes a separate copy with new IDs, for when the words differ.

## Lines

```jsonc
{
  "id": "line_…",
  "kind": "lyric",
  "text": "Amazing grace how sweet the sound",
  "chords": [
    { "id": "chd_…", "at": 0,  "raw": "G" },
    { "id": "chd_…", "at": 13, "raw": "G7" },
    { "id": "chd_…", "at": 18, "raw": "C" }
  ]
}
```

`kind` is `"lyric"` (the default) or `"note"`. A note line ("×2", "softly",
"band re-enters") has text and no chords. A line of chords only (an intro,
say) is a lyric line with empty `text`, its chords all at `at: 0` in playing
order.

### Chords are pinned to characters

`at` is the index of the character the chord sits above, counted the way
JavaScript counts string positions (UTF-16 code units, as the editor
does). The rules, all checked by the schema:

- `0 ≤ at ≤ text.length`. `at === text.length` is a chord after the last
  word ("…see |D").
- Chords are listed in order along the line (`at` never decreases). Chords
  on the same character play in the order listed.
- `at` always falls on a character boundary: never inside an accented
  letter written as two code units (`e` + combining accent) or an emoji.

A chord in the middle of a word just has its `at` there: `before` with `D/F#`
at the `f`. The text never gets a hyphen: spacing is the renderer's job.

### Rendering chords above lyrics

Every view that shows chords over words (editor, preview, perform) lays a
line out the same way:

1. Split the text at each chord's `at`. Each piece starts with its chord
   (the first piece may have none).
2. Each piece is at least as wide as its chord symbol plus a small gap, so
   the next chord still sits over its own character and two chords never
   overlap, however close they are (one syllable to the next).
3. Where a piece has to be widened and the split falls inside a word
   (a letter on both sides), the gap is drawn with a hyphen or line
   ("Morn — ing") so the word still reads as one. Between words it's just
   space.
4. Several chords on the same character (a line of chords only, or a
   chord change with no words) sit side by side.

No syllable information is needed: a chord always marks where a syllable
starts, so the break falls exactly at the chord. Transposition, solfège
and simplified chords change the symbols' widths, so the layout is
worked out after them.

### Chord symbols

`raw` is the symbol exactly as written ("F#m7b5/C#", "Cadd9", "(G)",
"N.C."), and it's the only thing stored. `@oneverse/core` reads it:

| Function | Use |
|---|---|
| `parseChord(raw)` | Root, quality, seventh, extensions, alterations, bass, optional. Returns `null` for anything it can't fully read; that chord is still shown as written. |
| `transposeChord(raw, steps, targetKey)` | Moves the root and bass, spelled for the key (B♭ in F, A♯ in B). The rest of the symbol is kept as the author wrote it. |
| `formatChord(raw, "solfege")` | "Sol/Si" for "G/B". Notation is a display preference, never stored. |
| `simplifyChord(raw, options)` | "G" for "Gmaj7", "D" for "D/F#": for players who hide complexity (see the arrangement spec's personal preferences). |
| `sameChord(a, b)` | Same sound however spelled ("A#m" and "Bbm"). |

Nashville numbers, diatonic suggestions in the chord picker and key
detection all build on `parseChord` and `defaults.key`.

## Flow: the order it's sung in

```jsonc
"flow": [
  { "id": "fi_v1", "sectionId": "sec_v1" },
  { "id": "fi_ch1", "sectionId": "sec_ch" },
  { "id": "fi_v2", "sectionId": "sec_v2" },
  { "id": "fi_ch2", "sectionId": "sec_ch", "label": "Chorus 2" },
  { "id": "fi_ch3", "sectionId": "sec_ch", "label": "Final chorus", "keyChange": { "steps": 1, "key": "Ab" }, "note": "Big" }
]
```

A `SectionInstance`: one pass through a section. An arrangement's `items`
use the same shape with overrides added, so one renderer and one
performance transport walk both, and a song with no arrangement can still
be performed.

| Field | Description |
|---|---|
| `sectionId` | The section sung. The same section can appear any number of times. |
| `label` | "Chorus 2"; `null` uses the section's label. |
| `keyChange` | From this pass on: `steps` semitones from the key in effect before it (authoritative), `key` as written for display. |
| `tempo`, `timeSignature` | From this pass on. |
| `note` | For the band. |

In the editor, **Song order** shows the passes in order. Choose one to give
it a label, a key change (named from the key before it, and renamed when the
song's key or an earlier change moves) or a note; move it, sing it again
right after, or remove it; drag passes to reorder; "+ Sing…" adds one at the
end. Adding a section adds it to the end of the order and deleting one takes
out its passes (`reconcileFlow`); "Follow the sections" goes back to each
section once, in order.

The chart shows each pass's label and note, and a key change as "Key: A",
with the chords from that pass on moved by its steps.

## Rhythm

An optional timing layer on a section; the lines stay the structure.

```jsonc
"rhythm": {
  "beatsPerBar": null,
  "bars": [
    { "chords": [{ "chordId": "chd_v1_01", "beat": 1 }], "lyricAnchor": { "lineId": "line_v1_01", "at": 0 }, "cue": null },
    { "chords": [], "lyricAnchor": null, "cue": "hold" }
  ]
}
```

- `beatsPerBar` defaults to the time signature's top number.
- A bar's own `beats` (optional, 1 to 32) gives it a length of its own: a
  pickup, a 2/4 bar before the chorus. Left out, it has `beatsPerBar`.
- A bar with no chord changes carries the previous chord on.
- `beat` is 1-based and may be fractional (2.5 is the "and" of 2).

A section without a rhythm still has bars: `chartBars()` in `@oneverse/core`
(issue #238) fills them in from the chart. Each chord of a line gets a bar,
a sung line takes at least two, a line of chords alone takes one bar per
chord, and notes take none. The bars run through the order the song is
played in, each with its pass's time signature (`timeSignature` on a pass
carries on to the next ones) and the chord carried into a bar that doesn't
change on beat 1. `barAt()` finds the bar, beat and chord at a position in
beats. Both are conformance cases (`chart.json`).

The editor shows a rhythm as bar lines in the lyrics (`bar-lines.ts`): a bar
with a `lyricAnchor` starts a bar line there, and the bars after it without
one add to its count ("×2": a held word, an instrumental bar).
`barLinesFromRhythm()` reads them, `rhythmFromBarLines()` writes them back -
a bar line before the section's first words or chords adds a bar from its
start, and the chords between two bar lines get the beats their words
reach, rounded, half a beat apart at least - and `suggestedBarLines()` puts
them where `chartBars()` would have its bars. A rhythm that was loaded is
saved unchanged while its bar lines are; moved, the rhythm is worked out
again and `keepPlacedBeats()` keeps the beats and lengths of the bars that
didn't change. `chartBars()` gives each bar its `lyricAt`, so `barLyrics()`
cuts the words at the bar lines.

The chord grid edits a rhythm directly (`rhythm-edit.ts`): `editableRhythm()`
writes the bars `chartBars()` filled in as one (each line's first bar at its
start, the others at their chord's word), `moveRhythmChord()` puts a chord on
a beat - never past the chord before or after it in the chart -
`setRhythmBarBeats()` gives a bar its own `beats`, and `insertRhythmBar()` /
`removeRhythmBar()` add an empty bar or remove one. Each is a conformance case.

## Anchors

Anything that points into the lyrics uses a **lyric anchor**,
`{ lineId, at }`: rhythm bars, performance notes, and later ink
annotations, live-sync positions and LRC timings. It survives edits the
same way chords do (see below).

## IDs

| Kind | Prefix |
|---|---|
| Section | `sec_` |
| Line | `line_` |
| Chord | `chd_` |
| Flow item | `fi_` |

IDs are created once and follow their content: they never change on save,
move with the content, and aren't reused after a delete. They're unique
across the whole document. Arrangements, notes, personal chart preferences
and (later) annotations all refer to them.

## Saving

- The editor sends its `sections` (IDs and all) along with the `revision`
  it started from (`PATCH /song-versions/:id` with `sections`;
  `songDocumentFromSections()` builds the new document and moves the flow
  along with added and deleted sections). Text sent as `content` is
  reconciled instead (`songDocumentFromText()`). The server rejects the save if the stored revision is
  newer (another tab or another admin saved in between), so nothing is
  silently overwritten. Otherwise it stores the document with
  `revision + 1`.
- The document is validated with `SongDocumentV2Schema`, including the
  size limits in `SONG_DOCUMENT_LIMITS`.

## Editor rules

The editor is a structured editor built on ProseMirror/Tiptap:

- A section is a block, a line is a paragraph, and a chord is an inline
  item sitting before the character it's pinned to, carrying its `id` and
  `raw`.
- Saving converts that to this format. Loading converts it back.

**Moving a chord.** Drag it to another character, which is highlighted while
dragging, with a caret where it will land. Or select it (click or tap) and
use ← / → to move it one character at a time, which also works for
keyboard and screen-reader users. A drag works the same with a mouse, a
pen or a finger (the chip doesn't scroll the page). Only `at` changes.

**Adding and changing chords.** Type `[G]` in the lyrics (anything
`parseChord` can't read, like `[x2]`, stays text), or click a chord in the
palette - the key's seven chords with their degrees, and the song's own -
to add it at the cursor, or drag it onto a character. A selected chord
shows its details under it: its symbol to edit, its degree in the key,
the key's chords and variations of its root to swap to, ← / → and
Delete. Delete or Backspace on a selected chord removes it; that's the
only way a chord is removed (besides deleting its whole line or section).

**Transposing** the song moves every chord and the key by a semitone,
spelled for the new key, as one undoable step. Hiding a chord belongs to an
arrangement or a player's own view, not the song, so the song editor has
no "Hide".

**Editing lyrics** is ordinary text editing. Chords stay with the characters
around them: typing before a chord moves it along, and typing after it
doesn't.

- **Deleting text that has chords on it** keeps the chords and gathers them
  at the point of the deletion, in their original order. Removing a chord is
  a separate, explicit action, so a lyric fix never loses chords.
- **Splitting a line** (Enter in the middle) moves the chords after the
  split to the new line, keeping their IDs. The new line gets a new line
  ID.
- **Joining two lines** keeps the first line's ID. The second line's chords
  move into it, keeping their IDs.
- Backspace or Delete right beside a chord removes the character beyond it,
  never the chord.
- Deleting whole lines (or a section) deletes their chords with them.

**Pasting** is detected with the import detector (`detectImportFormat`):

- Plain words paste as text.
- ChordPro, chords-over-lyrics and lyrics with section labels become lines
  and chords at the cursor. They become new sections when the paste contains
  section headings or blank-line-separated blocks.
- Pasted chords get new IDs.

**Text mode** (for developers and tricky fixes) shows the chart as
ChordPro: each section a `{start_of_x: label}` environment, lines as inline
text (`[G]Amazing grace how [G7]sweet the [C]sound`), notes as
`{comment: …}`. It reads back to the same sections. Preview shows the chart
as players see it.

- Switching back parses it and keeps IDs by matching:
  - lines to their previous version by position, then by the most similar
    text;
  - chords within a matched line by order and symbol.
- Anything unmatched gets a new ID.

## Import and export

| Format | In | Out |
|---|---|---|
| ChordPro | `{start_of_x}` sections, `[C]` chords, `{comment}` in a section → note line, between sections → the next pass's note, `{chorus}` → the last chorus again in `flow`, `{key}` after the first → a key change on the next pass (sections written after it, in the new key, are stored back in the song's key; one that then matches an earlier section is that section sung again) | In the order it's sung: each section in full the first time, a repeated chorus as `{chorus}`, a key change as `{key: A}` with everything after it written out in full in the new key, notes as `{comment}`; title, key, tempo and CCLI from the columns plus `defaults` |
| Chords over lyrics | Chord columns pinned to the character below | The same layout |
| Plain lyrics | Blank lines and "Verse"/"Chorus" labels split sections | Lyrics only |
| LRC | Line timings as anchors (planned) | Planned |
| PDF, FreeShow, OpenLyrics | – | Planned; all from this document plus the columns |

## Migrating from v1

Done. Songs saved as v1 were converted at API startup (IDs kept, segments
joined into one text per line, chords pinned where their segment started),
and once no v1 song was left the converter and the v1 schemas were removed
(issue #60). Reading a document that isn't v2 now fails with an error
naming its `$schema`. The seed's Morning Light files are stored as v2.

## Planned extensions

These fit the model without changing what's above:

- a second language under each line (bilingual services);
- voice parts (lead, alto, tenor) on lines;
- syllable timing for singer practice;
- LRC anchors;
- real-time collaborative editing: the editor's ProseMirror model syncs
  through Yjs, and saves still write this document.
