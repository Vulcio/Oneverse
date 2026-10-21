// The web app's old address sends people on to its current one (#42): the
// production server (apps/web/server.mjs), started here with REDIRECT_HOSTS,
// redirects requests for an old host to the same path on WEB_URL.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, finish } from "../lib/harness.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web");
if (!existsSync(path.join(web, "dist/server/server.js"))) {
  console.log("SKIP the web app isn't built (pnpm --filter @oneverse/web build)");
  process.exit(0);
}

const PORT = 3299;
const server = spawn("node", ["server.mjs"], {
  cwd: web,
  env: { ...process.env, PORT: String(PORT), WEB_URL: "https://app.songverse.test", REDIRECT_HOSTS: "songverse.test, www.songverse.test" },
  stdio: "ignore",
});
const get = (host, pathname, method = "GET") =>
  new Promise((resolve, reject) => {
    const req = request({ host: "localhost", port: PORT, path: pathname, method, headers: { Host: host } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    });
    req.on("error", reject);
    req.end();
  });

try {
  for (let i = 0; ; i++) {
    try {
      await get("localhost", "/manifest.webmanifest");
      break;
    } catch (err) {
      if (i > 50) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  let r = await get("songverse.test", "/sets/abc?share=xyz");
  check("a link to the old host goes to the same page on the new one", r.status === 301 && r.location === "https://app.songverse.test/sets/abc?share=xyz", JSON.stringify(r));
  r = await get("WWW.songverse.test:443", "/reset-password?token=t");
  check("any listed host, whatever its case or port", r.status === 301 && r.location === "https://app.songverse.test/reset-password?token=t", JSON.stringify(r));
  r = await get("songverse.test", "/sets/abc", "POST");
  check("anything but a page load keeps its method (308)", r.status === 308, JSON.stringify(r));
  r = await get("localhost", "/manifest.webmanifest");
  check("the app's own host is served as usual", r.status === 200, JSON.stringify(r));
} finally {
  server.kill();
}
finish();
