// Signed-out pages speak the browser's language (Accept-Language), and chart
// section headings follow the reader's language.
import { chromium } from "playwright";
import { ONEVERSE, WEB, api, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const reader = await user("Chart reader");
const song = await api(reader, "POST", "/song-versions", {
  title: `Language chart ${stamp}`,
  language: "en",
  artists: ["Someone"],
  content: "{start_of_verse}\n[G]Amazing grace\n{end_of_verse}\n{start_of_chorus}\n[C]My chains are gone\n{end_of_chorus}",
});

const browser = await chromium.launch();

// The messages each language ships as: "locales/fr" in dev, a "fr-<hash>.js" chunk in a build.
const messagesOf = (url) => /locales\/(en|fr)\b|\/(en|fr)-[\w-]+\.js/.exec(url)?.slice(1).find(Boolean) ?? null;

await step("a French browser gets the sign-in card in French", async () => {
  const context = await browser.newContext({ locale: "fr-FR" });
  page = await context.newPage();
  const loaded = new Set();
  const errors = [];
  page.on("request", (request) => messagesOf(request.url()) && loaded.add(messagesOf(request.url())));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && /hydrat/i.test(message.text()) && errors.push(message.text()));
  await page.goto(WEB);
  await page.waitForLoadState("networkidle");
  if ((await page.getAttribute("html", "lang")) !== "fr") throw new Error(`<html lang="${await page.getAttribute("html", "lang")}">`);
  if ([...loaded].join() !== "fr") throw new Error(`messages downloaded: ${[...loaded].join() || "none"}`);
  // Hydrated (interactive) with no mismatch: the tabs switch.
  await page.getByRole("tab", { name: "S'inscrire" }).click();
  await page.getByRole("tab", { name: "S'inscrire", selected: true }).waitFor();
  if (errors.length) throw new Error(errors.join(" | "));
  await page.goto(WEB);
  await page.waitForLoadState("networkidle");
  await page.getByText("Bienvenue").waitFor();
  await page.getByRole("tab", { name: "S'inscrire" }).waitFor();
  // Styled by the shared packages' classes too (issue #241): the app's CSS scans packages/app.
  const padding = await page.locator("main").evaluate((main) => getComputedStyle(main).paddingTop);
  if (padding !== "32px") throw new Error(`the sign-in page's padding is ${padding}: packages/app's classes aren't in the CSS`);
  // Free software (AGPL-3.0): its source offered to whoever uses it, on the sign-in page too.
  const source = page.getByTestId("source-code").getByRole("link", { name: "Code source" });
  if ((await source.getAttribute("href")) !== "https://github.com/Vulcio/Oneverse") throw new Error(await source.getAttribute("href"));
  await page.getByText("Oneverse est un logiciel libre (AGPL-3.0).").waitFor();
  await page.getByRole("button", { name: "Se connecter avec une clé d'accès" }).waitFor();
});

await step("a wrong password is explained in French", async () => {
  await page.fill("#signin-email", reader.email);
  await page.fill("#signin-password", "not-the-password");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByText("E-mail ou mot de passe incorrect").waitFor();
});

await step("forgot password and reset pages are in French too", async () => {
  await page.getByRole("button", { name: "Mot de passe oublié ?" }).click();
  await page.getByText("Réinitialiser votre mot de passe", { exact: true }).waitFor();
  await page.goto(`${ONEVERSE}/reset-password`);
  await page.getByText("Lien invalide").waitFor();
  await page.context().close();
});

await step("an English browser gets English", async () => {
  const context = await browser.newContext({ locale: "en-US" });
  page = await context.newPage();
  await page.goto(WEB);
  await page.getByText("Welcome").waitFor();
});

await step("chart section headings follow the reader's language", async () => {
  await signIn(page, reader);
  await page.goto(`${WEB}/library/${song.id}?tab=editor`);
  await page.waitForLoadState("networkidle");
  await page.getByText("Chorus", { exact: true }).first().waitFor();
  await api(reader, "PATCH", "/users/me", { locale: "fr" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByText("Refrain", { exact: true }).first().waitFor();
  await page.getByText("Couplet", { exact: true }).first().waitFor();
});

await step("switching language in the app loads the new one and the page follows", async () => {
  const context = await browser.newContext();
  page = await context.newPage();
  const loaded = new Set();
  page.on("request", (request) => messagesOf(request.url()) && loaded.add(messagesOf(request.url())));
  const switcher = await user("Language switcher");
  await signIn(page, switcher);
  await page.goto(`${WEB}/dashboard`);
  await page.waitForLoadState("networkidle");
  if ((await page.getAttribute("html", "lang")) !== "en" || loaded.has("fr")) throw new Error(`before: lang ${await page.getAttribute("html", "lang")}, loaded ${[...loaded]}`);
  await page.locator("#locale").selectOption("fr");
  await page.getByText("Langue", { exact: true }).first().waitFor();
  if ((await page.getAttribute("html", "lang")) !== "fr") throw new Error(`after: lang ${await page.getAttribute("html", "lang")}`);
  if (!loaded.has("fr")) throw new Error("French wasn't loaded");
  await page.locator("#locale").selectOption("en");
  await page.getByText("Language", { exact: true }).first().waitFor();
  await context.close();
});

await browser.close();
finish();
