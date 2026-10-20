// Brand kits in the web app (issue #279): Screens > Brands lists a team's and its organisation's brands; New brand
// makes one for a team one runs and opens it; logos go in their slots, the usual colours start the palette, a font
// is uploaded and picked for the lyrics, a background added, the links filled in - saved with Save. The team's and
// the organisation's pages show their brands to their admins; a member sees a brand read-only; Delete removes it.
import { chromium } from "playwright";
import { WEB, api, call, finish, signIn, sql, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);
const admin = await user("Brand web admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const lead = await user("Brand web lead");
const member = await user("Brand web member");
const team = await api(lead, "POST", "/teams", { name: `Brand web team ${stamp}` });
const link = await api(lead, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" });
await api(member, "POST", `/teams/join/${link.token}`);
const org = await api(lead, "POST", "/organizations", { name: `Brand web church ${stamp}` });
await call(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });
const churchBrand = await api(lead, "POST", "/brands", { name: `Church look ${stamp}`, organizationId: org.id });

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const brandName = `Youth ${stamp}`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desk = await context.newPage();
  const errors = [];
  desk.on("pageerror", (error) => errors.push(error.message));
  page = desk;
  let brandId;

  await step("Screens > Brands: the organisation's brand; New brand for the team, opened", async () => {
    await signIn(desk, lead);
    await desk.goto(`${WEB}/screens?tab=brands`);
    const list = desk.getByTestId("brands");
    await list.getByTestId(`brand-Church look ${stamp}`).waitFor();
    await list.getByTestId(`brand-Church look ${stamp}`).getByTestId("brand-default").waitFor();
    await desk.getByTestId("brand-new").click();
    const form = desk.getByTestId("brand-new-form");
    await form.getByLabel("Name").fill(brandName);
    await form.getByLabel("For").selectOption({ label: team.name });
    await form.getByTestId("brand-create").click();
    await desk.waitForURL(/\/brands\/[^/]+$/);
    brandId = desk.url().split("/").pop();
    await desk.getByTestId("brand-editor").getByRole("heading", { name: brandName }).waitFor();
    // The team's first: its default.
    await desk.getByTestId("brand-editor").getByTestId("brand-default").waitFor();
  });

  await step("logos in their slots: one for dark backgrounds too; a new one replaces it", async () => {
    await desk.getByTestId("brand-upload-logo-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await desk.locator('[data-testid="brand-logo-logo"][data-filled]').locator("img").waitFor();
    await desk.getByTestId("brand-upload-logo-dark-input").setInputFiles({ name: "logo-dark.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.alloc(16, 1)]) });
    await desk.locator('[data-testid="brand-logo-logo-dark"][data-filled]').waitFor();
    const before = (await api(lead, "GET", `/brands/${brandId}`)).assets.find((one) => one.kind === "logo").id;
    await desk.getByTestId("brand-upload-logo-input").setInputFiles({ name: "logo-2.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.alloc(32, 2)]) });
    for (let i = 0; i < 20 && (await api(lead, "GET", `/brands/${brandId}`)).assets.find((one) => one.kind === "logo")?.id === before; i++) await desk.waitForTimeout(250);
    const logos = (await api(lead, "GET", `/brands/${brandId}`)).assets.filter((one) => one.kind === "logo");
    if (logos.length !== 1 || logos[0].id === before) throw new Error(JSON.stringify(logos));
    // An SVG logomark: drawn into a PNG by the page, then sent.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" rx="4" fill="#4f46e5"/></svg>`;
    await desk.getByTestId("brand-upload-logomark-input").setInputFiles({ name: "mark.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
    await desk.locator('[data-testid="brand-logo-logomark"][data-filled]').locator("img").waitFor();
    const mark = (await api(lead, "GET", `/brands/${brandId}`)).assets.find((one) => one.kind === "logomark");
    if (mark?.mimeType !== "image/png" || mark.filename !== "mark.png") throw new Error(JSON.stringify(mark));
    // Drawn 2048 wide, keeping its 2:1 shape.
    const size = await desk.locator('[data-testid="brand-logo-logomark"] img').evaluate((img) => `${img.naturalWidth}x${img.naturalHeight}`);
    if (size !== "2048x1024") throw new Error(size);
  });

  await step("colours: the usual ones, one renamed, one added - saved", async () => {
    await desk.getByTestId("brand-colors-start").click();
    const rows = desk.getByTestId("brand-colors").getByRole("textbox", { name: "Colour" });
    if ((await rows.count()) !== 5) throw new Error(`colours: ${await rows.count()}`);
    await rows.first().fill("Brand blue");
    await desk.getByTestId("brand-color-add").click();
    await desk.getByTestId("brand-save").click();
    await desk.getByTestId("brand-save").getByText("Saved").waitFor();
    const saved = await api(lead, "GET", `/brands/${brandId}`);
    if (saved.colors.length !== 6 || saved.colors[0].name !== "Brand blue" || saved.colors[0].id !== "primary") throw new Error(JSON.stringify(saved.colors));
  });

  await step("typography: a built-in font for headings, an uploaded one for the lyrics", async () => {
    await desk.getByTestId("brand-font-heading").selectOption("family:display");
    await desk.getByTestId("brand-upload-font-input").setInputFiles({ name: "Brand-Sans.woff2", mimeType: "font/woff2", buffer: Buffer.from("774f4632", "hex") });
    await desk.getByTestId("brand-font-file").getByText("Brand-Sans").first().waitFor();
    // The heading's font, not yet saved, still picked.
    if ((await desk.getByTestId("brand-font-heading").inputValue()) !== "family:display") throw new Error("the upload lost the heading's font");
    const font = (await api(lead, "GET", `/brands/${brandId}`)).assets.find((one) => one.kind === "font");
    await desk.getByTestId("brand-font-lyrics").selectOption(`asset:${font.id}`);
    await desk.getByTestId("brand-save").click();
    await desk.getByTestId("brand-save").getByText("Saved").waitFor();
    const saved = await api(lead, "GET", `/brands/${brandId}`);
    if (saved.fonts.heading?.family !== "display" || saved.fonts.lyrics?.assetId !== font.id) throw new Error(JSON.stringify(saved.fonts));
  });

  await step("a background, then the links: website, a profile, a WhatsApp group", async () => {
    await desk.getByTestId("brand-upload-background-input").setInputFiles({ name: "stage wash.png", mimeType: "image/png", buffer: Buffer.concat([png, Buffer.alloc(8, 3)]) });
    await desk.getByTestId("brand-background").getByText("stage wash").waitFor();
    await desk.getByTestId("brand-website").fill("https://example.org");
    await desk.getByTestId("brand-social-add").click();
    await desk.getByTestId("brand-social").getByRole("textbox", { name: "Address" }).fill("https://instagram.com/example");
    await desk.getByTestId("brand-whatsapp-add").click();
    const group = desk.getByTestId("brand-whatsapp");
    await group.getByRole("textbox", { name: "Group name" }).fill("Youth news");
    await group.getByRole("textbox", { name: "Invite link" }).fill("https://chat.whatsapp.com/AbCdEf");
    await group.getByRole("textbox", { name: "What it's for" }).fill("Rides and news");
    await desk.getByTestId("brand-save").click();
    await desk.getByTestId("brand-save").getByText("Saved").waitFor();
    const saved = await api(lead, "GET", `/brands/${brandId}`);
    if (saved.website !== "https://example.org" || saved.socials[0]?.url !== "https://instagram.com/example" || saved.whatsapp[0]?.name !== "Youth news") throw new Error(JSON.stringify(saved));
  });

  await step("a link that isn't an address: refused, said why", async () => {
    await desk.getByTestId("brand-website").fill("example.org");
    await desk.getByTestId("brand-save").click();
    await desk.getByRole("alert").getByText("website must be an address starting with https://").waitFor();
    // Put back as it was saved: nothing left to save, and the refusal gone.
    await desk.getByTestId("brand-website").fill("https://example.org");
    await desk.getByTestId("brand-save").getByText("Saved").waitFor();
    await desk.getByRole("alert").waitFor({ state: "detached" });
  });

  await step("the team's page and the organisation's show their brands to their admins", async () => {
    await desk.goto(`${WEB}/teams/${team.id}`);
    await desk.getByTestId("brands-card").getByRole("link", { name: brandName }).waitFor();
    await desk.goto(`${WEB}/organizations/${org.id}`);
    await desk.getByTestId("brands-card").getByRole("link", { name: `Church look ${stamp}` }).waitFor();
    await desk.getByTestId("brands-card").getByTestId("brands-open").click();
    await desk.getByTestId("brands").getByTestId(`brand-${brandName}`).waitFor();
  });

  await step("a member sees it read-only", async () => {
    const other = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    other.on("pageerror", (error) => errors.push(error.message));
    page = other;
    await signIn(other, member);
    await other.goto(`${WEB}/screens?tab=brands`);
    if ((await other.getByTestId("brand-new").count()) > 0) throw new Error("a member can make brands");
    await other.getByTestId(`brand-${brandName}`).click();
    await other.getByText("Only its admins change this brand.").waitFor();
    if ((await other.getByTestId("brand-save").count()) + (await other.getByTestId("brand-upload-logo").count()) > 0) throw new Error("a member can change it");
    await other.close();
    page = desk;
  });

  await step("deleted: back on the list, gone", async () => {
    await desk.goto(`${WEB}/brands/${brandId}`);
    await desk.getByRole("button", { name: "Delete the brand" }).click();
    await desk.getByRole("button", { name: "Delete it, with its files" }).click();
    await desk.waitForURL(/\/screens\?tab=brands/);
    await desk.getByTestId(`brand-Church look ${stamp}`).waitFor();
    if ((await desk.getByTestId(`brand-${brandName}`).count()) > 0) throw new Error("still listed");
  });

  await step("no page errors", async () => {
    if (errors.length) throw new Error(errors.join(" | "));
  });
} finally {
  await browser.close();
  await call(lead, "DELETE", `/brands/${churchBrand.id}`);
}
finish();
