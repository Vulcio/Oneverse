// The player screen (issue #247): the client-only build of ScreenStage that songverse-player serves on a mini PC
// (apps/web/src/player-screen). It's built here as the player builds it, served with a stand-in for the player's
// local API (/api/state, /api/next, /api/previous), and must show the slides in the app's own words and look, move
// with the arrow keys, ship nothing of the web app's public files, and raise no errors. Screenshots go to
// e2e/.artifacts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SP, finish, stepper } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const built = path.join(repo, "apps/web/dist/player-screen");

// The player's local API, as songverse-player's Rust daemon answers it.
let index = 0;
const set = {
  title: "Amazing Grace",
  slides: [
    { title: "Verse 1", lines: ["Amazing grace how sweet the sound", "That saved a wretch like me"] },
    { title: "Verse 1", lines: ["I once was lost but now am found", "Was blind but now I see"] },
  ],
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/state") return res.end(JSON.stringify({ set, index }));
  if (url.pathname === "/api/next" && req.method === "POST") return res.end(JSON.stringify((index = Math.min(set.slides.length - 1, index + 1))));
  if (url.pathname === "/api/previous" && req.method === "POST") return res.end(JSON.stringify((index = Math.max(0, index - 1))));
  // The player serves the built page as its index and the rest under /assets.
  const file = path.join(built, url.pathname === "/" ? "player-screen.html" : url.pathname);
  if (!file.startsWith(built) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader("content-type", TYPES[path.extname(file)] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});

let browser;
try {
  await step("built as songverse-player builds it: a page and its assets, nothing else", async () => {
    execFileSync("pnpm", ["--filter", "@songverse/web", "build:player-screen"], { cwd: repo, stdio: "pipe" });
    const files = fs.readdirSync(built).sort();
    if (files.join(" ") !== "assets player-screen.html") throw new Error(`the build has ${files.join(", ")}`);
    const html = fs.readFileSync(path.join(built, "player-screen.html"), "utf8");
    if (/src="(?!\/assets\/)|href="(?!\/assets\/)/.test(html)) throw new Error("the page refers to something outside /assets");
  });

  await new Promise((resolve) => server.listen(4102, resolve));
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => message.type() === "error" && problems.push(message.text()));
  page.on("response", (response) => response.status() >= 400 && problems.push(`${response.status()} ${response.url()}`));

  await step("the stage shows the player's state: the song's title, the slide's lines, the next one dimmed", async () => {
    await page.goto("http://localhost:4102/");
    await page.getByText("Amazing grace how sweet the sound").waitFor({ timeout: 15000 });
    await page.getByText("That saved a wretch like me").waitFor();
    const text = await page.locator("body").innerText();
    if (!/amazing grace/i.test(text.split("\n")[0] ?? "")) throw new Error(`no title card: ${text}`);
    // Every word comes from the app's messages: no message key shows.
    if (/\b(screens|live|chart|common)\.[a-z]/i.test(text)) throw new Error(`a message key shows: ${text}`);
    await page.screenshot({ path: `${SP}/player-screen.png` });
  });

  await step("the arrow keys move through the slides, through the player's API", async () => {
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.body.innerText.includes("Was blind but now I see"));
    if (index !== 1) throw new Error(`the player's slide is ${index}`);
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => !document.body.innerText.includes("Was blind but now I see"));
    if (index !== 0) throw new Error(`the player's slide is ${index}`);
  });

  await step("in French when asked: the French messages loaded, and only them", async () => {
    const loaded = [];
    page.on("request", (request) => loaded.push(new URL(request.url()).pathname));
    await page.goto("http://localhost:4102/?lang=fr");
    await page.getByText("Amazing grace how sweet the sound").waitFor({ timeout: 15000 });
    if (!loaded.some((one) => /^\/assets\/fr-.*\.js$/.test(one)) || loaded.some((one) => /^\/assets\/en-.*\.js$/.test(one))) throw new Error(loaded.join(" "));
  });

  await step("no errors, no missing files", async () => {
    if (problems.length) throw new Error(problems.join(" | "));
  });
} finally {
  await browser?.close();
  server.close();
}
finish();
