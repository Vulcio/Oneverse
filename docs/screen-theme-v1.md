# Screen theme v1

How a big screen shows a set (issue #194): a small JSON document, the same
for the web screen (`/screen`), the Google TV app (#187) and the native apps
(#165). It's described by `ScreenThemeSchema` in `@songverse/core`
(`packages/core/src/screens/theme.ts`); the shared test cases in
`packages/core/conformance/screens.json` say how a client reads one.

## Reading a theme

Every part has defaults, so `{}` is the default look (white words on black).
A client reads a theme with `resolveScreenTheme`:

- a field it doesn't know is ignored (a later version may add some);
- a part it can't read (a colour that isn't `#rrggbb`, a font it doesn't
  have) falls back to that part's defaults, and the rest of the theme stays;
- anything that isn't a theme is the default look.

A screen gets its theme already worked out in `GET /screens/current`
(`theme`): its saved theme, else its built-in one, else the default.

## Slides stay the same

Live and every screen cut a song into the same slides (`lyricSlides`,
two lines at a time), since only "this song, slide N" crosses the network.
A theme never changes them: `lines.group` shows the slide, or its whole
section with the slide's lines picked out.

## The document

```jsonc
{
  "$schema": "screen-theme/v1",
  "text": {
    "font": "sans",          // sans, rounded, geometric, serif, elegant, condensed, display, mono
    "customFont": null,      // an uploaded font's asset id: used once it's loaded, "font" meanwhile
    "size": "auto",          // "auto" fits the longest current line; or % of the screen's shorter side (2-20)
    "weight": 600,           // 100-900
    "upperCase": false,
    "color": "#ffffff",
    "effect": "shadow",      // none, shadow, outline, glow: readability over a moving background
    "lineHeight": 1.15,
    "align": "center",       // left, center, right
    "letterSpacing": 0       // em
  },
  "lines": {
    "group": "slide",        // slide, section
    "before": 1,             // lines before the slide (0-3), with group "slide"
    "after": 1,              // lines after it (0-3)
    "contextStyle": "dim"    // dim, small, blur, hidden: the lines around the current ones
  },
  "layout": {
    "position": "center",    // top, center, bottom, lower-third (a band at the bottom, for a stream)
    "margin": 5              // kept clear all round, % of the screen (overscan)
  },
  "background": {
    "kind": "color",         // color, gradient, aurora, waves, particles, spotlight, image, video
    "media": null,           // the picture's or video's asset id, for image and video; without it, the colours
    "colors": ["#000000"],   // 1-4; the first is the base, the others the gradient's or the moving lights'
    "reactive": false,       // a pulse of light with each slide; brighter in a chorus (sectionEnergy)
    "motion": 0.5,           // 0 (still) to 1
    "dim": 0                 // 0-0.9: darkens the background under the words
  },
  "title": { "show": true, "when": "first" },                       // first, every
  "credits": { "show": true, "where": "bottom", "when": "first-and-last" }, // bottom, top, lower-third; first, last, first-and-last, every
  "motion": {
    "transition": "fade",    // cut, fade, slide, rise, scale, blur, zoom
    "duration": 350,         // ms per slide; a new song takes twice as long
    "reveal": "none",        // none, lines, words, letters, typewriter, glow
    "stagger": 60            // ms between pieces; a slide's words are all in within 1.6 s
  },
  "chords": { "color": "#7dd3fc", "scale": 1 },                     // the band's chart
  "grid": null                                                      // widgets on a grid (below); null: the words fill the screen
}
```

## Widgets on a grid

A theme (a "template" in the app) can place widgets on a grid (issue #268).
`grid` is null by default: the words fill the screen, as they always have.

```jsonc
"grid": {
  "columns": 12, "rows": 12,  // 1 to 24, inside the safe margin (layout.margin)
  "gap": 1,                   // between cells, % of the screen's shorter side
  "black": "all",             // what Black hides: "all", or "words" (a stage display keeps its clock)
  "widgets": [                // drawn in order: later ones on top; up to 32
    {
      "id": "clock",          // unique in the grid
      "kind": "clock",        // stage, current-slide, next-slide, current-section, next-section, song-structure, clock, analog-clock,
                              // countdown, count-up, message, song, next-song, current-item, next-item, text
      "x": 8, "y": 0, "w": 4, "h": 2,   // first column and row (from 0), cells covered
      "options": {            // each kind reads its own and ignores the rest
        "format": "24h", "seconds": false, "date": false,        // clock
        "source": "operator", // countdown: operator, duration, until; count up: operator, song
        "duration": 300,      // countdown from "duration": seconds, from when the set item came on
        "until": "10:00",     // countdown "until": a time of day, the device's
        "overtime": "count",  // past zero: count on (red), or "stop" at 0:00
        "warn": 60,           // amber under this many seconds
        "label": "",          // a few words above it
        "text": "",           // text: its words
        "details": true,      // song: key and tempo; song-structure: a progress bar; current-item: its place (3 of 8)
        "breakpoints": []     // countdown, count up: [{ "at": 300, "color": "#f59e0b", "background": null }] - colours by time (timerColors)
      },
      "style": {
        "font": null, "color": null,           // null: the theme's
        "background": "#000000", "opacity": 0, // a panel behind it (0: none)
        "align": "center", "size": "auto",     // "auto" fits the cell; a number is % of the cell's height
        "radius": 1
      }
    }
  ]
}
```

- **stage** is the words, as the screen shows them without a grid (lyrics or
  the chart, the theme's text, lines, motion), in its cells.
- **current-slide** and **next-slide**: the slide's lines; the next one after
  a song's last slide is the next song's first.
- **song**: the title, key and tempo of the song on screen; **next-song**: the
  next song's title.
- **countdown** and **count-up**: `readScreenTimer` gives what they show and
  `formatTimer` how (core, with shared test cases). The operator's timer and
  **message** come from the set's session (issue #269).
- A widget is kept inside the grid (`placeScreenWidget`), whatever the theme
  says. A widget a client can't read - a kind from a later version - leaves
  its cells empty; the rest of the grid stays.
- `SCREEN_LAYOUT_PRESETS`: grids to start from (words, words-clock,
  stage-display).

## A theme's files

A saved theme can have files (`ScreenThemeAsset`): a background picture or
looping video (`media`: JPEG, PNG, WebP, AVIF, GIF up to 15 MB; MP4, WebM up
to 150 MB) and fonts (`font`: WOFF2, WOFF, TTF, OTF up to 5 MB), uploaded with
`POST /screen-themes/:id/assets?kind=`. The document refers to them by id.
A screen gets them in `GET /screens/current` (`assets`), each with a signed
address it can load without a session. A client loads a font from its bytes
(the web app hands them to `FontFace`), plays a video muted and looping, and
shows the colours while a file is missing.

## Built-in themes

`SCREEN_THEME_TEMPLATES`: classic (the default), concert, chapel, sunrise,
starlight, spotlight, stream, minimal, stage-display (widgets on a grid),
stage-monitor. A screen picks one by
its id (`themeTemplate`) or a saved theme (`themeId`); their names are in the
locale files (`screens.templates.<id>`). `/screen?theme=<id>` pins one on a
device.

## Drawing it

- Animate only `transform`, `opacity` and a little `filter` (blur): the GPU
  composites them at 60 frames a second without laying anything out again.
  The web screen draws soft lights as radial gradients, not blurred shapes.
- A slide's change plays the old slide out and the new one in at the same
  time, for `duration`; `reveal` then brings the words in one piece after
  another.
- Honour the device's reduced-motion setting: still backgrounds, plain fades.
- Black (from Live) fades everything out, then shows nothing; with a grid
  whose `black` is "words", only the words widgets go.
- `screenThemeContrast` gives the lowest contrast between the words and what's
  under them; an editor warns under 4.5.
