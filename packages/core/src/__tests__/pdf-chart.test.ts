import { describe, expect, it } from "vite-plus/test";
import { chordProFromPdfText, type PdfTextItem } from "../pdf-chart/index.js";
import { readOcrPage, type OcrBox, type OcrLine, type OcrWord } from "../pdf-chart/ocr.js";
import { readPdfChart } from "../pdf-chart/read.js";

// Helvetica widths for the characters these tests use (thousandths of an em).
const W: Record<string, number> = { " ": 278, A: 667, a: 556, m: 833, z: 500, i: 222, n: 556, g: 556, r: 333, c: 500, e: 556, h: 556, o: 556, w: 722, s: 500, t: 278, u: 556, d: 556, G: 778, D: 722, C: 722, V: 667, "1": 556, Ô: 778, l: 222, v: 500, y: 500 };
const SIZE = 12;
const width = (text: string) => ([...text].reduce((sum, char) => sum + (W[char] ?? 556), 0) * SIZE) / 1000;

/** A piece of text at `x` on line `row` (rows 16 pt apart), as a PDF reader gives it. */
const item = (text: string, x: number, row: number, page = 1): PdfTextItem => ({ page, text, x, y: 100 + row * 16, width: width(text), height: SIZE });
/** Where character `index` of `text` starts, for text set at `x`. */
const at = (text: string, index: number, x = 50) => x + width(text.slice(0, index));

describe("a chart from a PDF's text (issue #124)", () => {
  it("places each chord on the character printed under it (the issue's example)", () => {
    const lyric = "Amazing grace how sweet";
    const items = [item("G", at(lyric, 3), 0), item("D", at(lyric, lyric.indexOf("how")), 0), item(lyric, 50, 1)];
    expect(chordProFromPdfText(items)).toBe("Ama[G]zing grace [D]how sweet");
  });

  it("by position, not by counting spaces: a proportional font's spaces don't line up", () => {
    // In the chord line, the chords are one piece with spaces between: its spaces are narrower than the lyrics' letters.
    const lyric = "the sound that saved a wretch";
    const g = at(lyric, 5);
    const c = at(lyric, lyric.indexOf("saved"));
    const chordLine = "G" + " ".repeat(Math.round((c - g - width("G")) / width(" "))) + "C";
    const items = [{ ...item(chordLine, g, 0), width: c + width("C") - g }, item(lyric, 50, 1)];
    expect(chordProFromPdfText(items)).toBe("the s[G]ound that [C]saved a wretch");
  });

  it("a chord a little left of its letter still lands on it", () => {
    const lyric = "Amazing";
    expect(chordProFromPdfText([item("G", at(lyric, 3) - 1.5, 0), item(lyric, 50, 1)])).toBe("Ama[G]zing");
  });

  it("chords past the end of the words go after them", () => {
    const lyric = "grace";
    expect(chordProFromPdfText([item("D", 50 + width(lyric) + 20, 0), item(lyric, 50, 1)])).toBe("grace [D]");
  });

  it("a line in several pieces is one line, a gap between them a space", () => {
    const items = [item("G", at("Amazing grace", 8), 0), item("Amazing", 50, 1), item("grace", 50 + width("Amazing "), 1)];
    expect(chordProFromPdfText(items)).toBe("Amazing [G]grace");
  });

  it("section labels, gaps between parts and chord lines on their own", () => {
    const items = [
      item("Verse 1", 50, 0),
      item("G", 50, 1),
      item("Amazing grace", 50, 2),
      // A gap of two lines: a new part.
      item("C", 50, 5),
      item("G", 80, 5),
      item("Chorus", 50, 8),
      item("D", at("Ôh sweet", 3), 9),
      item("Ôh sweet", 50, 10),
    ];
    expect(chordProFromPdfText(items)).toBe(["Verse 1", "[G]Amazing grace", "", "[C] [G]", "", "Chorus", "Ôh [D]sweet"].join("\n"));
  });

  it("a new page starts a new part; lines are read top to bottom, whatever order the PDF gives them in", () => {
    const items = [item("sweet", 50, 0, 2), item("Amazing", 50, 1, 1), item("G", 50, 0, 1)];
    expect(chordProFromPdfText(items)).toBe("[G]Amazing\n\nsweet");
  });

  it("a fixed-width font (Courier): each character the same width, whatever Helvetica would give it", () => {
    // Courier: every character 0.6 em. pdf.js gives it word by word.
    const mono = (text: string, x: number, row: number): PdfTextItem => ({ page: 1, text, x, y: 100 + row * 16, width: text.length * 7.2, height: SIZE });
    const items = [mono("G", 60 + 3 * 7.2, 0), mono("D", 60 + 8 * 7.2, 0), mono("Amazing", 60, 1), mono("grace", 60 + 8 * 7.2, 1)];
    expect(chordProFromPdfText(items)).toBe("Ama[G]zing [D]grace");
  });

  it("a scanned page has no text: nothing", () => {
    expect(chordProFromPdfText([])).toBe("");
  });
});

describe("a whole PDF chart: header, footer, columns and details (issue #124)", () => {
  // A line of text at `x`, `y` in a 600 × 800 page, each piece one item.
  const piece = (text: string, x: number, y: number, page = 1, size = SIZE): PdfTextItem => ({ page, text, x, y, width: (width(text) * size) / SIZE, height: size });
  const pages = [1, 2].map((page) => ({ page, width: 600, height: 800 }));
  const verse = (x: number, y: number, page = 1) => [
    piece("Verse 1", x, y, page),
    piece("G", at("Amazing", 3, x), y + 16, page),
    piece("Amazing grace", x, y + 32, page),
    piece("C", x, y + 48, page),
    piece("That saved", x, y + 64, page),
  ];

  it("takes the title, the names and the details from the top, and leaves out the footer", () => {
    const items = [
      piece("Amazing Grace", 50, 60, 1, 20),
      piece("Chris Tomlin | John Newton", 50, 80),
      piece("Key - G | Tempo - 64 | Time - 3/4", 50, 96),
      ...verse(50, 140),
      piece("CCLI Song # 4768151 | © 2006 sixsteps Music | For use solely with the SongSelect Terms of Use.", 50, 780),
    ];
    const { chart, details, dropped } = readPdfChart(items, pages);
    expect(chart).toBe(["Verse 1", "Ama[G]zing grace", "[C]That saved"].join("\n"));
    expect(details).toMatchObject({ title: "Amazing Grace", artists: ["Chris Tomlin", "John Newton"], key: "G", tempo: 64, timeSignature: "3/4", ccli: "4768151", copyright: "© 2006 sixsteps Music" });
    expect(dropped).toHaveLength(1);
  });

  it("leaves out what repeats at the top or bottom of every page, numbers aside", () => {
    const items = [...verse(50, 140), piece("worshipcharts - Page 1 of 2", 50, 20), ...verse(50, 140, 2), piece("worshipcharts - Page 2 of 2", 50, 20, 2)];
    const { chart, dropped } = readPdfChart(items, pages);
    expect(chart).not.toContain("worshipcharts");
    expect(dropped).toEqual(["worshipcharts - Page 1 of 2", "worshipcharts - Page 2 of 2"]);
  });

  it("takes the first page's title, repeated at the top of every page, as the title", () => {
    const items = [piece("Amazing Grace", 50, 30, 1, 20), piece("Key: G", 50, 50), ...verse(50, 140), piece("Amazing Grace", 50, 30, 2, 20), ...verse(50, 140, 2)];
    const { chart, details, dropped } = readPdfChart(items, pages);
    expect(details).toMatchObject({ title: "Amazing Grace", key: "G" });
    expect(dropped).toEqual(["Amazing Grace"]);
    expect(chart).not.toContain("Amazing Grace\n");
  });

  it("keeps a line in the page's band that is the song", () => {
    const { chart } = readPdfChart([...verse(50, 30)], pages);
    expect(chart.split("\n")[0]).toBe("Verse 1");
  });

  it("reads two columns one after the other, a title across them first", () => {
    const right = verse(330, 140).map((item) => (item.text === "Verse 1" ? { ...item, text: "Chorus" } : item));
    const items = [piece("Amazing Grace", 200, 60, 1, 20), ...verse(50, 140), ...right];
    const { chart, details } = readPdfChart(items, pages);
    expect(details.title).toBe("Amazing Grace");
    expect(chart).toBe(["Verse 1", "Ama[G]zing grace", "[C]That saved", "", "Chorus", "Ama[G]zing grace", "[C]That saved"].join("\n"));
  });

  it("keeps a first line that isn't a title when nothing says it's a header", () => {
    const { chart, details } = readPdfChart([piece("Just a line", 50, 100), ...verse(50, 140)], pages);
    expect(details.title).toBeUndefined();
    expect(chart.split("\n")[0]).toBe("Just a line");
  });
});

describe("a scanned chart read by OCR (issue #124)", () => {
  // Words with a box per letter, 10 px a letter, on a line at `y`.
  const word = (text: string, x: number): OcrWord => ({
    text,
    x0: x,
    x1: x + text.length * 10,
    y0: 0,
    y1: 0,
    symbols: [...text].map((char, i) => ({ text: char, x0: x + i * 10, x1: x + i * 10 + 9, y0: 0, y1: 0 })),
  });
  const line = (y: number, height: number, ...words: OcrWord[]): OcrLine => ({
    x0: words[0]!.x0,
    x1: words[words.length - 1]!.x1,
    y0: y - height,
    y1: y,
    words: words.map((w) => ({ ...w, y0: y - height, y1: y })),
    baseline: { x0: 0, y0: y - 4, x1: 1000, y1: y - 4 },
  });

  it("in a fixed-width font, puts each chord on the letter under it", async () => {
    // Letters 10 px apart, evenly: Courier.
    const lines = [
      line(100, 18, word("G", 130), word("D", 210)),
      line(130, 24, word("Amazing", 100), word("grace", 180)),
      line(160, 24, word("that", 100), word("saved", 150), word("wretch", 210), word("like", 280)),
    ];
    const items = await readOcrPage(1, async () => lines);
    expect(readPdfChart(items).chart).toBe("Ama[G]zing gra[D]ce\nthat saved wretch like");
  });

  it("puts back a capital I OCR read as an l", async () => {
    const items = await readOcrPage(1, async () => [line(130, 24, word("l've", 100), word("been", 150))]);
    expect(readPdfChart(items).chart).toBe("I've been");
  });

  it("puts back the chords' signs OCR misreads", async () => {
    const lines = [line(100, 18, word("F♯m", 100), word("Brn", 160), word("DIF#", 230)), line(130, 24, word("Lord", 100), word("of", 160), word("all", 230))];
    const items = await readOcrPage(1, async () => lines);
    expect(readPdfChart(items).chart).toBe("[F#m]Lord [Bm]of [D/F#]all");
  });

  it("reads again, as chords only, a word of a line of chords that isn't one", async () => {
    const lines = [line(100, 18, word("C", 100), word("(03", 160), word("Em7", 230)), line(130, 24, word("That", 100), word("saved", 160), word("me", 230))];
    const asked: (OcrBox | undefined)[] = [];
    const items = await readOcrPage(1, async (strip) => {
      asked.push(strip);
      return strip ? [line(100, 18, word("G", strip.x0 + 5))] : lines;
    });
    expect(asked).toHaveLength(2);
    expect(readPdfChart(items).chart).toBe("[C]That [G]saved [Em7]me");
  });

  it("leaves a line of words alone", async () => {
    const lines = [line(130, 24, word("A", 100), word("cold", 120), word("day", 170))];
    const items = await readOcrPage(1, async () => lines);
    expect(readPdfChart(items).chart).toBe("A cold day");
  });
});
