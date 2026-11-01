import { describe, expect, it } from "vite-plus/test";
import { defaultPlaybackSource, filesForSource, playbackSourcesOf, resolvePlaybackSource, type PlaybackFile } from "../playback/index.js";
import { ChartPreferencesSchema } from "../schemas/arrangement-document-v2.js";

const file = (over: Partial<PlaybackFile>): PlaybackFile => ({ type: "AUDIO", stemPart: null, filename: "x.opus", createdAt: "2026-01-01T00:00:00Z", ...over });
const master = file({ filename: "Master.opus" });
const drums = file({ stemPart: "DRUMS", filename: "Drums.opus", origin: "SEPARATED" });
const take = file({ stemPart: "VOCALS", filename: "Take.webm", origin: "RECORDED" });

describe("playback sources (issue #366)", () => {
  it("offers what the song has, with the metronome and nothing always", () => {
    expect(playbackSourcesOf({ files: [master, drums, take], youtube: true })).toEqual(["MASTER", "YOUTUBE", "STEMS", "TAKES", "METRONOME", "NONE"]);
    expect(playbackSourcesOf({ files: [], youtube: false })).toEqual(["METRONOME", "NONE"]);
  });

  it("defaults to the quickest thing that sounds like the song", () => {
    expect(defaultPlaybackSource({ files: [master, drums], youtube: true })).toBe("MASTER");
    expect(defaultPlaybackSource({ files: [drums, take], youtube: true })).toBe("TAKES");
    expect(defaultPlaybackSource({ files: [], youtube: true })).toBe("YOUTUBE");
    expect(defaultPlaybackSource({ files: [], youtube: false, tempo: 120 })).toBe("METRONOME");
    expect(defaultPlaybackSource({ files: [], youtube: false })).toBe("NONE");
  });

  it("keeps a choice only while the song offers it", () => {
    expect(resolvePlaybackSource({ files: [master, drums], youtube: false }, undefined, "STEMS")).toBe("STEMS");
    expect(resolvePlaybackSource({ files: [master, drums], youtube: false }, "NONE", "STEMS")).toBe("NONE");
    expect(resolvePlaybackSource({ files: [master], youtube: false }, "TAKES")).toBe("MASTER");
  });

  it("leaves the takes out of the stems", () => {
    expect(filesForSource([drums, take], "STEMS")).toEqual([drums]);
    expect(filesForSource([drums, take], "TAKES")).toEqual([drums, take]);
    expect(filesForSource([take], "STEMS")).toEqual([take]);
  });

  it("is kept with the chart preferences", () => {
    expect(ChartPreferencesSchema.parse({ $schema: "chart-preferences/v1", playback: "METRONOME" }).playback).toBe("METRONOME");
    expect(ChartPreferencesSchema.safeParse({ $schema: "chart-preferences/v1", playback: "LOUD" }).success).toBe(false);
  });
});
