// A songbook's bulk upload from the page (issues #201, #202): more files
// than one request takes go in batches, the button saying how far it's got,
// and every file is queued; a conflict names the other file. The API says
// "At most 200 files at once" rather than multer's "Unexpected file field".
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { API, SP, WEB, api, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Bulk uploader");
const COUNT = 120;
const songbook = await api(me, "POST", "/songbooks", { name: `Bulk book ${stamp}`, kind: "NUMBERED", abbreviation: "BB" });
for (let start = 1; start <= COUNT; start += 20) {
  await Promise.all(
    Array.from({ length: Math.min(20, COUNT - start + 1) }, async (_, i) => {
      const number = start + i;
      const song = await api(me, "POST", "/song-versions", { title: `Bulk ${number} ${stamp}`, language: "en", artists: ["Band"] });
      await api(me, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: song.id, entryCode: String(number) });
    }),
  );
}

// More than the API takes in one request: refused, said plainly.
const tooMany = new FormData();
tooMany.append("type", "CHORDPRO");
for (let i = 0; i < 201; i++) tooMany.append("files", new Blob(["{title: x}\n"], { type: "text/plain" }), `${i + 1}.cho`);
const refused = await fetch(`${API}/songbooks/${songbook.id}/bulk-upload`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: tooMany });
const refusal = await refused.json();
check("201 files in one request: refused, saying how many it takes", refused.status === 400 && /At most 200 files at once/.test(JSON.stringify(refusal)), JSON.stringify(refusal));

const dir = path.join(SP, `bulk-${stamp}`);
mkdirSync(dir, { recursive: true });
const files = Array.from({ length: COUNT }, (_, i) => {
  const file = path.join(dir, `bb${String(i + 1).padStart(3, "0")}.chordpro`);
  writeFileSync(file, `{title: Bulk ${i + 1} ${stamp}}\n{start_of_verse}\n[G]Line ${i + 1}\n{end_of_verse}\n`);
  return file;
});

const browser = await chromium.launch();
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, me);

  await step("a conflict names the other file", async () => {
    await page.goto(`${WEB}/songbooks/${songbook.id}`);
    await page.waitForLoadState("networkidle");
    const copy = path.join(dir, "bb001 copy.chordpro");
    writeFileSync(copy, "{title: copy}\n");
    await page.setInputFiles("#bulk-upload-files", [files[0], copy]);
    await page.getByTestId("bulk-upload-conflicts-with").first().getByText("Same number as bb001 copy.chordpro").waitFor();
  });

  await step("a whole folder (issue #40): its files and its folders' files, other kinds left out", async () => {
    const folder = path.join(SP, `bulk-folder-${stamp}`);
    mkdirSync(path.join(folder, "more"), { recursive: true });
    writeFileSync(path.join(folder, "bb002.chordpro"), "{title: two}\n");
    writeFileSync(path.join(folder, "more", "bb003.chordpro"), "{title: three}\n");
    writeFileSync(path.join(folder, "notes.pdf"), "%PDF-1.4\n");
    await page.setInputFiles("#bulk-upload-folder", folder);
    await page.locator('[data-testid="bulk-upload-row"][data-status="MATCHED"]').nth(1).waitFor();
    const matched = await page.locator('[data-testid="bulk-upload-row"][data-status="MATCHED"]').count();
    const rows = await page.locator('[data-testid="bulk-upload-row"]').allInnerTexts();
    if (matched !== 2 || !rows.some((row) => row.includes("notes.pdf") && row.includes("left out"))) throw new Error(rows.join(" | "));
  });

  await step(`${COUNT} files: sent in batches, every one queued`, async () => {
    await page.setInputFiles("#bulk-upload-files", files);
    await page.locator('[data-testid="bulk-upload-row"][data-status="MATCHED"]').nth(COUNT - 1).waitFor();
    await page.getByRole("button", { name: "Confirm upload" }).click();
    await page.getByText(`${COUNT} file(s) queued for processing.`).waitFor({ timeout: 60000 });
  });
} finally {
  await browser.close();
}
finish();
