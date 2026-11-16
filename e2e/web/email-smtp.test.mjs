// Email through an SMTP server (issue #38): Admin > Auth's "Send with" set to
// an SMTP server - a stand-in here, which takes what it's sent - sends the
// test email and account mail (a new account's verification) through it, with
// the user name and password saved; a password it refuses comes back as the
// test's error; the password is never sent back; reverted, mail is only logged
// again.
import { createServer } from "node:net";
import { chromium } from "playwright";
import { API, ORIGIN, WEB, api, call, check, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

// The stand-in: just enough SMTP for nodemailer, with AUTH PLAIN; "wrong" as the password is refused.
const received = [];
const server = createServer((socket) => {
  const mail = { auth: null, from: null, to: [], data: "" };
  let buffer = "";
  let inData = false;
  let awaitingAuth = false;
  const reply = (line) => socket.write(`${line}\r\n`);
  const authenticate = (encoded) => {
    const [, userName, password] = Buffer.from(encoded, "base64").toString("utf8").split("\0");
    mail.auth = { user: userName, password };
    reply(password === "wrong" ? "535 5.7.8 Authentication credentials invalid" : "235 2.7.0 Authentication successful");
  };
  reply("220 stand-in ESMTP");
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        mail.data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        received.push({ ...mail, to: [...mail.to] });
        mail.to = [];
        reply("250 2.0.0 queued");
        continue;
      }
      const end = buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const verb = line.split(" ")[0].toUpperCase();
      if (awaitingAuth) {
        awaitingAuth = false;
        authenticate(line);
      } else if (verb === "EHLO") reply("250-stand-in\r\n250-AUTH PLAIN\r\n250 8BITMIME");
      else if (verb === "HELO") reply("250 stand-in");
      else if (verb === "AUTH") {
        const [, , initial] = line.split(" ");
        if (initial) authenticate(initial);
        else {
          awaitingAuth = true;
          reply("334 ");
        }
      } else if (verb === "MAIL") {
        mail.from = line.slice(10).replace(/[<>]/g, "").split(" ")[0];
        reply("250 2.1.0 ok");
      } else if (verb === "RCPT") {
        mail.to.push(line.slice(8).replace(/[<>]/g, "").split(" ")[0]);
        reply("250 2.1.5 ok");
      } else if (verb === "DATA") {
        inData = true;
        reply("354 go ahead");
      } else if (verb === "QUIT") {
        reply("221 bye");
        socket.end();
      } else if (verb === "RSET" || verb === "NOOP") reply("250 ok");
      else reply("502 not here");
    }
  });
  socket.on("error", () => {});
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const mailTo = async (address, timeout = 10000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const found = received.find((one) => one.to.includes(address));
    if (found) return found;
    await new Promise((done) => setTimeout(done, 200));
  }
  return null;
};

let page;
const step = stepper(() => page);
const admin = await user("Email admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const someone = await user("Not an admin");

const browser = await chromium.launch();
try {
  let r = await call(someone, "POST", "/admin/auth/email/test", {});
  check("only global admins send a test email", r.status === 403, String(r.status));
  r = await call(admin, "PUT", "/admin/auth", { smtpPort: 70000 });
  check("a port out of range is refused", r.status === 400, JSON.stringify(r.body));

  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, admin);

  await step("Admin > Auth: an SMTP server saved, and the test email goes through it", async () => {
    await page.goto(`${WEB}/admin/auth`);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("email-provider").selectOption("smtp");
    await page.getByTestId("smtp-host").fill("127.0.0.1");
    await page.getByTestId("smtp-port").fill(String(port));
    await page.getByTestId("smtp-user").fill("e2e-sender");
    await page.getByTestId("smtp-password").fill(`secret-${stamp}`);
    await page.getByTestId("email-save").click();
    await page.getByTestId("email-source").getByText("saved in the database").waitFor();
    await page.getByTestId("email-test").click();
    await page.getByText(`Test email sent to ${admin.email}.`).waitFor();
    const mail = await mailTo(admin.email);
    if (!mail) throw new Error("the stand-in got no test email");
    if (!/Subject: Songverse test email/.test(mail.data)) throw new Error(`not the test email: ${mail.data.slice(0, 300)}`);
    if (mail.auth?.user !== "e2e-sender" || mail.auth?.password !== `secret-${stamp}`) throw new Error(`signed in as ${JSON.stringify(mail.auth)}`);
  });

  const summary = await api(admin, "GET", "/admin/auth");
  check(
    "the summary names the server, never its password",
    summary.emailProvider === "smtp" && summary.smtpHost === "127.0.0.1" && summary.smtpPort === port && summary.hasDatabaseSmtpPassword === true && summary.emailConfigured === true && !JSON.stringify(summary).includes(`secret-${stamp}`),
    JSON.stringify(summary),
  );

  // Account mail goes the same way: a new account's verification email.
  const newcomer = `e2e-email-smtp-newcomer-${stamp}@example.com`;
  await fetch(`${API}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email: newcomer, password: "hunter2pass", name: "Newcomer" }),
  });
  const verification = await mailTo(newcomer);
  check("a new account's verification email goes through the SMTP server", Boolean(verification && /verify-email/.test(verification.data.replace(/=\r\n/g, ""))), verification?.data.slice(0, 300) ?? "none");

  r = await call(admin, "PUT", "/admin/auth", { smtpPassword: "wrong" });
  r = await call(admin, "POST", "/admin/auth/email/test", {});
  check("a refused sign-in comes back as the test's error", r.status === 400 && /SMTP/.test(JSON.stringify(r.body)), JSON.stringify(r.body));

  await step("reverted to the environment variables: mail is only logged, and the card says so", async () => {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Revert to environment variables" }).first().click();
    await page.getByRole("button", { name: "Confirm revert" }).click();
    await page.getByTestId("email-not-sending").waitFor();
  });
  r = await call(admin, "POST", "/admin/auth/email/test", {});
  check("reverted, the test email is only logged", r.status === 200 && r.body.sent === false, JSON.stringify(r.body));
} finally {
  await call(admin, "DELETE", "/admin/auth/email").catch(() => {});
  await browser.close();
  server.close();
}
finish();
