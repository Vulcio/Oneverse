// The web app's Content-Security-Policy (issue #114): on every page, its
// inline scripts carrying the response's nonce, the offline shell's by
// their hashes - and nothing the app does itself refused: the song editor,
// Practice with its stems (their audio worklets and WebAssembly), Live,
// the metronome and a PDF (pdf.js's worker), with no violation reported.
import { chromium } from "playwright";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { API, WEB, api, finish, signIn, stamp, stepper, user, chooseView } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Csp");

/** A WAV of a quiet tone. */
function wav(seconds = 3, rate = 8000) {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / rate) * 3000), 44 + i * 2);
  return buffer;
}
const song = await api(me, "POST", "/song-versions", { title: `Policed ${stamp}`, language: "en", artists: ["Someone"], content: "[G]Safe and [C]sound\n", contentFormat: "CHORDPRO", key: "G", tempo: 90 });
const upload = async (type, name, bytes, mime, part) => {
  const form = new FormData();
  form.append("type", type);
  if (part) form.append("stemPart", part);
  form.append("file", new Blob([bytes], { type: mime }), name);
  await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
};
await upload("AUDIO", "Policed - Bass.wav", wav(), "audio/wav", "BASS");
await upload("AUDIO", "Policed - Keys.wav", wav(), "audio/wav", "KEYS");
const doc = await PDFDocument.create();
doc.addPage([595, 842]).drawText("Sheet", { x: 60, y: 760, size: 40, font: await doc.embedFont(StandardFonts.Helvetica) });
await upload("PDF", "Sheet.pdf", await doc.save(), "application/pdf");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
// Every refusal the policy makes, as the page sees it.
await page.addInitScript(() => {
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (event) => window.__violations.push(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}:${event.columnNumber} ${event.sample ?? ""}`));
});
const violations = () => page.evaluate(() => window.__violations ?? []);
await signIn(page, me);

await step("the header, enforced; the page's inline scripts carry its nonce", async () => {
  const response = await page.goto(`${WEB}/library/${song.id}`);
  const policy = response.headers()["content-security-policy"];
  if (!policy) throw new Error(`no policy: ${JSON.stringify(response.headers())}`);
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  if (!nonce || !/script-src 'self'/.test(policy) || !policy.includes("object-src 'none'")) throw new Error(policy);
  const html = await response.text();
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].map(([, attributes]) => attributes);
  if (!inline.length || inline.some((attributes) => !attributes.includes(`nonce="${nonce}"`))) throw new Error(`inline scripts without the nonce: ${inline.length}`);
  // Another page, another nonce.
  const again = (await (await fetch(`${WEB}/library/${song.id}`, { headers: { cookie: me.cookie } })).headers.get("content-security-policy")) ?? "";
  if (again.includes(nonce)) throw new Error("the same nonce twice");
});

await step("an injected inline script doesn't run", async () => {
  const ran = await page.evaluate(async () => {
    window.__injected = false;
    const script = document.createElement("script");
    script.textContent = "window.__injected = true";
    document.body.append(script);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return window.__injected;
  });
  if (ran) throw new Error("it ran");
  await page.evaluate(() => (window.__violations = []));
});

await step("the song editor, with nothing refused", async () => {
  await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
  await page.goto(`${WEB}/library/${song.id}`);
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.locator('[contenteditable="true"]').first().waitFor();
  await page.waitForLoadState("networkidle");
  const refused = await violations();
  if (refused.length) throw new Error(refused.join(" | "));
});

await step("Practice: the stems play (worklets, WebAssembly), transposed; the PDF (pdf.js's worker)", async () => {
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  const player = page.getByTestId("stem-player");
  // It opens minimised (issue #182).
  await player.getByRole("button", { name: "Expand the player" }).click();
  await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
  await player.getByRole("button", { name: "Up a semitone" }).click();
  await page.getByTestId("stem-play").click();
  await page.locator('[data-testid="stem-player"][data-state="playing"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
  if (await player.getByText("This browser can't transpose").count()) throw new Error("the stretch nodes refused");
  await page.getByTestId("stem-play").click();
  await chooseView(page, "pdf");
  await page.locator('[data-testid="pdf-view"][data-state="ready"]').waitFor({ timeout: 20000 });
  await chooseView(page, "chart");
  const refused = await violations();
  if (refused.length) throw new Error(refused.join(" | "));
});

await step("Live and the metronome", async () => {
  await page.goto(`${WEB}/library/${song.id}/live`);
  await page.getByTestId("live-view").waitFor();
  await page.goto(`${WEB}/metronome`);
  await page.getByRole("button", { name: /Start|Play/ }).first().click();
  await page.waitForTimeout(800);
  const refused = await violations();
  if (refused.length) throw new Error(refused.join(" | "));
});

await step("the offline shell: its inline scripts by their hashes", async () => {
  const response = await fetch(`${WEB}/_shell`);
  const policy = response.headers.get("content-security-policy") ?? "";
  const html = await response.text();
  if (!/'sha256-/.test(policy) || /'nonce-/.test(policy)) throw new Error(policy);
  const { createHash } = await import("node:crypto");
  for (const [, body] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!policy.includes(`'sha256-${createHash("sha256").update(body.replaceAll("\0", "\uFFFD")).digest("base64")}'`)) throw new Error(`an inline script without its hash: ${body.slice(0, 60)}`);
  }
});

await step("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
finish();
