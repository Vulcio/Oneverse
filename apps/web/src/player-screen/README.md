# Player screen

A client-only build of the screens' stage for [Oneverse Pulse](https://github.com/Vulcio/oneverse-pulse),
the Rust mini-PC player (issue #247). It renders with the **same** `ScreenStage`, themes, CSS and
messages as `/screen`, so a screen looks the same on the player as in a browser: the stage lives in
`packages/screen` (`@oneverse/screen`, issue #305), which both build from. Nothing here is a second
implementation of the stage.

```sh
pnpm --filter @oneverse/web build:player-screen   # apps/web/dist/player-screen
```

The output is a page (`player-screen.html`) and `assets/`; Oneverse Pulse's
`tools/package-upstream-screen.sh` copies it into a bundle as `index.html` and checks it with a manifest.
The web app's public files (its service worker and manifest) are left out (`publicDir: false`).

For now it reads the player's local API: `GET /api/state` (a set's title and slides, the slide shown)
and `POST /api/next` / `/api/previous` from the arrow keys. Its language is the device's (English or
French), or `?lang=`.

`e2e/web/player-screen.test.mjs` builds it as the player does, serves it with a stand-in for that API
and checks it renders and moves: a change to `ScreenStage` that breaks the player fails there.

Not yet: real sets, themes and their files from Songverse, pairing, and sync. That needs a versioned local
snapshot of a screen's state (`ScreenCurrent`, `SyncPresenting`, `SyncStage` and the theme's files) agreed
between the two repositories.
