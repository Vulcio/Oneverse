# ArrangementDocument v2

**Status:** implemented - schemas in `packages/core/src/schemas/arrangement-document-v2.ts`, rendering in `packages/core/src/song-document/render.ts`, API in `apps/api/src/arrangements/`
**Replaces:** [ArrangementDocument v1](arrangement-document-v1.md)
**Builds on:** [SongDocument v2](song-document-v2.md)
**Example:** [`morning-light-arrangement.v2.json`](../packages/core/src/__tests__/fixtures/morning-light-arrangement.v2.json)

How a band plays a song: the order of its sections, and what differs from
the song on each pass. It never copies the song's content. It points at the
song's sections, lines and chords by ID and records the differences.

## What changed from v1

| v1 | v2 | Why |
|---|---|---|
| Chord overrides didn't say which key they were written in | **Everything is written in the song's key** | v1's own example was ambiguous (below) |
| `key` and `transposeSteps` both set the arrangement's key | `transposeSteps` only; the key follows from it | One source of truth |
| `keyOverride` with `key`, `keyNormalized` and `transposeSteps` | `keyChange: { steps, key }`, shared with the song's `flow` | Same shape as the song |
| `lyric` override replaced a segment | Replaces a line's text; its chords keep their IDs | Segments are gone |
| – | `hide_chord` override | Leave a chord out for the whole band |
| `frozenAt` set when the song changed | `songRevision` | "Checked against revision 12; the song is at 15" says exactly what to review |
| `instanceLabel`, `performanceNote`, `durationOverrideSeconds` | `label`, `note`, `durationSeconds` | Same names as the song's flow |
| – | Personal chart preferences | A player's own view, which changes nothing for others |

## Where arrangements live

- **Owners:** a user or a team, like songs, with the same rules for who
  sees and edits them. An arrangement can be made of any song you can see,
  including a global catalogue song you can't edit: arranging someone
  else's song is the main use.
- **In sets:** each set item plays the song as written or one arrangement
  of it. The item's own key, tempo and notes still apply, on top of the
  arrangement ("this Sunday, a tone lower"), so trying another key never
  means editing the arrangement.
- **Team default:** a team can mark one of its arrangements of a song as
  its usual one. Adding the song to one of the team's sets picks it.
- **Just for one set** (bricedupuy/Songverse#16): a set's song can have its
  own arrangement for that set - to reorder, skip or repeat sections just
  there. It starts as a copy of the arrangement the set played (or the
  song's order), is owned like the set (and follows it to a team), isn't
  listed with the song's arrangements, can't be a team's usual one, and is
  deleted with the set's song (`Arrangement.setlistItemId`, cascading).
  Switching the set's song to another version deletes it.
- **Capo:** the arrangement's `defaults.capo` is the capo. A capo stored on
  the song (`SongVersion.capo`) is only a suggestion - "the recording uses
  capo 2" - shown when no arrangement says otherwise.

## First version

The arrangement editor starts with the order, key, capo and tempo, and on
each pass: replacing, moving or hiding a chord, hiding a line, changing a
line's words (`lyric`), inserting lines (`insert_line`, typed with their
chords in brackets), and notes (on the pass or a line, inserted ones
included). Words and inserted lines came with bricedupuy/Songverse#24.

In the app:
- A song's **Arrangements** tab lists yours and your teams', and makes one
  (yours, or for a team you're an admin of). It starts as the song's order,
  in its key.
- The arrangement editor (`apps/web/src/components/arrangement-editor.tsx`)
  shows each pass's chords in the key it's played in, and stores what you
  type in the song's key.
- A team admin can make a team arrangement the team's **usual** one: songs
  added to the team's sets start with it. Each song of a set can switch to
  another arrangement, or play as written.
- A set's song page renders the arrangement with the set's key on top, and
  the player's own view (below) from a "My view" bar; chord names and capo
  display are also on the dashboard.

## Top level

```jsonc
{
  "$schema": "arrangement-document/v2",
  "songVersionId": "…",
  "songRevision": 12,
  "defaults": { "transposeSteps": 2, "tempo": 80, "timeSignature": null, "capo": 2, "guitarTuning": null, "guitarTuningNotes": null },
  "items": [ /* ArrangementItem */ ]
}
```

| Field | Description |
|---|---|
| `songRevision` | The song revision this arrangement was last checked against. When the song is newer, the owner is shown what changed since (and any [problems](#when-the-song-changes)). They then update or confirm the arrangement, which sets this to the current revision. |
| `defaults.transposeSteps` | Semitones from the song's key, −11 to 11. The arrangement's key follows (G + 2 = A). |
| `defaults.capo` | Capo fret. The song's own capo is only a suggestion, used when this is `null`. It's for display: chords are stored at concert pitch, and whether guitarists see sounding or fingered shapes is their own preference. |
| `defaults.tempo`, `timeSignature` | Override the song's. `null` keeps the song's. |
| `defaults.guitarTuning`, `guitarTuningNotes` | As in v1. |

## Everything is written in the song's key

Chord overrides, inserted lines and hidden chords are all written against
the song as stored, in the song's own key. The arrangement's
`transposeSteps` and any `keyChange` are applied afterwards, to the song's
chords and the overrides alike. Transposing an arrangement therefore never
means rewriting its overrides.

v1 left this open, and its Morning Light example shows the problem. The
final chorus modulates up a minor third to B♭ *and* overrides the chorus's
`D` with `F`. `F` is just that `D` moved up a minor third. Read as "written
in the key being played", the override changes nothing. Read as "written in
the song's key", it becomes A♭ once transposed. The v1→v2 converter used the
first reading and dropped the override, with a warning. (The example is a
generated sample, so there's no author's intent to recover either way.)

## Items

An item is one pass through a section: the song's
[`SectionInstance`](song-document-v2.md#flow-the-order-its-sung-in) plus
overrides.

```jsonc
{
  "id": "ai_09",
  "sectionId": "sec_chorus",
  "label": "Final Chorus",
  "keyChange": { "steps": 3, "key": "Bb" },
  "tempo": null,
  "timeSignature": null,
  "note": "Modulate up a minor third, full band",
  "durationSeconds": 20,
  "overrides": [ … ]
}
```

A new arrangement starts as a copy of the song's `flow`. Key changes add up
along the items: each `steps` is relative to the key in effect before it,
counting from the song's key plus `defaults.transposeSteps`.

## Overrides

| Type | Fields | Effect on this pass |
|---|---|---|
| `chord` | `chordId`, `raw` | Plays `raw` (in the song's key) instead. |
| `hide_chord` | `chordId` | Leaves the chord out for everyone. |
| `lyric` | `lineId`, `text`, `chordPositions?` | Sings `text` instead. The line's chords keep their IDs. `chordPositions` gives the new `at` of any that move; the rest stay where they were, pulled in to the end of a shorter line. |
| `hide_line` | `lineId` | Skips the line. |
| `insert_line` | `afterLineId` (`null` = before the first), `line` | Adds a line. Its IDs start with `ins_` and belong to this arrangement; other overrides on the same item can point at them. |
| `performance_note` | `lineId`, `note` | A note on a line. |

Overrides that point at a chord (`chord`, `hide_chord`) can name the song's
chords or chords in this item's inserted lines.

### Rendering a pass

`renderChart(song, arrangement, view)` in `@oneverse/core` does all of
this, so the web chart, perform mode and a mobile app draw the same thing.
It returns every pass with its lines and chords as shown, the key in
effect, whether the pass differs from the song, and any problems.

1. Take the section from the song (`sectionId`).
2. Insert inserted lines (among all the section's lines, so one inserted
   after a hidden line shows where that line was).
3. Remove hidden lines.
4. Replace lyrics (moving the chords as `chordPositions` says).
5. Replace chords, then remove hidden chords.
6. Attach performance notes.
7. Transpose everything by the key in effect (`transposeSteps` plus key changes so far).
8. Apply the player's personal preferences (below).

The UI marks a pass that has overrides as different from the song's
version, so the band knows it's not the same as last time.

## When the song changes

`findArrangementProblems(arrangement, song)` lists every reference that no
longer resolves:
- a section, line or chord that was deleted;
- a lyric override whose chord positions no longer fit.

When the song's `revision` is newer than `songRevision`, the owner is asked
to review:
- The arrangement keeps working meanwhile.
- A problem is shown on its pass, never silently dropped.
- Nothing is migrated automatically.

The editor says the song changed and how many changes no longer match; each
is listed on its pass with a "Remove" button, and a pass whose section was
deleted can be removed. "Mark as checked" sets `songRevision` and leaves
the changes as they are.

## Personal chart preferences

A player's own view of a chart, kept per user and per arrangement (or per
song when playing without one). It is never shared and never changes the
arrangement. It lives outside the arrangement, as the MIDI setup does
(`UserArrangementMidi`), so two players can read the same arrangement
differently.

```jsonc
{
  "$schema": "chart-preferences/v1",
  "hiddenChordIds": ["chd_ch_07", "ins_chd_01"],
  "simplifyChords": false,
  "hideBassNotes": true
}
```

| Field | Effect |
|---|---|
| `hiddenChordIds` | Chords this player doesn't want to see: the song's or the arrangement's inserted ones. Hidden from the preview and the performance chart; a quick tap brings them back. |
| `simplifyChords` | Every chord shown as its basic triad (Gmaj7 → G, Bm7b5 → Bdim) via `simplifyChord()`. |
| `hideBassNotes` | D/F# shown as D. |

This is for the player who knows a chord belongs there but can't change
that fast yet. The arrangement's `hide_chord` is the band-wide equivalent.

Two more display choices are the player's own, but for every chart rather
than one (kept on the user):

| Setting | Effect |
|---|---|
| Chord names | Letters (G) or solfège (Sol), via `formatChord()`. |
| With a capo | Chords as they sound (the default), or as the shapes a guitarist plays: capo 2 in G shows F shapes. |

## MIDI

Unchanged: MIDI triggers are per user and per arrangement, stored apart
from the arrangement (see the product spec). They point at item IDs, which
v2 keeps.

## Migrating from v1

Done, with the songs (see [SongDocument v2](song-document-v2.md#migrating-from-v1)):
item fields were renamed (`instanceLabel` → `label`, `performanceNote` →
`note`, `keyOverride` → `keyChange`), chord overrides rewritten in the
song's key, and segment replacements turned into one `lyric` override per
line. The converter has since been removed (issue #60).
