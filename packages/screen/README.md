# @oneverse/screen

What a screen shows (issue #305): `ScreenStage` - the template's layers, its
widgets, the words of the slide or the chart, the backgrounds and effects -
and the chart it draws (`SongChart`). Songverse's web app (its screen page,
Screens' previews, Live's chart), the player's screen bundle and the screen
app all build from these files; nothing else draws a screen.

Source only, no build, like `@oneverse/ui`: an app imports the files and
compiles them, and its Tailwind scans this package
(`@source ".../packages/screen/src"` in the app's CSS).

```tsx
import { ScreenStage, type StageSong } from "@oneverse/screen/components/screen-stage";
import { ScreenGrid, type StageLive } from "@oneverse/screen/components/screen-widgets";
import { SongChart } from "@oneverse/screen/components/song-chart";
```

The stage reads the text it shows through `react-i18next`, so it needs an
`I18nextProvider` above it, with the app's locales from `@oneverse/core`.
