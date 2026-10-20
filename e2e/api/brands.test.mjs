// Brand kits (issue #279): a team's or an organisation's logos, colours, fonts, backgrounds and links. Its owner's
// admins change it; its members - and an organisation's teams' members - see it; nobody else. Logos go in their
// slots (a new one replaces the old, whose file goes once nothing uses it), backgrounds and fonts add up; a team's
// brand's files count in its storage pool; every file at a signed address only.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Brands global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI", anyoneCreates: true });
const lead = await user("Brands lead");
const member = await user("Brands member");
const stranger = await user("Brands stranger");
const team = await api(lead, "POST", "/teams", { name: `Brand team ${stamp}` });
const link = await api(lead, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" });
await api(member, "POST", `/teams/join/${link.token}`);
const org = await api(lead, "POST", "/organizations", { name: `Brand church ${stamp}` });
await call(lead, "PUT", `/teams/${team.id}/organization`, { organizationId: org.id });

const upload = async (who, brandId, kind, blob, filename, name) => {
  const form = new FormData();
  form.append("file", blob, filename);
  const query = new URLSearchParams({ kind, ...(name && { name }) });
  const res = await fetch(`${API}/brands/${brandId}/assets?${query}`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};
// A real 1x1 PNG, and a bigger one with other bytes.
const png = (extra = 0) => new Blob([Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), Buffer.alloc(extra, 7)])], { type: "image/png" });
const svg = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#4f46e5"/></svg>`], { type: "image/svg+xml" });

// --- making them
let r = await call(member, "POST", "/brands", { name: "Not mine", teamId: team.id });
check("only the team's admins add its brands", r.status === 403, String(r.status));
r = await call(lead, "POST", "/brands", { name: "Both", teamId: team.id, organizationId: org.id });
check("a brand belongs to a team or an organisation, not both", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "POST", "/brands", { name: `Youth ${stamp}`, teamId: team.id });
const youth = r.body;
check("a team's brand: its first, so its default; editable by its admin", r.status === 201 && youth.isDefault && youth.canEdit && youth.owner.kind === "team" && youth.colors.length === 0, JSON.stringify(r.body));
const second = await api(lead, "POST", "/brands", { name: `Second ${stamp}`, teamId: team.id });
check("…the next isn't", second.isDefault === false);
r = await call(lead, "POST", "/brands", { name: `Church ${stamp}`, organizationId: org.id });
const church = r.body;
check("an organisation's brand, by its admin", r.status === 201 && church.owner.kind === "organization" && church.owner.name === org.name, JSON.stringify(r.body));
r = await call(stranger, "POST", "/brands", { name: "Nope", organizationId: org.id });
check("…not by someone outside it", r.status === 403, String(r.status));

// --- what it holds
r = await call(lead, "PATCH", `/brands/${youth.id}`, {
  colors: [
    { id: "primary", name: "Primary", light: "#4f46e5", dark: "#818cf8" },
    { id: "accent", name: "Accent", light: "#d97706", dark: "#fbbf24" },
  ],
  fonts: { heading: { family: "display" }, body: { family: "sans" } },
  website: "https://example.org",
  socials: [{ network: "instagram", url: "https://instagram.com/example" }],
  whatsapp: [{ name: "Youth group", url: "https://chat.whatsapp.com/AbCdEf", purpose: "News and rides" }],
});
check("colours, fonts, a website, social profiles and WhatsApp groups", r.status === 200 && r.body.colors.length === 2 && r.body.fonts.heading?.family === "display" && r.body.website === "https://example.org" && r.body.socials[0].network === "instagram" && r.body.whatsapp[0].purpose === "News and rides", JSON.stringify(r.body));
r = await call(lead, "PATCH", `/brands/${youth.id}`, { colors: [{ id: "primary", name: "Primary", light: "blue", dark: "#000000" }] });
check("a colour that isn't #rrggbb is refused", r.status === 400 && r.body.message.some((m) => m.includes("#rrggbb")), JSON.stringify(r.body));
r = await call(lead, "PATCH", `/brands/${youth.id}`, { colors: [{ id: "a", name: "A", light: "#000000", dark: "#000000" }, { id: "a", name: "B", light: "#000000", dark: "#000000" }] });
check("…two colours with the same id too", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "PATCH", `/brands/${youth.id}`, { website: "javascript:alert(1)" });
check("a website that isn't an https address is refused", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "PATCH", `/brands/${youth.id}`, { fonts: { lyrics: { assetId: "not-ours" } } });
check("a font that isn't one of the brand's files is refused", r.status === 400, JSON.stringify(r.body));
r = await call(lead, "PATCH", `/brands/${second.id}`, { isDefault: true });
const listed = await api(lead, "GET", `/brands?teamId=${team.id}`);
check("one default per owner: the other unset", r.status === 200 && listed.filter((one) => one.isDefault).map((one) => one.id).join() === second.id, JSON.stringify(listed.map((one) => [one.name, one.isDefault])));
r = await call(lead, "PATCH", `/brands/${youth.id}`, { website: null });
check("the website cleared", r.status === 200 && r.body.website === null, JSON.stringify(r.body.website));

// --- who sees them
const seen = await api(member, "GET", "/brands");
check("a member sees the team's brands and its organisation's, read-only", [youth.id, second.id, church.id].every((id) => seen.some((one) => one.id === id)) && seen.every((one) => !one.canEdit), JSON.stringify(seen.map((one) => [one.name, one.canEdit])));
check("…but can't change them", (await call(member, "PATCH", `/brands/${youth.id}`, { name: "Mine" })).status === 403);
check("someone else sees none of them", (await api(stranger, "GET", "/brands")).length === 0);
check("…nor one by its id", (await call(stranger, "GET", `/brands/${youth.id}`)).status === 404);
check("…nor a team's list", (await call(stranger, "GET", `/brands?teamId=${team.id}`)).status === 404);

// --- its files
r = await upload(lead, youth.id, "logo", png(), "logo.png");
const firstLogo = r.body;
check("a logo in its slot, at a signed address", r.status === 201 && firstLogo.kind === "logo" && firstLogo.url.includes("signature="), JSON.stringify(r.body));
let res = await fetch(firstLogo.url);
check("…which serves it", res.status === 200 && res.headers.get("content-type") === "image/png", `${res.status} ${res.headers.get("content-type")}`);
res = await fetch(firstLogo.url.replace(/signature=[^&]+/, "signature=forged"));
check("…and nothing without the right signature", res.status === 403, String(res.status));
const firstKey = sql(`select "storageKey" from "BrandAsset" where id='${firstLogo.id}'`);
r = await upload(lead, youth.id, "logo", png(64), "logo-2.png");
let brand = await api(lead, "GET", `/brands/${youth.id}`);
check("a new logo replaces the slot's", r.status === 201 && brand.assets.filter((one) => one.kind === "logo").map((one) => one.id).join() === r.body.id, JSON.stringify(brand.assets));
check("…and the old file goes, nothing else using it", sql(`select count(*) from "BrandAsset" where "storageKey"='${firstKey}'`) === "0");
r = await upload(lead, youth.id, "logomark", svg, "mark.svg");
check("an SVG is refused: it couldn't be shown safely (the web app sends it as a PNG)", r.status === 400 && /SVG/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
r = await upload(lead, youth.id, "logomark", png(5), "mark.png");
check("a logomark as a PNG", r.status === 201 && r.body.mimeType === "image/png", JSON.stringify(r.body));
r = await upload(lead, youth.id, "logo-animated", svg, "anim.svg");
check("an animated logo isn't an SVG", r.status === 400, JSON.stringify(r.body));
r = await upload(lead, youth.id, "logo-animated", new Blob([Buffer.from("1a45dfa3", "hex")], { type: "video/webm" }), "intro.webm");
check("…a WebM video is", r.status === 201 && r.body.kind === "logo-animated", JSON.stringify(r.body));
r = await upload(lead, youth.id, "background", png(10), "stage.png", "Stage wash");
check("a background, named", r.status === 201 && r.body.name === "Stage wash", JSON.stringify(r.body));
await upload(lead, youth.id, "background", png(20), "lobby.png");
r = await upload(lead, youth.id, "font", new Blob([Buffer.from("774f4632", "hex")], { type: "application/octet-stream" }), "Brand-Sans.woff2");
const font = r.body;
check("a font, named from its file", r.status === 201 && font.mimeType === "font/woff2" && font.name === "Brand-Sans", JSON.stringify(r.body));
r = await upload(lead, youth.id, "font", new Blob(["<html>"], { type: "text/html" }), "page.html");
check("a page isn't a font", r.status === 400, String(r.status));
// The fonts are sent whole: the heading and body kept, the lyrics' added.
r = await call(lead, "PATCH", `/brands/${youth.id}`, { fonts: { heading: { family: "display" }, body: { family: "sans" }, lyrics: { assetId: font.id } } });
check("its own font for the lyrics", r.status === 200 && r.body.fonts.lyrics?.assetId === font.id, JSON.stringify(r.body.fonts));
r = await upload(member, youth.id, "background", png(), "x.png");
check("a member can't add files", r.status === 403, String(r.status));
brand = await api(lead, "GET", `/brands/${youth.id}`);
check("backgrounds add up, logos keep one per slot", brand.assets.filter((one) => one.kind === "background").length === 2 && brand.assets.filter((one) => one.kind === "logo").length === 1, JSON.stringify(brand.assets.map((one) => one.kind)));

// --- the team's pool
const pool = (await api(admin, "GET", "/admin/teams")).find((one) => one.id === team.id);
const brandBytes = brand.assets.reduce((sum, one) => sum + one.sizeBytes, 0);
check("a team's brand's files count in its storage pool", pool.usedBytes === brandBytes, `${pool.usedBytes} vs ${brandBytes}`);

// --- a font removed: no longer the brand's
check("a font removed", (await call(lead, "DELETE", `/brands/${youth.id}/assets/${font.id}`)).status === 204);
brand = await api(lead, "GET", `/brands/${youth.id}`);
check("…and no longer its lyrics' font", !brand.fonts.lyrics && brand.fonts.heading?.family === "display", JSON.stringify(brand.fonts));

// --- deleted: its files with it
const keys = sql(`select string_agg("storageKey", ',') from "BrandAsset" where "brandId"='${youth.id}'`).split(",");
check("only its admins delete it", (await call(member, "DELETE", `/brands/${youth.id}`)).status === 403);
check("deleted", (await call(lead, "DELETE", `/brands/${youth.id}`)).status === 204);
check("…its files with it, nothing else using them", keys.every((key) => sql(`select count(*) from "BrandAsset" where "storageKey"='${key}'`) === "0"));
check("…gone from the list", !(await api(lead, "GET", "/brands")).some((one) => one.id === youth.id));

finish();
