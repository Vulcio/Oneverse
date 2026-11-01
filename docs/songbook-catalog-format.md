# Songbook catalogue files

A songbook catalogue lists the songs of a published songbook — numbers,
titles and facts about each song, never lyrics or music (see
[songbooks-and-catalog.md](songbooks-and-catalog.md) for why). Catalogues
are imported from and exported to files in two formats:

- **CSV** — for spreadsheets. Build or edit the list in Excel, Google
  Sheets or LibreOffice and save as CSV. This is the everyday format.
- **JSON** — for exact round trips (moving a catalogue between Songverse
  instances, scripts), and the only format that also carries the
  catalogue's own details (name, publisher, ISBN…).

Both use the same fields. The definitions live in code in
`packages/core/src/songbook-catalog-format/` — keep this page in step with
them.

## Fields

| CSV column | JSON key | What it holds | Rules |
| --- | --- | --- | --- |
| `Number` | `number` | The song's number in the book: `245`, `12a`, `A-17` | **Required.** Unique in the catalogue. Up to 20 characters. A plain number is stored without leading zeros (`0245` is `245`) |
| `Title` | `title` | The title as printed | **Required** for new entries. Up to 300 characters |
| `SortTitle` | `sortTitle` | How to sort it, if not by title — e.g. without a leading "The" or accents | Up to 300 |
| `Subtitle` | `subtitle` | A second title or the first line | Up to 300 |
| `OriginalSong` | `originalSong` | The song this one translates or adapts, as another catalogue's abbreviation and number — `JEM 245` — or just a number for one in the same catalogue. Linked when that entry exists; otherwise kept as written | Up to 120 |
| `Language` | `language` | Language of the original song: `en`, `fr`… | Up to 35 |
| `Artist` | `artist` | Who's known for performing it — several separated by `;` | Up to 300 |
| `Composer` | `composer` | Music by — several separated by `;` | Up to 300 |
| `Lyricist` | `lyricist` | Words by — several separated by `;` | Up to 300 |
| `Album` | `album` | Album it appeared on | Up to 300 |
| `Year` | `year` | Year written or published | Whole number, 1000–2999 |
| `Key` | `key` | Key as printed: `G`, `Bb`, `F#m` | Up to 12 |
| `Time` | `time` | Time signature | Like `4/4`, `6/8` |
| `Tempo` | `tempo` | Beats per minute | Whole number, 20–400 |
| `Duration` | `duration` | Running time | `3:45` or `1:02:03`, or a number of seconds (JSON exports use seconds) |
| `Copyright` | `copyright` | Copyright line | Up to 500 |
| `CCLI` | `ccli` | CCLI song number | Up to 20 |
| `ISRC` | `isrc` | Recording code | 12 characters, e.g. `USRC17607839`; dashes and spaces are dropped |
| `Reference` | `reference` | A reference to go with the song — for Christian songs, usually the scripture it draws on: `Psalm 23; John 10:11` | Up to 300 |
| `Tags` | `tags` | Themes or keywords | CSV: separated by `;` (`grace; hope`). JSON: a list. Up to 30, each up to 50 characters |
| `Links` | `links` | Recordings to listen to: YouTube videos (`youtube.com/watch?v=…`, `youtu.be/…`), Spotify tracks, Apple Music songs, Deezer tracks | CSV: separated by `;` (spaces and line breaks work too). JSON: a list. Each is recognised by its host and kept as the address rebuilt from its ID; an address on any other site is a problem with its row. Up to 10 |
| `Notes` | `notes` | Anything else | Up to 2000; may span lines |

Column names are matched loosely — case, spaces and punctuation don't
matter (`Sort Title`, `sort_title` and `SortTitle` are the same) — and some
common alternatives are accepted: `SongNumber`, `No`, `Nr` for `Number`;
`Author`, `Words` for `Lyricist`; `Music` for `Composer`; `BPM` for
`Tempo`; `TimeSignature` for `Time`; `Runtime` for `Duration`;
`Scripture` for `Reference`… `YouTube`, `Spotify`, `AppleMusic` and
`Deezer` columns (one address each, or several) are more `Links`: a file
can have any number of them, and all their addresses are read together
(in JSON, a `youtube` key beside `links` the same way). Columns
Songverse doesn't know are listed in the import preview and ignored.

## Importing

The import always shows a preview first: how many entries will be added,
changed, left as they are (and, in replace mode, removed), plus any rows
with problems. Nothing is saved until you confirm.

- Rows are matched to existing entries by **Number**.
- A column that's **missing** from the file leaves that field alone on
  existing entries — a file with just `Number` and `Tempo` only sets
  tempos. An **empty cell** clears the field.
- A row with a problem (no title for a new entry, a tempo that isn't a
  number…) is skipped and listed; the other rows still import.
- **Merge** (default) adds and updates. **Replace** also removes entries
  whose numbers aren't in the file — use it to sync a catalogue to a
  master spreadsheet. Replace saves nothing while the file has any
  problems, since a skipped row's entry would otherwise be removed.

A JSON file can also create a whole new catalogue, details and all, from
the "New catalogue" page.

## From catalogue entry to song

When a songbook imported from a catalogue turns one of its entries into a
real song, the song starts with every field of the entry: title, subtitle,
sort title, language, album, year, key, time signature, tempo, duration,
copyright, CCLI, ISRC, reference and notes as song fields; its links as
the song's YouTube, Spotify, Apple Music and Deezer links (the first of
each, so Practice offers the video straight away); artists,
composers and lyricists as credits (one per name); tags that match
existing tags (by name, in any language, ignoring case and accents — the
others are left out); and, when the "Original song" entry has itself
become a song, the new song is filed as a translation of it, as another
version of the same song.

## CSV specifics

- First row: column names. One row per song after that.
- Comma, semicolon (what Excel uses in many European locales) or tab
  separated — detected from the header row.
- Standard quoting: wrap a value in double quotes if it contains the
  separator, a quote (written twice: `""`) or a line break.
- UTF-8. Exports start with a byte-order mark so Excel shows accented
  letters correctly; it's ignored on import.

```csv
Number,Title,Lyricist,Composer,Key,Time,Tempo,Tags,Reference
1,À toi la gloire,Edmond Budry,G. F. Handel,D,4/4,96,résurrection; louange,1 Corinthians 15:55
2,"Holy, Holy, Holy",Reginald Heber,John B. Dykes,Eb,4/4,88,trinity,Revelation 4:8
```

## JSON specifics

```json
{
  "format": "songverse-songbook-catalog",
  "version": 1,
  "catalog": {
    "name": "Hymns of Faith",
    "abbreviation": "HOF",
    "publisher": "Example Press",
    "isbn": null,
    "description": null,
    "officialUrl": null,
    "language": "en",
    "sections": [
      { "label": "HOF1", "start": 1, "end": 400 },
      { "label": "HOF2", "start": 401, "end": 800 }
    ]
  },
  "entries": [
    { "number": "1", "title": "Amazing Grace", "lyricist": "John Newton", "year": 1779, "key": "G", "time": "3/4", "tempo": 72, "tags": ["grace", "hymn"] }
  ]
}
```

- `catalog` is optional; when importing into an existing catalogue it's
  ignored (edit details on the page instead).
- `catalog.sections` are the printed volumes: number ranges with a label,
  which may not overlap (issue #55). They're copied into songbooks
  imported from the catalogue. CSV has nowhere to carry them.
- A plain list of entries (`[ {...}, {...} ]`) is accepted too.
- Keys follow the same loose matching as CSV columns. A key set to `null`
  clears that field; a key left out leaves it alone.
- Exports include every key on every entry (`null` when empty), so an
  export re-imported anywhere reproduces the catalogue exactly.
