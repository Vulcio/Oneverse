// How heavy the web app's pages are (issue #343): for each page people open
// most, signed in, opened cold in a new tab with the CPU slowed 4x (a
// mid-range phone): the JavaScript it loads (files and KB as sent), the
// time the main thread was blocked (long tasks past 50 ms), first paint,
// and API calls made twice. Run against a local stack after perf/bench.mjs
// seeded it (it writes the IDs this reads, perf/ids.json), not in CI.
//
//   node perf/pages.mjs                 # prints a table, writes perf/pages.json
//   IDS=/path/ids.json node perf/pages.mjs
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { WEB, signIn } from "../lib/harness.mjs";

const ids = JSON.parse(readFileSync(process.env.IDS ?? new URL("./ids.json", import.meta.url), "utf8"));
const API = process.env.API_URL ?? "http://localhost:3001";
const member = ids.members[0];
// A fresh API token from the member's session (the one saved goes stale).
const bearer = (await (await fetch(`${API}/api/auth/token`, { headers: { cookie: member.cookie, Origin: WEB } })).json()).token;
const who = { ...member, bearer };
const set = await (await fetch(`${API}/setlists/${ids.sets[0]}`, { headers: { Authorization: `Bearer ${bearer}` } })).json();
const pages = [
  ["Library", "/library"],
  ["Song", `/library/${ids.songs[1]}`],
  ["Sets", "/sets"],
  ["Set", `/sets/${ids.sets[0]}`],
  ["Set song", `/sets/${ids.sets[0]}/songs/${set.items[0].id}`],
  ["Songbook", `/songbooks/${ids.songbook}`],
  ["Calendar", "/calendar"],
];
const RUNS = Number(process.env.RUNS ?? 3);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const first = await context.newPage();
await signIn(first, who);
// Warm the server (and Vite's prerendered assets) once, so the first page isn't the server's first request.
for (const [, path] of pages) await first.goto(WEB + path, { waitUntil: "networkidle" });

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const [name, path] of pages) {
  const runs = [];
  for (let run = 0; run < RUNS; run++) {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.addInitScript(() => {
      window.__blocked = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__blocked += Math.max(0, entry.duration - 50);
      }).observe({ type: "longtask", buffered: true });
    });
    const requests = [];
    page.on("requestfinished", (request) => requests.push(request));
    await page.goto(WEB + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const timing = await page.evaluate(() => ({
      blocked: Math.round(window.__blocked),
      fcp: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0),
    }));
    // The JavaScript it loads: each file once, its size gzipped (as a server sends it).
    let js = 0;
    const scripts = new Set();
    for (const request of requests) {
      const url = request.url();
      if (!/\.m?js(\?|$)/.test(url) || scripts.has(url)) continue;
      scripts.add(url);
      const body = await (await request.response())?.body().catch(() => null);
      if (body) js += gzipSync(body).length;
    }
    const files = scripts.size;
    const api = requests.filter((request) => request.url().startsWith(API)).map((request) => `${request.method()} ${request.url().slice(API.length).replace(/\?.*/, "")}`);
    const twice = Object.entries(api.reduce((count, call) => ({ ...count, [call]: (count[call] ?? 0) + 1 }), {}))
      .filter(([, n]) => n > 1)
      .map(([call, n]) => `${call} x${n}`);
    runs.push({ files, jsKB: Math.round(js / 1024), ...timing, apiCalls: api.length, twice });
    await page.close();
  }
  const row = {
    name,
    files: median(runs.map((r) => r.files)),
    jsKB: median(runs.map((r) => r.jsKB)),
    blockedMs: median(runs.map((r) => r.blocked)),
    fcpMs: median(runs.map((r) => r.fcp)),
    apiCalls: median(runs.map((r) => r.apiCalls)),
    twice: runs[0].twice,
  };
  results.push(row);
  console.log(`${name.padEnd(10)} ${String(row.files).padStart(4)} files ${String(row.jsKB).padStart(5)} KB  blocked ${String(row.blockedMs).padStart(5)} ms  paint ${String(row.fcpMs).padStart(5)} ms  ${row.apiCalls} calls ${row.twice.join(", ")}`);
}
writeFileSync(new URL("./pages.json", import.meta.url), JSON.stringify(results, null, 1));
await browser.close();
