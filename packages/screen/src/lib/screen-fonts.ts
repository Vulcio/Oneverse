import { type ScreenFont, type ScreenTheme } from "@oneverse/core";
import { useEffect } from "react";

/**
 * The built-in fonts (issue #395), bundled with the app and loaded the first
 * time a template uses one: a screen never fetches a font from anywhere
 * else, and a template using two fonts loads two. Inter, the default, is
 * always there (screen-stage imports it).
 */
const LOADERS: Record<ScreenFont, (() => Promise<unknown>)[]> = {
  sans: [],
  mono: [],
  rounded: [() => import("@fontsource-variable/nunito/wght.css"), () => import("@fontsource-variable/nunito/wght-italic.css")],
  geometric: [() => import("@fontsource-variable/montserrat/wght.css"), () => import("@fontsource-variable/montserrat/wght-italic.css")],
  serif: [() => import("@fontsource-variable/lora/wght.css"), () => import("@fontsource-variable/lora/wght-italic.css")],
  elegant: [() => import("@fontsource-variable/playfair-display/wght.css"), () => import("@fontsource-variable/playfair-display/wght-italic.css")],
  condensed: [() => import("@fontsource-variable/oswald/wght.css")],
  display: [() => import("@fontsource/bebas-neue/400.css")],
  hyperlegible: [() => import("@fontsource-variable/atkinson-hyperlegible-next/wght.css"), () => import("@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css")],
  "dm-sans": [() => import("@fontsource-variable/dm-sans/wght.css"), () => import("@fontsource-variable/dm-sans/wght-italic.css")],
  manrope: [() => import("@fontsource-variable/manrope/wght.css")],
  outfit: [() => import("@fontsource-variable/outfit/wght.css")],
  poppins: [
    () => import("@fontsource/poppins/400.css"),
    () => import("@fontsource/poppins/500.css"),
    () => import("@fontsource/poppins/600.css"),
    () => import("@fontsource/poppins/700.css"),
    () => import("@fontsource/poppins/800.css"),
    () => import("@fontsource/poppins/400-italic.css"),
    () => import("@fontsource/poppins/700-italic.css"),
  ],
  raleway: [() => import("@fontsource-variable/raleway/wght.css"), () => import("@fontsource-variable/raleway/wght-italic.css")],
  "open-sans": [() => import("@fontsource-variable/open-sans/wght.css"), () => import("@fontsource-variable/open-sans/wght-italic.css")],
  "work-sans": [() => import("@fontsource-variable/work-sans/wght.css"), () => import("@fontsource-variable/work-sans/wght-italic.css")],
  "source-sans": [() => import("@fontsource-variable/source-sans-3/wght.css"), () => import("@fontsource-variable/source-sans-3/wght-italic.css")],
  "space-grotesk": [() => import("@fontsource-variable/space-grotesk/wght.css")],
  josefin: [() => import("@fontsource-variable/josefin-sans/wght.css"), () => import("@fontsource-variable/josefin-sans/wght-italic.css")],
  merriweather: [() => import("@fontsource-variable/merriweather/wght.css"), () => import("@fontsource-variable/merriweather/wght-italic.css")],
  garamond: [() => import("@fontsource-variable/eb-garamond/wght.css"), () => import("@fontsource-variable/eb-garamond/wght-italic.css")],
  cormorant: [() => import("@fontsource-variable/cormorant-garamond/wght.css"), () => import("@fontsource-variable/cormorant-garamond/wght-italic.css")],
  baskerville: [() => import("@fontsource/libre-baskerville/400.css"), () => import("@fontsource/libre-baskerville/700.css"), () => import("@fontsource/libre-baskerville/400-italic.css")],
  crimson: [() => import("@fontsource-variable/crimson-pro/wght.css"), () => import("@fontsource-variable/crimson-pro/wght-italic.css")],
  anton: [() => import("@fontsource/anton/400.css")],
  abril: [() => import("@fontsource/abril-fatface/400.css")],
  dancing: [() => import("@fontsource-variable/dancing-script/wght.css")],
  caveat: [() => import("@fontsource-variable/caveat/wght.css")],
  jetbrains: [() => import("@fontsource-variable/jetbrains-mono/wght.css"), () => import("@fontsource-variable/jetbrains-mono/wght-italic.css")],
};

const loaded = new Map<ScreenFont, Promise<void>>();

/** A built-in font's files, loaded once (its stylesheet added to the page); nothing for one already there. */
export function loadScreenFont(font: ScreenFont): Promise<void> {
  let done = loaded.get(font);
  if (!done) {
    done = Promise.all((LOADERS[font] ?? []).map((load) => load())).then(
      () => undefined,
      () => undefined,
    );
    loaded.set(font, done);
  }
  return done;
}

/** Every built-in font a template uses: its words', a chorus's and a bridge's, its chords', its title's, its widgets'. */
export function screenThemeFonts(theme: ScreenTheme): ScreenFont[] {
  const fonts = [
    theme.text.font,
    theme.sections.chorus?.text.font,
    theme.sections.bridge?.text.font,
    theme.chords.font,
    theme.title.font,
    ...(theme.grid?.widgets ?? []).map((widget) => widget.style.font),
  ];
  return [...new Set(fonts.filter((font): font is ScreenFont => !!font))];
}

/** The template's fonts loaded as soon as it's shown. */
export function useScreenFonts(theme: ScreenTheme): void {
  const fonts = screenThemeFonts(theme).join(" ");
  useEffect(() => {
    for (const font of fonts.split(" ")) if (font) void loadScreenFont(font as ScreenFont);
  }, [fonts]);
}
