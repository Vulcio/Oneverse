// Sign-up by invitation only (issue #198): switched on in Admin > Users, it
// refuses a new account unless its email was invited, or it comes through
// a pass - an invitation's link, a team's invite link, a set's share link -
// which the API keeps in a cookie for the account made next. Existing
// accounts sign in as before. Switched back off at the end, so the other
// suites can sign their users up.
import { chromium } from "playwright";
import { API, ORIGIN, WEB, api, call, check, finish, logOffset, signIn, sql, stamp, stepper, user, waitForLog } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Invite admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const owner = await user("Invite owner");

const email = (name) => `e2e-invite-only-${name}-${stamp}@example.com`;
/** A sign-up by email, with the cookies given (a pass); its status and error code. */
async function signUp(address, cookie = "") {
  const res = await fetch(`${API}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie && { cookie }) },
    body: JSON.stringify({ email: address, password: "hunter2pass", name: "Invited" }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: body.code };
}
/** The pass the API keeps for a link: the cookie it sets. */
async function pass(kind, token) {
  const res = await fetch(`${API}/auth/invite-pass`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ kind, token }) });
  return { status: res.status, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), raw: res.headers.getSetCookie().join("\n") };
}
const exists = (address) => sql(`select count(*) from "User" where email='${address}'`) === "1";

let browser;
try {
  let r = await call(owner, "GET", "/admin/invitations");
  check("only global admins see the invitations", r.status === 403, String(r.status));
  r = await call(admin, "PUT", "/admin/security", { signupInviteOnly: true });
  check("switched on", r.status === 204, String(r.status));
  const config = await (await fetch(`${API}/auth/public-config`)).json();
  check("the sign-in page is told", config.signupInviteOnly === true, JSON.stringify(config));

  r = await signUp(email("stranger"));
  check("someone not invited can't sign up", r.status === 422 && r.code === "SIGNUP_INVITE_ONLY" && !exists(email("stranger")), JSON.stringify(r));

  // Invited by email: the link is sent, its page says who it's for, and that email can sign up.
  let offset = logOffset();
  r = await call(admin, "POST", "/admin/invitations", { email: email("Invited").toUpperCase() });
  const invitation = r.body;
  check("an admin invites an email (kept in lower case)", r.status === 201 && invitation.email === email("invited") && /\/invite\/[\w-]+$/.test(invitation.link), JSON.stringify(r.body));
  const [sent] = await waitForLog(offset, new RegExp(`${WEB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/invite/[\\w-]+`));
  check("and the link is emailed", sent === invitation.link, sent);
  const invitationToken = invitation.link.split("/").pop();
  r = await (await fetch(`${API}/auth/invitations/${invitationToken}`)).json();
  check("its page knows the email", r.email === email("invited") && r.status === "pending", JSON.stringify(r));
  r = await call(admin, "POST", "/admin/invitations", { email: owner.email });
  check("not someone who already has an account", r.status === 409, String(r.status));
  r = await signUp(email("invited"));
  check("the invited email signs up", r.status === 200 && exists(email("invited")), JSON.stringify(r));
  r = (await call(admin, "GET", "/admin/invitations")).body.find((one) => one.email === email("invited"));
  check("its invitation is then used", !!r?.acceptedAt, JSON.stringify(r));
  r = await (await fetch(`${API}/auth/invitations/${invitationToken}`)).json();
  check("and its page says so", r.status === "accepted", JSON.stringify(r));

  // A team's invite link, a set's share link: a pass for the account made next.
  const team = await api(owner, "POST", "/teams", { name: `Invite team ${stamp}` });
  const teamLink = await api(owner, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" });
  let kept = await pass("team", teamLink.token);
  check("a team's invite link is kept in a cookie for sign-up", kept.status === 204 && /HttpOnly/i.test(kept.raw) && /Path=\/api\/auth/i.test(kept.raw), kept.raw);
  r = await signUp(email("teammate"), kept.cookie);
  check("so whoever opened it signs up", r.status === 200 && exists(email("teammate")), JSON.stringify(r));
  const set = await api(owner, "POST", "/setlists", { name: `Invite set ${stamp}` });
  const setLink = (await api(owner, "POST", `/setlists/${set.id}/share-link`)).link;
  kept = await pass("set", setLink.token);
  r = await signUp(email("guest"), kept.cookie);
  check("a set's share link too", kept.status === 204 && r.status === 200 && exists(email("guest")), JSON.stringify(r));
  kept = await pass("team", "not-a-real-token");
  check("a link that doesn't work isn't kept", kept.status === 404 && !kept.cookie, String(kept.status));
  r = await signUp(email("forger"), "songverse_signup_pass=team:not-a-real-token");
  check("nor let in by a made-up cookie", r.status === 422 && !exists(email("forger")), JSON.stringify(r));

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await step("signed out: the sign-up tab says it's by invitation", async () => {
    await page.goto(WEB);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Sign up" }).click();
    await page.getByTestId("signup-invite-only").waitFor();
    if (await page.locator("#signup-email").count()) throw new Error("the sign-up form is shown");
  });

  await step("an invitation's page: the email filled in, the account created", async () => {
    offset = logOffset();
    const created = await api(admin, "POST", "/admin/invitations", { email: email("browser") });
    await page.goto(created.link);
    // At Oneverse (issue #303), the invitation kept for the account.
    await page.getByTestId("sign-in-prompt").waitFor();
    if ((await page.inputValue("#signup-email")) !== email("browser")) throw new Error(await page.inputValue("#signup-email"));
    await page.fill("#signup-name", "Browser invitee");
    await page.fill("#signup-password", "hunter2pass");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("Check your email").waitFor();
    if (!exists(email("browser"))) throw new Error("no account");
  });

  await step("a team's invite link, signed out: the sign-up form is there, and works", async () => {
    await page.context().clearCookies();
    await page.goto(`${WEB}/join/${teamLink.token}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Sign up" }).click();
    await page.locator("#signup-email").waitFor();
    await page.fill("#signup-name", "Link joiner");
    await page.fill("#signup-email", email("joiner"));
    await page.fill("#signup-password", "hunter2pass");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByText("Check your email").waitFor();
    if (!exists(email("joiner"))) throw new Error("no account");
  });

  await step("an invitation already used says so", async () => {
    await page.goto(`${WEB}/invite/${invitationToken}`);
    await page.getByTestId("invite-unavailable").getByText("already been used").waitFor();
  });

  await step("Admin > Users: the switch on, an invitation made, the list", async () => {
    await page.context().clearCookies();
    await signIn(page, admin);
    await page.goto(`${WEB}/admin/users`);
    const card = page.getByTestId("invitations-card");
    if (!(await card.getByTestId("signup-invite-only-toggle").isChecked())) throw new Error("the switch is off");
    await card.locator("#invite-email").fill(email("from-admin"));
    await card.getByRole("button", { name: "Invite", exact: true }).click();
    await card.getByTestId("invite-created").waitFor();
    if (!/\/invite\/[\w-]+/.test(await card.getByTestId("invite-link").textContent())) throw new Error("no link");
    await card.getByTestId(`invitation-${email("from-admin")}`).waitFor();
    if ((await card.getByTestId(`invitation-${email("invited")}`).getAttribute("data-status")) !== "accepted") throw new Error("not shown as signed up");
    await card.getByTestId(`invitation-${email("from-admin")}`).getByRole("button", { name: "Remove" }).click();
    await card.getByRole("button", { name: "Remove the invitation" }).click();
    await card.getByTestId(`invitation-${email("from-admin")}`).waitFor({ state: "detached" });
  });

  await step("switched off from there: anyone can sign up again", async () => {
    const card = page.getByTestId("invitations-card");
    await card.getByTestId("signup-invite-only-toggle").click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="signup-invite-only-toggle"]')?.checked);
    const res = await signUp(email("open"));
    if (res.status !== 200) throw new Error(JSON.stringify(res));
  });
} finally {
  // Whatever happened: open again, so the next suites can sign up.
  await call(admin, "PUT", "/admin/security", { signupInviteOnly: null });
  await browser?.close();
}
finish();
