import { describe, expect, it } from "vite-plus/test";
import {
  compareEntryCodes,
  detectCsvDelimiter,
  emptyCatalogEntry,
  formatDuration,
  parseCatalogCsv,
  parseCatalogFile,
  parseCatalogJson,
  parseDuration,
  parseOriginalSongReference,
  readCatalogLinks,
  serializeCatalogCsv,
  serializeCatalogJson,
  splitNames,
  validateCatalogEntryPatch,
} from "../songbook-catalog-format/index.js";

describe("parseCatalogCsv", () => {
  it("reads the documented columns", () => {
    const csv = [
      "Number,Title,SortTitle,Subtitle,OriginalSong,Language,Artist,Composer,Lyricist,Album,Year,Key,Time,Tempo,Copyright,CCLI,Reference,Tags,Notes",
      '245,"Grâce infinie",Grace infinie,Amazing grace,HYM 12,fr,Choir,Trad.,John Newton,Hymns,1779,G,3/4,72,Public domain,22025,Ephesians 2:8,"grace; hymn",First verse only',
    ].join("\n");
    const result = parseCatalogCsv(csv);
    expect(result.problems).toEqual([]);
    expect(result.unknownColumns).toEqual([]);
    expect(result.rows).toEqual([
      {
        row: 2,
        data: {
          entryCode: "245",
          title: "Grâce infinie",
          sortTitle: "Grace infinie",
          subtitle: "Amazing grace",
          originalSong: "HYM 12",
          originalLanguage: "fr",
          artist: "Choir",
          composer: "Trad.",
          lyricist: "John Newton",
          album: "Hymns",
          year: 1779,
          key: "G",
          timeSignature: "3/4",
          tempo: 72,
          copyright: "Public domain",
          ccli: "22025",
          reference: "Ephesians 2:8",
          tags: ["grace", "hymn"],
          notes: "First verse only",
        },
      },
    ]);
  });

  it("matches headers loosely and accepts aliases, including the old column names", () => {
    const result = parseCatalogCsv("song number;TITLE;author;bpm;Mystery\n1;Hello;Jane;120;x\n");
    expect(result.fields).toEqual(["entryCode", "title", "lyricist", "tempo"]);
    expect(result.unknownColumns).toEqual(["Mystery"]);
    expect(result.rows[0]!.data).toEqual({ entryCode: "1", title: "Hello", lyricist: "Jane", tempo: 120 });
  });

  it("only sets the columns present, and treats empty cells as clearing", () => {
    const result = parseCatalogCsv("Number,Key,Tags\n7,,\n");
    expect(result.rows[0]!.data).toEqual({ entryCode: "7", key: null, tags: [] });
  });

  it("strips a byte-order mark and handles quotes, embedded delimiters and CRLF", () => {
    const result = parseCatalogCsv('\uFEFFNumber,Title,Notes\r\n1,"Holy, holy, holy","He said ""amen""\r\nthen left"\r\n');
    expect(result.rows[0]!.data).toEqual({ entryCode: "1", title: "Holy, holy, holy", notes: 'He said "amen"\r\nthen left'.replace("\r", "") });
  });

  it("reports bad rows without dropping good ones", () => {
    const result = parseCatalogCsv("Number,Title,Tempo,Time,Year\n1,Ok,90,4/4,2001\n2,,abc,four,99\n3,Also ok,,,\n");
    expect(result.rows.map((r) => r.data.entryCode)).toEqual(["1", "3"]);
    expect(result.problems).toEqual([
      { row: 3, message: 'Title is required; Tempo must be a whole number; Time "four" isn\'t valid (like 4/4 or 6/8); Year must be between 1000 and 2999' },
    ]);
  });

  it("needs a Number column", () => {
    expect(parseCatalogCsv("Title\nHello\n").problems).toEqual([
      { row: null, message: "There's no Number column (the header row must name the columns)" },
    ]);
  });

  it("de-duplicates tags, case-insensitively", () => {
    expect(parseCatalogCsv('Number,Tags\n1,"Grace; grace | Hope,hope"\n').rows[0]!.data.tags).toEqual(["Grace", "Hope"]);
  });
});

describe("detectCsvDelimiter", () => {
  it.each([
    ["Number,Title", ","],
    ["Number;Title;Key", ";"],
    ["Number\tTitle", "\t"],
    ['"A;B",Title,Key', ","],
  ])("%j -> %j", (header, expected) => {
    expect(detectCsvDelimiter(`${header}\n1,2`)).toBe(expected);
  });
});

describe("CSV and JSON round trips", () => {
  const entry = {
    ...emptyCatalogEntry("12a", 'Quote " and, comma'),
    tags: ["a", "b c"],
    links: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"],
    tempo: 100,
    notes: "Line one\nline two",
  };

  it("CSV export reads back the same", () => {
    const csv = serializeCatalogCsv([entry]);
    expect(csv.startsWith("\uFEFFNumber,Title,")).toBe(true);
    const back = parseCatalogCsv(csv);
    expect(back.problems).toEqual([]);
    expect(back.rows[0]!.data).toEqual(entry);
  });

  it("JSON export reads back the same, with the catalogue details", () => {
    const details = {
      name: "Hymns",
      abbreviation: "HYM",
      publisher: null,
      isbn: null,
      description: null,
      officialUrl: null,
      language: "en",
      // The printed volumes (issue #55).
      sections: [
        { label: "HYM1", start: 1, end: 400 },
        { label: "HYM2", start: 401, end: 855 },
      ],
    };
    const back = parseCatalogJson(serializeCatalogJson(details, [entry]));
    expect(back.problems).toEqual([]);
    expect(back.details).toEqual(details);
    expect(back.rows[0]!.data).toEqual(entry);
  });

  it("volumes that overlap are a problem with the file", () => {
    const file = JSON.stringify({ catalog: { name: "Hymns", sections: [{ label: "A", start: 1, end: 10 }, { label: "B", start: 5, end: 20 }] }, entries: [] });
    expect(parseCatalogJson(file).problems[0]?.message).toMatch(/^catalog\.sections: /);
  });

  it("entry numbers are stored without a plain number's leading zeros", () => {
    const back = parseCatalogCsv("Number,Title\n0245,Amazing Grace\nFR-092,Grâce infinie\n");
    expect(back.rows.map((row) => row.data.entryCode)).toEqual(["245", "FR-092"]);
  });
});

describe("parseCatalogJson", () => {
  it("accepts a bare array and reports unknown keys and bad entries", () => {
    const result = parseCatalogJson(JSON.stringify([{ number: 5, title: "Five", colour: "red" }, { title: "No number" }, "nope"]));
    expect(result.rows).toEqual([{ row: 1, data: { entryCode: "5", title: "Five" } }]);
    expect(result.unknownColumns).toEqual(["colour"]);
    expect(result.problems).toEqual([
      { row: 2, message: "Number is required" },
      { row: 3, message: "Each entry must be an object" },
    ]);
  });

  it("rejects a newer format version and invalid JSON", () => {
    expect(parseCatalogJson('{"version": 99, "entries": []}').problems[0]!.message).toMatch(/version 99/);
    expect(parseCatalogJson("{nope").problems[0]!.message).toMatch(/Not valid JSON/);
  });
});

describe("parseCatalogFile", () => {
  it("picks the reader by extension, else by content", () => {
    expect(parseCatalogFile("Number\n1", "x.csv").format).toBe("csv");
    expect(parseCatalogFile("[]", "x.json").format).toBe("json");
    expect(parseCatalogFile(' [{"number":"1"}]').format).toBe("json");
    expect(parseCatalogFile("Number\n1").format).toBe("csv");
  });
});

describe("validateCatalogEntryPatch", () => {
  it("validates single-field edits the same way", () => {
    expect(validateCatalogEntryPatch({ tempo: "96", tags: "a;b", unknown: 1 })).toEqual({ data: { tempo: 96, tags: ["a", "b"] }, problems: [] });
    expect(validateCatalogEntryPatch({ title: " " }).problems).toEqual(["Title is required"]);
  });
});

describe("compareEntryCodes", () => {
  it("sorts numbers naturally", () => {
    expect(["10", "2", "12a", "12", "A-1", "1"].sort(compareEntryCodes)).toEqual(["1", "2", "10", "12", "12a", "A-1"]);
  });
});

describe("parseOriginalSongReference", () => {
  it.each([
    ["JEM 245", { abbreviation: "JEM", entryCode: "245" }],
    ["JEM245", { abbreviation: "JEM", entryCode: "245" }],
    ["JEM:12a", { abbreviation: "JEM", entryCode: "12a" }],
    ["245", { abbreviation: null, entryCode: "245" }],
    ["Amazing Grace", null],
  ])("%j", (text, expected) => {
    expect(parseOriginalSongReference(text)).toEqual(expected);
  });
});

describe("Duration and ISRC columns", () => {
  it("reads durations as m:ss, h:mm:ss or seconds, and writes m:ss", () => {
    const result = parseCatalogCsv("Number,Runtime\n1,3:45\n2,1:02:03\n3,225\n4,3:75\n");
    expect(result.rows.map((r) => r.data.durationSeconds)).toEqual([225, 3723, 225]);
    expect(result.problems).toEqual([{ row: 5, message: "Duration must be like 3:45 (or a number of seconds)" }]);
    const csv = serializeCatalogCsv([{ ...emptyCatalogEntry("1", "x"), durationSeconds: 225 }]);
    expect(csv).toContain(",3:45,");
  });

  it("stores ISRCs compact and upper-case, and rejects malformed ones", () => {
    const result = parseCatalogCsv("Number,ISRC\n1,us-rc1-76-07839\n2,nope\n");
    expect(result.rows[0]!.data.isrc).toBe("USRC17607839");
    expect(result.problems[0]!.message).toMatch(/ISRC "NOPE" isn't valid/);
  });
});

describe("duration helpers", () => {
  it.each([
    ["0:05", 5],
    ["10:00", 600],
    ["1:00:00", 3600],
    ["90", 90],
    ["1:60", null],
    ["abc", null],
  ])("parseDuration(%j) = %j", (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });

  it("formats", () => {
    expect([5, 225, 3723].map(formatDuration)).toEqual(["0:05", "3:45", "1:02:03"]);
  });

  it("formats a player's position: whole seconds, never below 0 (issue #112)", () => {
    expect([59.9, -1, Number.NaN, Number.POSITIVE_INFINITY].map(formatDuration)).toEqual(["0:59", "0:00", "0:00", "0:00"]);
  });
});

describe("splitNames", () => {
  it("splits on semicolons, trims and drops repeats", () => {
    expect(splitNames(" Hillsong Worship ;Brooke Ligertwood; hillsong worship;; ")).toEqual(["Hillsong Worship", "Brooke Ligertwood"]);
    expect(splitNames(null)).toEqual([]);
  });
});

describe("Links (issue #210)", () => {
  it("reads each address by its host, rebuilt from its ID, repeats dropped", () => {
    const { links, refused } = readCatalogLinks("https://youtu.be/dQw4w9WgXcQ; https://www.youtube.com/watch?v=dQw4w9WgXcQ  deezer.com/track/3135556");
    expect(links).toEqual([
      { service: "YOUTUBE", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      { service: "DEEZER", url: "https://www.deezer.com/track/3135556" },
    ]);
    expect(refused).toEqual([]);
    expect(readCatalogLinks(["https://example.com/song", "not a link"]).refused).toEqual(["https://example.com/song", "not", "a", "link"]);
  });

  it("merges a Links column with each service's own, and refuses another site per row", () => {
    const parsed = parseCatalogCsv(
      [
        "Number,Title,YouTube,Spotify,Links",
        "1,One,https://youtu.be/dQw4w9WgXcQ,https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC,https://www.deezer.com/track/3135556",
        "2,Two,https://example.com/two,,",
        "3,Three,,,",
      ].join("\n"),
    );
    expect(parsed.fields).toEqual(["entryCode", "title", "links"]);
    expect(parsed.rows.map((row) => row.data.links)).toEqual([
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "https://www.deezer.com/track/3135556"],
      [],
    ]);
    expect(parsed.problems).toEqual([{ row: 3, message: `Links: "https://example.com/two" isn't a YouTube, Spotify, Apple Music or Deezer address` }]);
  });

  it("takes a JSON list, and a service's own key alongside", () => {
    const parsed = parseCatalogJson(JSON.stringify([{ number: "1", title: "One", links: ["https://youtu.be/dQw4w9WgXcQ"], deezer: "https://www.deezer.com/track/3135556" }]));
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows[0]!.data.links).toEqual(["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.deezer.com/track/3135556"]);
    expect(validateCatalogEntryPatch({ links: "https://vimeo.com/1" }).problems).toHaveLength(1);
  });
});
