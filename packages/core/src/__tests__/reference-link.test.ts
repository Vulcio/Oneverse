import { describe, expect, test } from "vite-plus/test";
import { readReferenceLink, readStartTime } from "../streaming-links/reference.js";

describe("reference recordings (issue #346)", () => {
  test("a YouTube address, in its forms, with its start", () => {
    for (const input of ["https://www.youtube.com/watch?v=abcDEF12345&t=90", "youtu.be/abcDEF12345?t=1m30s", "https://www.youtube.com/embed/abcDEF12345?start=90", "https://m.youtube.com/shorts/abcDEF12345?t=90s"]) {
      expect(readReferenceLink(input)).toEqual({ service: "YOUTUBE", value: "abcDEF12345", url: "https://www.youtube.com/watch?v=abcDEF12345", startSeconds: 90 });
    }
  });

  test("streaming services by their address", () => {
    expect(readReferenceLink("https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC?si=x")).toMatchObject({ service: "SPOTIFY", value: "4uLU6hMCjMI75M1A2tKUQC" });
    expect(readReferenceLink("https://www.deezer.com/fr/track/3135556")).toMatchObject({ service: "DEEZER", value: "3135556" });
    expect(readReferenceLink("https://music.apple.com/us/album/x/1440857781?i=1440857786")).toMatchObject({ service: "APPLE_MUSIC", value: "1440857786" });
  });

  test("any other address is kept as it is; not an address is refused", () => {
    expect(readReferenceLink("https://vimeo.com/123456")).toEqual({ service: "OTHER", value: null, url: "https://vimeo.com/123456", startSeconds: null });
    expect(readReferenceLink("https://www.youtube.com/@channel")).toMatchObject({ service: "OTHER" });
    expect(readReferenceLink("not a link")).toBeNull();
    expect(readReferenceLink("javascript:alert(1)")).toBeNull();
  });

  test("start times", () => {
    expect([readStartTime("90"), readStartTime("90s"), readStartTime("1m30s"), readStartTime("1h"), readStartTime("x"), readStartTime("")]).toEqual([90, 90, 90, 3600, null, null]);
  });
});
