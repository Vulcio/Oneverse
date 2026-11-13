// Charts as a scanner or a phone would give them (issue #124), for the
// suites that read them by OCR: a chord chart drawn by the browser, each
// chord set over its syllable, with a title, names, details and a licence
// footer; as a picture, slightly turned and blurred like a scan, and as a
// PDF that is only that picture (no text).
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";

/** The chart: `[G]` marks where each chord is printed. */
export const SCANNED_SONG = ["Verse 1", "Ama[G]zing grace [D]how sweet the [G/B]sound", "[C]That saved a [G]wretch like [Em7]me", "", "Chorus", "My [F#m7]chains are [Bb]gone, I've [Cadd9]been set [D/F#]free"];

const html = `<html><body style="margin:0;padding:50px;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:19px;transform:rotate(-0.6deg);filter:blur(0.5px) contrast(0.8)">
<div style="font-size:30px;font-weight:bold">Amazing Grace (My Chains Are Gone)</div>
<div>Chris Tomlin | John Newton</div>
<div>Key - G | Tempo - 64 | Time - 3/4</div><br>
<div id="chart"></div>
<div style="position:absolute;bottom:40px;font-size:12px">CCLI Song # 4768151 | © 2006 sixsteps Music | For use solely with the SongSelect Terms of Use.</div>
<script>
for (const line of ${JSON.stringify(SCANNED_SONG)}) {
  const row = document.createElement("div");
  row.style.cssText = "position:relative;white-space:pre;" + (line.includes("[") ? "padding-top:1.25em" : "");
  if (!line) row.innerHTML = "&nbsp;";
  const parts = line.split(/\\[([^\\]]+)\\]/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) row.append(parts[i]);
    else { const mark = document.createElement("span"); mark.dataset.chord = parts[i]; row.append(mark); }
  }
  document.getElementById("chart").append(row);
  for (const mark of row.querySelectorAll("[data-chord]")) {
    const chord = document.createElement("b");
    chord.textContent = mark.dataset.chord;
    chord.style.cssText = "position:absolute;top:0;left:" + mark.offsetLeft + "px";
    row.append(chord);
  }
}
</script></body></html>`;

/** The scan as a PNG, about 200 dpi. */
export async function scannedChartPng() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 850, height: 1100 }, deviceScaleFactor: 2 });
    await page.setContent(html);
    return await page.screenshot();
  } finally {
    await browser.close();
  }
}

/** The scan as a PDF with no text: the picture on a letter-sized page. */
export async function scannedChartPdf(png) {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png ?? (await scannedChartPng()));
  pdf.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  return Buffer.from(await pdf.save());
}

/** The chart as ChordPro, as reading the scan should give it. */
export const SCANNED_CHART = SCANNED_SONG.join("\n");
