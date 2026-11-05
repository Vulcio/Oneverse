# Stored waveforms

Issue #388. The server works out each audio file's waveform once and keeps
it, so a player can draw a part's shape before its audio has arrived, and
anything else that wants a file's shape (Pulse, the native apps, overviews)
can have it without downloading or decoding the file.

## How it's made

- The Worker (`apps/api/src/waveforms/waveforms.processor.ts`) reads the
  file through ffmpeg as 16-bit samples in its own channels, at 22.05 kHz,
  and measures it as it streams (`WaveformMeter` in `@oneverse/core`).
- A sweep finds the audio files without one, newest first, and works
  through them for up to four minutes. It runs every five minutes, and a
  second after an upload, a processed take, an upload made Opus or a stem
  separation's stems. The files stored before this existed get theirs the
  same way, a few minutes at a time, with nothing to start.
- A file that is still being processed (`processing` set) waits for its
  final file. One ffmpeg can't read gets an empty waveform, so it isn't
  tried again. Without ffmpeg nothing is measured.
- They're kept in `AudioWaveform`, keyed by the stored object's hash, so
  files with the same bytes share one, and it's deleted with the last of
  them (`StorageService.deleteUnreferenced`).

## The format

`GET /song-versions/:id/attachments/waveforms` lists the waveforms of the
song's audio files the viewer sees (a file without one yet isn't listed):

```json
[{ "attachmentId": "…", "rate": 100, "seconds": 213.4, "loudest": 0.97, "peaks": "base64…" }]
```

- `peaks`: one byte a slice, `rate` slices a second (100: one every 10 ms),
  the loudest sample in that slice across the channels, against the
  loudest in the whole file (255). About 6 KB a minute.
- `loudest`: that loudest sample, 0-1 linear, to draw a part as loud as it
  is rather than at its own scale.
- `readWaveform()` in `@oneverse/core` turns it into 0-1 levels;
  `waveformPeakBetween()` and `waveformSlices()` read them for a column or
  a fixed width.

## In the web app

`songWaveforms()` (`apps/web/src/lib/song-files.ts`) asks for a song's once
and keeps them for the page's life (they never change for a file). The stem
player shows them as soon as they come, faint, filled in as each file
downloads (`StemTrack.downloaded`), and drawn as usual once decoded
(`StemTrack.ready`). The Tracks view draws decoded audio at the same 10 ms,
so nothing changes when the audio takes over. Offline, there are none: the
waveforms are drawn once the files are decoded, as before.
