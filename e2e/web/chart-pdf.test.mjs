// A song's PDF in place of its chart (issue #152): a Chart / PDF switch on
// the Practice page and on the song's page in a set, the pages drawn with
// pdf.js. How a player reads a song (issue #155): the choice kept for them
// on the server - so another device, and Live, show the same - else their
// default from their settings.
import { chromium } from "playwright";
import { PDFDocument, StandardFonts, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState, rgb } from "pdf-lib";
import { API, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Pdf reader");

const song = await api(me, "POST", "/song-versions", { title: `Sheet ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Hello [C]world\n", contentFormat: "CHORDPRO" });
const plain = await api(me, "POST", "/song-versions", { title: `No sheet ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Hello\n", contentFormat: "CHORDPRO" });

// A two-page PDF: black text on white, so the pages drawn aren't blank.
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (const n of [1, 2]) doc.addPage([595, 842]).drawText(`Sheet page ${n}`, { x: 60, y: 760, size: 48, font, color: rgb(0, 0, 0) });
const form = new FormData();
form.append("type", "PDF");
form.append("file", new Blob([await doc.save()], { type: "application/pdf" }), "Sheet.pdf");
await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
const set = await api(me, "POST", "/setlists", { name: `Sheets ${stamp}` });
const [item] = (await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id })).items;

const browser = await chromium.launch();
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await signIn(page, me);
await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));

/** How many of a canvas's pixels aren't white: something drawn on it. */
const inked = (canvas) => canvas.evaluate((el) => {
  const data = el.getContext("2d").getImageData(0, 0, el.width, el.height).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 16) if (data[i] < 128) dark++;
  return dark;
});

await step("a song without a PDF has no switch; its chart as ever", async () => {
  await page.goto(`${WEB}/library/${plain.id}`);
  await page.getByTestId("practice-song").locator('[data-chord="G"]').first().waitFor();
  if (await page.getByTestId("chart-view").count()) throw new Error("a switch without a PDF");
});

await step("with a PDF: Chart / PDF; the PDF's pages drawn, as wide as the page", async () => {
  await page.goto(`${WEB}/library/${song.id}`);
  const practice = page.getByTestId("practice-song");
  await practice.locator('[data-chord="G"]').first().waitFor();
  await practice.getByTestId("chart-view-pdf").click();
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  const pages = practice.getByTestId("pdf-page");
  if ((await pages.count()) !== 2) throw new Error(`${await pages.count()} pages`);
  if ((await inked(pages.first())) < 50) throw new Error("a blank page");
  const width = (await pages.first().boundingBox()).width;
  const room = (await practice.boundingBox()).width;
  if (width < room - 4) throw new Error(`${width}px of ${room}px`);
  if (await practice.locator('[data-chord="G"]').count()) throw new Error("the chart still shown");
});

await step("remembered for the song; back to the chart", async () => {
  await page.reload();
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  await page.getByTestId("chart-view-chart").click();
  await page.getByTestId("practice-song").locator('[data-chord="G"]').first().waitFor();
});

await step("on its page in a set too", async () => {
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.getByTestId("chart-view-pdf").click();
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  if ((await page.getByTestId("pdf-page").count()) !== 2) throw new Error("not its pages");
  await page.getByTestId("chart-view-chart").click();
});

await step("the set song's choice follows the player to another device, and into Live (issue #155)", async () => {
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.getByTestId("chart-view-pdf").click();
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const tablet = await other.newPage();
  await signIn(tablet, me);
  await tablet.evaluate(() => localStorage.setItem("songverse.mode", "live"));
  await tablet.goto(`${WEB}/sets/${set.id}/live/${item.id}`);
  await tablet.getByTestId("live-view").waitFor();
  await tablet.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  if ((await tablet.getByTestId("pdf-page").count()) !== 2) throw new Error("not the PDF in Live");
  if (await tablet.getByTestId("live-structure").count()) throw new Error("the structure bar over a PDF");
  // Switched back in Live: the chart, there and in Practice.
  await tablet.getByTestId("chart-view-chart").click();
  await tablet.locator('[data-chord="G"]').first().waitFor();
  await other.close();
  await page.reload();
  await page.locator('[data-chord="G"]').first().waitFor();
  if (await page.getByTestId("pdf-view").count()) throw new Error("Practice still shows the PDF");
});

await step("the player's default (their settings): PDF for a song they haven't chosen for", async () => {
  // A song never opened: nothing chosen for it.
  const fresh = await api(me, "POST", "/song-versions", { title: `Fresh sheet ${stamp}`, language: "en", artists: ["Someone"], content: "[D]Hi\n", contentFormat: "CHORDPRO" });
  const f = new FormData();
  f.append("type", "PDF");
  f.append("file", new Blob([await doc.save()], { type: "application/pdf" }), "Fresh.pdf");
  await fetch(`${API}/song-versions/${fresh.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: f });
  await page.goto(`${WEB}/dashboard`);
  await page.getByLabel("Songs read as").selectOption("PDF");
  for (let i = 0; i < 50 && (await api(me, "GET", "/users/me")).liveView !== "PDF"; i++) await page.waitForTimeout(100);
  await page.goto(`${WEB}/library/${fresh.id}`);
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  // A song without a PDF: its chart all the same.
  await page.goto(`${WEB}/library/${plain.id}`);
  await page.getByTestId("practice-song").locator('[data-chord="G"]').first().waitFor();
  await api(me, "PATCH", "/users/me", { liveView: "CHART" });
});

await step("on a phone, the PDF's pages go edge to edge, in Practice and in Live", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/sets/${set.id}/songs/${item.id}`);
  await page.getByTestId("chart-view-pdf").click();
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  const edges = async () => {
    const box = await page.getByTestId("pdf-page").first().boundingBox();
    return { left: box.x, right: 390 - (box.x + box.width) };
  };
  let at = await edges();
  if (Math.abs(at.left) > 1 || Math.abs(at.right) > 1) throw new Error(`Practice: ${JSON.stringify(at)}`);
  await page.goto(`${WEB}/sets/${set.id}/live/${item.id}`);
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  at = await edges();
  if (Math.abs(at.left) > 1 || Math.abs(at.right) > 1) throw new Error(`Live: ${JSON.stringify(at)}`);
  // Nothing above it but the header: the song's title is the PDF's own.
  if (await page.getByTestId("live-song-top").isVisible()) throw new Error("the song's title over its PDF");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(`${overflow}px sideways scroll`);
  await page.getByTestId("chart-view-chart").click();
  await page.setViewportSize({ width: 1280, height: 900 });
});

await step("a long PDF streams (issue #156): fetched by byte ranges, its first page shown before the rest is drawn", async () => {
  // Twenty pages, each with a block of text that doesn't compress: large enough for pdf.js to read it by ranges.
  const long = await PDFDocument.create();
  const mono = await long.embedFont(StandardFonts.Courier);
  let seed = 7;
  const noise = () => Array.from({ length: 90 }, () => String.fromCharCode(33 + ((seed = (seed * 16807) % 2147483647) % 90))).join("");
  for (let n = 1; n <= 20; n++) {
    const sheet = long.addPage([595, 842]);
    sheet.drawText(`Long page ${n}`, { x: 60, y: 780, size: 36, font: mono, color: rgb(0, 0, 0) });
    for (let line = 0; line < 230; line++) sheet.drawText(noise(), { x: 20, y: 740 - line * 3.5, size: 3, font: mono, color: rgb(0.3, 0.3, 0.3) });
  }
  const bytes = await long.save({ useObjectStreams: false });
  if (bytes.length < 500 * 1024) throw new Error(`only ${bytes.length} bytes`);
  const book = await api(me, "POST", "/song-versions", { title: `Long score ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Long\n", contentFormat: "CHORDPRO" });
  const form = new FormData();
  form.append("type", "PDF");
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "Long.pdf");
  await fetch(`${API}/song-versions/${book.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
  const ranges = [];
  page.on("response", (response) => {
    if (response.url().includes("/files/")) ranges.push({ status: response.status(), range: response.request().headers().range ?? null });
  });
  await page.goto(`${WEB}/library/${book.id}`);
  await page.getByTestId("chart-view-pdf").click();
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  const pages = page.getByTestId("pdf-page");
  if ((await pages.count()) !== 20) throw new Error(`${await pages.count()} places for 20 pages`);
  if ((await pages.first().getAttribute("data-state")) !== "drawn") throw new Error("the first page not drawn");
  const drawn = await page.locator('[data-testid="pdf-page"][data-state="drawn"]').count();
  if (drawn > 6) throw new Error(`${drawn} pages drawn before they're near`);
  // pdf.js asks for ranges unless the whole file came first (a fast machine, CI): either way, its address answers one.
  if (!ranges.some((r) => r.status === 206 && r.range)) {
    const url = (await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name))).find((name) => name.includes("/files/"));
    if (!url) throw new Error(`the PDF wasn't fetched: ${JSON.stringify(ranges)}`);
    const part = await page.evaluate(async (address) => {
      const response = await fetch(address, { headers: { Range: "bytes=0-1023" } });
      return { status: response.status, length: (await response.arrayBuffer()).byteLength };
    }, url);
    if (part.status !== 206 || part.length !== 1024) throw new Error(`no byte ranges: ${JSON.stringify({ ranges, part })}`);
  }
  // Scrolled to the end, the last page is drawn when it's reached.
  await pages.last().scrollIntoViewIfNeeded();
  await page.locator('[data-testid="pdf-page"][data-page="20"][data-state="drawn"]').waitFor({ timeout: 20000 });
  await api(me, "PUT", "/chart-preferences", { songVersionId: book.id, preferences: { view: "CHART" } });
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await step("a scanned page (CCITT fax, as sheet music is often scanned) draws its image, not just its text", async () => {
  // pdf.js decodes these with WebAssembly it fetches from /assets/pdfjs-<version>/; without it, only text was drawn.
  const scan = await PDFDocument.create();
  const sheet = scan.addPage([595, 842]);
  // 64 rows of a white G4 line (one bit each: "the same as the line above"), painted black through Decode [1 0].
  const ref = scan.context.register(
    scan.context.stream(new Uint8Array(8).fill(0xff), {
      Type: "XObject",
      Subtype: "Image",
      Width: 64,
      Height: 64,
      ImageMask: true,
      BitsPerComponent: 1,
      Filter: "CCITTFaxDecode",
      DecodeParms: { K: -1, Columns: 64, Rows: 64 },
      Decode: [1, 0],
    }),
  );
  sheet.pushOperators(pushGraphicsState(), concatTransformationMatrix(400, 0, 0, 400, 100, 300), drawObject(sheet.node.newXObject("Scan", ref)), popGraphicsState());
  const scanned = await api(me, "POST", "/song-versions", { title: `Scanned ${stamp}`, language: "en", artists: ["Someone"] });
  const upload = new FormData();
  upload.append("type", "PDF");
  upload.append("file", new Blob([await scan.save()], { type: "application/pdf" }), "Scan.pdf");
  await fetch(`${API}/song-versions/${scanned.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: upload });
  await page.goto(`${WEB}/library/${scanned.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("chart-view-pdf").click();
  const drawn = page.getByTestId("pdf-page").first();
  await drawn.waitFor();
  let ink = 0;
  for (let i = 0; i < 40 && ink < 1000; i++) {
    await page.waitForTimeout(250);
    ink = await inked(drawn);
  }
  if (ink < 1000) throw new Error(`the scan wasn't drawn (${ink} dark samples)`);
});

await browser.close();
finish();
