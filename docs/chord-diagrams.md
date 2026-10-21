# Chord diagrams

How Songverse shows a chord's shape (issue #207, phase 1 of #111). The
shapes are worked out once, in `@oneverse/core`. Each client draws them
natively from this spec: SVG on the web, SwiftUI and Compose `Canvas` in the
native apps (#165). The drawings can differ in style, but never in what they
say.

## Where the shapes come from

`chordShapes(chord, instrument, limit)` (`packages/core/src/chords/shapes.ts`)
returns shapes, easiest and most usual first. They are worked out from the
chord's notes (`chordTones`), not looked up in a table, so every chord the
reader understands has one.

1. **The notes.** `chordTones` gives the chord's notes with their roles: root,
   third, fifth, seventh, extension, alteration, and a slash chord's bass when
   it isn't one of them. Each note is marked as needed or not.
   - The 5th (unless altered), the 9th under a 13th, and the 3rd of an 11 chord
     may be left out.
   - When nothing fits, `chordShapes` tries again without the extensions'
     colours, then without the alterations.
2. **The search.** In every window of four frets up the neck, each string is
   muted (guitar only), open, or pressed on one of the chord's notes. A shape
   is kept when:
   - every needed note sounds, and nothing else;
   - on a guitar, the lowest note is the bass (the root, or a slash chord's
     bass);
   - at least `minStrings` strings sound;
   - a guitar mutes at most one string between its sounding strings;
   - a hand can play it (fingers, below).
3. **Fingers.** The pressed strings, in order of fret then string, get
   fingers 1–4.
   - With four or more pressed and the lowest fret on two strings or more,
     finger 1 lies across that fret (a barre), and the rest share fingers 2–4.
   - With five or more pressed, a barre is the only way. Every string under it
     must sound, at its fret or above.
4. **Ranking.** Lower is better. Shapes cost more for:
   - their position up the neck;
   - a stretch over four frets;
   - muted strings (a muted string between sounding strings costs most);
   - a barre and each finger;
   - each optional note left out;
   - a pressed bass with the next string open.

   They cost less for each sounding string, and for open strings when the
   shape stays within the first three frets.
5. **Known shapes first.** The open chords everyone learns (`KNOWN_OPEN`) and
   the movable E and A shapes barred anywhere (`MOVABLE`) get a large bonus.
   So C is x32010, F is the 133211 barre, and Ab is the E shape at the 4th
   fret, not something merely easy.
6. **Stable order.** Ties are broken by the shape's text (`x32010`). The same
   chord always gives the same shapes, in the same order. The conformance
   cases in `packages/core/conformance/chords.json` pin this down.

Instruments (`FRETTED_INSTRUMENTS`):
- guitar EADGBE (MIDI 40 45 50 55 59 64), 15 frets;
- ukulele GCEA with a high G (67 60 64 69), 12 frets. A ukulele has no bass:
  any string may sound lowest, and all four sound.

Tunings (`TUNINGS`, issue #207 phase 3): guitar `standard`, `drop-d`,
`dadgad`, `open-g`, `half-step-down`; ukulele `standard`, `low-g`, `baritone`.
`chordShapes(chord, instrument, limit, tuning)` works shapes out for the
tuning's strings. The known shapes only count in the tunings they were learnt
in: standard, and a ukulele's low G, which changes no fingering.

## Which shape comes first

1. The shape **the player chose for this chord in this song** (theirs only,
   per instrument and tuning: `ChordShapeChoice`, `GET`/`PUT
   /song-versions/:id/chord-shapes`, with `frets` written as `shapeText`
   writes them; `null` forgets it). It isn't global: another song's G keeps
   the usual shape. It follows the song when a duplicate is folded into it.
2. Later, the song's own shapes from ChordPro's `{define}` (issue #215).
3. The shapes `chordShapes` works out, in its order.

## Piano voicings (phase 4)

`pianoVoicings(chord, { hands })` (`packages/core/src/chords/piano.ts`):
- **Right hand:** the chord's own notes (not a slash chord's foreign bass) in
  close position, one voicing per inversion, root position first. Each is
  placed nearest a middle around E4/F#4 (MIDI 66), never below middle C (60),
  and always above the left hand's bass. With more than four notes, the
  optional ones (the 5th, implied extensions) go first.
- **Left hand:** the bass (the root, or a slash chord's bass) in C3–B3
  (48–59), or nothing with `hands: "right"`.
- `songVoicings(chords, { smooth })`: for a song's chords in order, the
  inversion of each nearest the one before (the least total movement of the
  right hand's keys), from the first chord's root position. With
  `smooth: false`, root position throughout. The strip draws these, and the
  card starts at them.
- `voicingText` writes a voicing as `48|60.64.67` (left | right, MIDI), the
  way a player's choice is kept (`ChordShapeChoice` with `instrument: "piano"`,
  `tuning: "standard"`).

**Drawing a keyboard:** from the white key below the lowest key played to the
one above the highest.
- White keys are 10×40 and outlined; black keys are 6×25 and filled with the
  foreground colour.
- Right-hand keys get a filled dot (radius 3, the accent colour) near the
  key's bottom; the left hand's bass gets a ring (amber).
- Note names, when shown, go under the keys, spelled with flats when the
  chord's root or bass is a flat, and in solfège for a player who reads it.
- Settings: `User.pianoSmooth`, `pianoHands` ("both" | "right") and
  `pianoNoteNames` ("card" | "all" | "none").

**Sound:** a simple struck-string tone (a few harmonics, the higher ones
fading sooner), the left hand first, then the right hand 35 ms later.

## What a shape says

```ts
interface ChordShape {
  frets: (number | null)[]; // per string, in drawing order: 0 open, null muted
  fingers: (number | null)[]; // 1 index … 4 little finger; null on open/muted
  barres: { fret: number; from: number; to: number }[]; // string indexes
  baseFret: number; // the fret the diagram starts at
  notes: number[]; // MIDI notes sounding, string by string, muted left out
}
```

- Strings are in drawing order, left to right: a guitar's low E first, a
  ukulele's G (nearest the chin) first.
- `baseFret` is 1 when the shape fits in the first four frets. Otherwise it is
  the lowest pressed fret.
- `shapeText` writes a shape as players do: `x32010`, with `(10)` for a fret
  past 9.

## Which chord is drawn

`renderChart` gives each chord on the chart:
- `sounding`: the chord in letters, after the set's key, any transposition,
  and **Simpler chords** / **No bass notes**;
- `fretted`: the sounding chord moved down by the capo (the same as `sounding`
  without one).

A guitar diagram draws `fretted`, whatever the chart shows: with a capo the
player plays shapes. A ukulele diagram draws `sounding`. `chartChords(chart,
"fretted" | "sounding")` lists a chart's chords, each once, in the order they
first come, for the strip. Names follow the player's notation (solfège turns
`G` into `Sol`).

## The drawing

All in the drawing's own units, so it scales with the text:
- **Grid:** strings 10 apart, frets 12 apart, four frets shown. 12 units above
  the grid for the open/muted marks, 12 to its left for the fret number.
- **Strings:** vertical lines at 60% opacity. **Frets:** horizontal lines at
  45% opacity, all 0.75 wide.
- **Nut:** when `baseFret` is 1, the top line is drawn 2.5 wide. Otherwise the
  top line is an ordinary fret, with `baseFret` written to the left of the
  first fret's middle, 8 units high.
- **Above a string:**
  - × (two strokes, 5 wide) for a muted string;
  - ○ (a circle, radius 2.5, not filled) for an open one;
  - nothing for a pressed one.
- **Dots:** a filled circle, radius 3.6, in the middle of the fret's space
  (between two fret lines), for each pressed string not under a barre.
- **Barre:** a filled rounded bar, 7 high, from 3.5 before its first string to
  3.5 past its last, at its fret.
- **Fingers:** only in the bigger diagram. The finger's number goes in its dot,
  in the background colour, 6 high. A barre shows its number once, on its
  first string.
- **Colour:** the foreground colour for everything; the background colour for
  finger numbers. Light and dark themes come out right with nothing else.
- **Accessibility:** the drawing is one image, labelled "G: 320003" (the
  chord's name, then `shapeText`).
- **Left-handed** (`User.leftHanded`): the same drawing mirrored left to
  right, the lowest string on the right. The fret number stays on the left.

## Sound

Tapping a diagram plays `notes`: plucked strings (Karplus-Strong), strummed
28 ms apart (20 ms on a ukulele), downwards and then upwards on the next tap.
It is made on the device and works offline. What's heard is always what's
drawn.

## Where it shows

The diagrams are off until the player picks an instrument (`User.chordDiagrams`:
`OFF`, `GUITAR` or `UKULELE`, in Chart display or a set's My view). Then:
- **The strip:** the chart's chords at its top, small. It scrolls away with
  the chart and folds to one line of names (remembered on the device).
- **The card:** tapping a chord on the chart opens its bigger diagram, with the
  other shapes (‹ ›).

Nothing is drawn over the lyrics, and the chart's own layout never changes.
