# A song's chart is stored as a structured document with stable ids

A chart is stored as SongDocument v2 (docs/song-document-v2.md): sections, lines and chords with ids that survive
edits, and the song order. ChordPro is only an import and export format. Arrangements, notes, recordings' cue points
and translations point at those ids, so a chart can be edited without breaking everything that refers to it. Title,
credits and capo are kept beside the chart, never inside it. Every save is kept in the song's history (#71).
