// A chart read from a PDF's text (issue #124): dropped on a new song, its
// words and chords fill the text box, each chord on the syllable printed
// under it. A scanned PDF or a photo is read by OCR on the device - or by
// the server when the device can't - its header taken as the song's
// details and its footer left out; a page with nothing to read says so.
// The PDFs are made here with pdf-lib, so where each chord sits is known exactly.
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";
import { SCANNED_CHART, scannedChartPdf, scannedChartPng } from "../lib/chart-scans.mjs";

let page;
const step = stepper(() => page);
const me = await user("Pdf importer");
let savedId;

/** A chord chart as a typeset PDF: each chord set over the start of its syllable, in Helvetica. */
async function chartPdf(fontName = StandardFonts.Helvetica) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(fontName);
  const pdfPage = pdf.addPage([595, 842]);
  const size = 12;
  let y = 780;
  const line = (text, x = 60) => pdfPage.drawText(text, { x, y, size, font });
  const chordsOver = (lyric, chords) => {
    for (const [chord, syllable] of chords) line(chord, 60 + font.widthOfTextAtSize(lyric.slice(0, syllable), size));
    y -= 16;
    line(lyric);
    y -= 16;
  };
  line("Verse 1");
  y -= 16;
  chordsOver("Amazing grace how sweet the sound", [["G", 3], ["D", "Amazing grace ".length], ["G/B", "Amazing grace how sweet the ".length]]);
  chordsOver("That saved a wretch like me", [["C", 0], ["G", "That saved a ".length]]);
  y -= 16;
  line("Chorus");
  y -= 16;
  chordsOver("My chains are gone", [["Em7", 3], ["Cadd9", "My chains are ".length]]);
  return Buffer.from(await pdf.save());
}

/** A page with no text, and a picture of none: a dark box. */
async function scannedPdf() {
  const pdf = await PDFDocument.create();
  const pdfPage = pdf.addPage([595, 842]);
  pdfPage.drawRectangle({ x: 60, y: 700, width: 300, height: 40, color: rgb(0.2, 0.2, 0.2) });
  return Buffer.from(await pdf.save());
}

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);

await step("a PDF with text: its words and chords fill the text box, each chord on its syllable", async () => {
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("source-file-input").setInputFiles({ name: "amazing-grace.pdf", mimeType: "application/pdf", buffer: await chartPdf() });
  await page.locator('[data-testid="pdf-state"][data-state="read"]').waitFor();
  const text = await page.locator("#song-content").inputValue();
  const expected = ["Verse 1", "Ama[G]zing grace [D]how sweet the [G/B]sound", "[C]That saved a [G]wretch like me", "", "Chorus", "My [Em7]chains are [Cadd9]gone"].join("\n");
  if (text !== expected) throw new Error(`got:\n${text}`);
  await page.getByText("check the chords landed on the right syllables").waitFor();
  await page.getByText(/Detected: ChordPro/).waitFor();
});

await step("saved, the song has those chords where they were printed, and keeps the PDF", async () => {
  await page.fill("#song-title", `From a PDF ${stamp}`);
  await page.click("#song-artists");
  await page.keyboard.type("John Newton;");
  await page.getByRole("button", { name: "Save song" }).click();
  await page.waitForURL(/\/library\/(?!new)[a-z0-9]+/);
  const id = page.url().split("/library/")[1].split("?")[0];
  savedId = id;
  const song = await api(me, "GET", `/song-versions/${id}`);
  const [verse, chorus] = song.documentJson.sections;
  const first = verse.lines[0];
  const chordsAt = (line) => line.chords.map((chord) => `${chord.raw}@${chord.at}`).join(" ");
  if (verse.type !== "verse" || chorus.type !== "chorus" || first.text !== "Amazing grace how sweet the sound" || chordsAt(first) !== "G@3 D@14 G/B@28" || chordsAt(chorus.lines[0]) !== "Em7@3 Cadd9@14") {
    throw new Error(JSON.stringify(song.documentJson.sections));
  }
  const files = await api(me, "GET", `/song-versions/${id}/attachments`);
  if (files.length !== 1 || files[0].type !== "PDF") throw new Error(JSON.stringify(files));
});

await step("a PDF already under the song's Files is read again from the Editor, without being uploaded again", async () => {
  await page.goto(`${WEB}/library/${savedId}`);
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.getByTestId("editor-replace").click();
  const dialog = page.getByTestId("replace-chart");
  await dialog.getByTestId("replace-chart-song-files").getByRole("button", { name: "amazing-grace.pdf" }).click();
  await dialog.locator('[data-testid="pdf-state"][data-state="read"]').waitFor();
  const text = await dialog.locator("#song-content").inputValue();
  if (!text.includes("Ama[G]zing grace [D]how sweet the [G/B]sound")) throw new Error(`got:\n${text}`);
  await page.getByTestId("replace-chart-confirm").click();
  await page.getByTestId("structured-editor").getByText(/wretch like me/).waitFor();
  const files = await api(me, "GET", `/song-versions/${savedId}/attachments`);
  if (files.length !== 1) throw new Error(JSON.stringify(files));
});

await step("in other fonts too (Times, Courier): the chords land on the same syllables", async () => {
  for (const font of [StandardFonts.TimesRoman, StandardFonts.Courier]) {
    await page.goto(`${WEB}/library/new`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("source-file-input").setInputFiles({ name: "grace.pdf", mimeType: "application/pdf", buffer: await chartPdf(font) });
    await page.locator('[data-testid="pdf-state"][data-state="read"]').waitFor();
    const text = await page.locator("#song-content").inputValue();
    if (!text.includes("Ama[G]zing grace [D]how sweet the [G/B]sound") || !text.includes("My [Em7]chains are [Cadd9]gone")) throw new Error(`${font}:\n${text}`);
  }
});

const scanPng = await scannedChartPng();

/** Drops `file` on a new song and waits for it to be read; the text box's chart. */
async function dropAndRead(file) {
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("source-file-input").setInputFiles(file);
  await page.locator('[data-testid="pdf-state"][data-state="read"]').waitFor({ timeout: 120000 });
  return page.locator("#song-content").inputValue();
}

await step("a scanned PDF is read by OCR on the device: chords on their syllables, its header as the song's details, its footer left out", async () => {
  const text = await dropAndRead({ name: "scan.pdf", mimeType: "application/pdf", buffer: await scannedChartPdf(scanPng) });
  if (text !== SCANNED_CHART) throw new Error(`got:\n${text}`);
  const state = page.getByTestId("pdf-state");
  if ((await state.getAttribute("data-ocr")) !== "true" || (await state.getAttribute("data-server")) !== null) throw new Error("not read by OCR on the device");
  await page.getByText("check the words and that the chords landed on the right syllables").waitFor();
  await page.getByText("Its header and footer were left out (1 line).").waitFor();
  if ((await page.locator("#song-title").inputValue()) !== "Amazing Grace (My Chains Are Gone)") throw new Error(`title: ${await page.locator("#song-title").inputValue()}`);
  await page.getByTestId("file-details-filled").waitFor();
});

await step("a photo of a chart is read the same way, and can be kept under Files", async () => {
  const text = await dropAndRead({ name: "chart.png", mimeType: "image/png", buffer: scanPng });
  if (text !== SCANNED_CHART) throw new Error(`got:\n${text}`);
  await page.getByText("Also keep this file under Files").waitFor();
});

await step("when the device can't read it (OCR doesn't start), the server does", async () => {
  // A page where Tesseract's Web Worker can't start (an old browser, too little memory); the service worker would serve its files from its cache.
  const devicePage = page;
  const context = await browser.newContext({ storageState: await devicePage.context().storageState(), viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = function (url, options) {
      if (String(url).includes("tesseract")) throw new Error("No Web Worker here");
      return new Native(url, options);
    };
  });
  try {
    const text = await dropAndRead({ name: "scan.pdf", mimeType: "application/pdf", buffer: await scannedChartPdf(scanPng) });
    if (text !== SCANNED_CHART) throw new Error(`got:\n${text}`);
    if ((await page.getByTestId("pdf-state").getAttribute("data-server")) !== "true") throw new Error("not read by the server");
  } finally {
    await context.close();
    page = devicePage;
  }
});

await step("a page with nothing to read is kept, and says to paste the words", async () => {
  await page.goto(`${WEB}/library/new`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("source-file-input").setInputFiles({ name: "blank.pdf", mimeType: "application/pdf", buffer: await scannedPdf() });
  await page.locator('[data-testid="pdf-state"][data-state="noText"]').waitFor({ timeout: 120000 });
  await page.getByText("No words could be read in this file: paste them below.").waitFor();
  if ((await page.locator("#song-content").inputValue()) !== "") throw new Error("the text box was filled");
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join("\n"));
});

await browser.close();
finish();
