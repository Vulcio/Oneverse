// Passkeys: adding one from Oneverse's account page (issue #303) and signing
// in to Songverse with it, using Chromium's virtual authenticator in place of
// a fingerprint reader. The relying-party ID is the parent domain Oneverse
// and the API share (apps/api/src/auth/auth-domains.ts; localhost here).
import { chromium } from "playwright";
import { ONEVERSE, WEB, finish, signIn, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const me = await user("Passkey holder");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});

await step("add a passkey from the account settings", async () => {
  await signIn(page, me);
  // Songverse's settings send there.
  await page.goto(`${WEB}/dashboard#settings`);
  await page.getByTestId("oneverse-account").getByRole("link", { name: "Manage at Oneverse" }).click();
  await page.waitForURL(`${ONEVERSE}/account`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Name (optional)").fill("My laptop");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await page.getByText("My laptop").waitFor();
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  if (credentials.length !== 1 || credentials[0].rpId !== new URL(ONEVERSE).hostname) throw new Error(JSON.stringify(credentials.map((c) => c.rpId)));
});

await step("sign out, then sign in with the passkey alone", async () => {
  await page.goto(`${WEB}/library`);
  await page.getByRole("button", { name: "Passkey holder" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  // Out of Songverse and Oneverse, back at Oneverse's sign-in.
  await page.waitForURL(`${ONEVERSE}/sign-in**`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await page.waitForURL("**/library");
  await page.getByRole("button", { name: "Passkey holder" }).waitFor();
});

await browser.close();
finish();
