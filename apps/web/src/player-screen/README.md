# Songverse Player standalone renderer

This client-only entry point imports **the existing `ScreenStage`** from `apps/web/src/components/screen-stage.tsx` and the built-in theme from `@songverse/core`.

Build from the Songverse workspace:

```sh
cd apps/web
vp build --config vite.player.config.ts
```

The output directory is `apps/web/dist/player-screen`; its generated HTML entry is `player-screen.html` because the source is named that way. Rename the built HTML entry to `index.html` while packaging (see Songverse Player bundle script). Keep `assets/` at the same level.

The first screen uses the Rust player's `/api/state` mock data, translating the demo's lines into `ScreenSlide`. The arrows call local navigation endpoints. The stage, themes and CSS are **real Songverse components**.

This is **not** yet a complete disconnected version of the paired Songverse `/screen` route: no cloud pairing, actual cached set data, custom template assets, sync transport or signed bundle release metadata. Future versions should receive a versioned local stage snapshot and use actual offline set/chart data instead of translating the Rust demo.
