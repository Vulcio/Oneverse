// Error reporting (issue #469): Admin > Error reporting's DSN, pointed at a
// stand-in for a Sentry or GlitchTip server, takes the API's test report and
// a web app's error nothing caught - scrubbed, with the page's path as a
// pattern - in the protocol's envelopes; with browsers' errors off, a page's
// error isn't sent; reverted, reporting is off.
import { createServer } from "node:http";
import { chromium } from "playwright";
import { WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

// The stand-in: every envelope it's sent, read.
const received = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const [header, item, event] = body.split("\n");
    try {
      received.push({ path: req.url, auth: req.headers["x-sentry-auth"], header: JSON.parse(header), item: JSON.parse(item), event: JSON.parse(event) });
    } catch {
      received.push({ path: req.url, broken: body });
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"id":"ok"}');
  });
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const dsn = `http://e2epublickey@127.0.0.1:${port}/42`;
const reportOf = async (match, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const found = received.find((one) => one.event && match(one.event));
    if (found) return found;
    await new Promise((done) => setTimeout(done, 200));
  }
  return null;
};

let page;
const step = stepper(() => page);
const admin = await user("Error reporting admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const someone = await user("Not an admin");

const browser = await chromium.launch();
try {
  let r = await call(someone, "PUT", "/admin/error-reporting", { dsn });
  check("only global admins set it", r.status === 403, String(r.status));
  r = await call(admin, "PUT", "/admin/error-reporting", { dsn: "https://no-key.example.org/1" });
  check("a DSN without its key is refused", r.status === 400, JSON.stringify(r.body));

  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, admin);

  await step("the page: off with no DSN; a DSN and browsers' errors saved here, then on", async () => {
    await page.goto(`${WEB}/admin/error-reporting`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: "Error reporting" }).waitFor();
    await page.locator('[data-testid="error-reporting-state"][data-on="false"]').waitFor();
    await page.getByTestId("error-reporting-dsn").fill(dsn);
    await page.getByTestId("error-reporting-environment").fill("e2e");
    await page.getByTestId("error-reporting-browsers").check();
    await page.getByTestId("error-reporting-save").click();
    await page.locator('[data-testid="error-reporting-state"][data-on="true"]').waitFor();
    const saved = await api(admin, "GET", "/admin/error-reporting");
    if (saved.source !== "database" || saved.settings.dsn.value !== dsn || !saved.settings.browsers.value || saved.settings.environment.value !== "e2e") throw new Error(JSON.stringify(saved));
  });

  await step("Send a test report: in the project, with the key, under the environment", async () => {
    await page.getByTestId("error-reporting-test").click();
    await page.getByText("Test report sent").waitFor();
    const report = await reportOf((event) => event.exception?.values?.[0]?.type === "TestReport");
    if (!report) throw new Error(JSON.stringify(received));
    check("to the project's envelope endpoint, with its key", report.path === "/api/42/envelope/" && /sentry_key=e2epublickey/.test(report.auth) && report.header.dsn === dsn && report.item.type === "event", JSON.stringify(report));
    check("filed under the environment, the API's, with the version", report.event.environment === "e2e" && report.event.tags.source === "api" && /^\d+\.\d+\.\d+/.test(report.event.release), JSON.stringify(report.event));
  });

  await step("a page's error nothing caught: reported, scrubbed, its path as a pattern", async () => {
    await page.goto(`${WEB}/sets/cmabcdefghijklmnop12345?token=secret-e2e`);
    await page.waitForLoadState("networkidle");
    // Its own words each run: the same error from the same place is sent once a minute.
    await page.evaluate((stamp) => setTimeout(() => { throw new TypeError(`Boom ${stamp} for ana@example.com`); }, 0), stamp);
    const report = await reportOf((event) => event.tags?.source === "web" && event.exception?.values?.[0]?.value?.startsWith(`Boom ${stamp}`));
    if (!report) throw new Error(JSON.stringify(received.map((one) => one.event?.exception)));
    const text = JSON.stringify(report.event);
    check("the error, without the email", report.event.exception.values[0].type === "TypeError" && report.event.exception.values[0].value === `Boom ${stamp} for [email]`, text);
    check("the page's path, without its id or query", report.event.transaction === "/sets/:id", text);
    check("nothing personal: no email, token, user or request", !/ana@|secret-e2e|"user"|"request"/.test(text), text);
  });

  await step("browsers' errors off: a page's error isn't sent", async () => {
    await api(admin, "PUT", "/admin/error-reporting", { browsers: false });
    const before = received.length;
    await page.evaluate((stamp) => setTimeout(() => { throw new TypeError(`Not sent ${stamp}`); }, 0), stamp);
    await page.waitForTimeout(2000);
    if (received.slice(before).some((one) => /Not sent/.test(JSON.stringify(one.event ?? "")))) throw new Error("sent");
  });

  await step("reverted to the environment: off again", async () => {
    await page.goto(`${WEB}/admin/error-reporting`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Revert to environment variables" }).click();
    await page.getByRole("button", { name: "Confirm revert" }).click();
    await page.locator('[data-testid="error-reporting-state"][data-on="false"]').waitFor();
  });
} finally {
  // Another suite mustn't report here.
  await call(admin, "DELETE", "/admin/error-reporting");
  await browser.close();
  server.close();
}
finish();
