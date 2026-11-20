// Announcements (issue #536): news through people's notifications. Global
// admins write them (Admin > Announcements) in English and French, for
// everyone, Songverse's or Planiverse's people, or an organisation; an
// organisation's admins for its members. A draft until sent; sending is the
// Worker's job, one notification each, read in each person's language;
// fixing a sent one changes everyone's, taking it back removes them.
// Announcements are pushed, not emailed, until one chooses.
// Nothing here goes to everyone: other suites share the database.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const until = async (test, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
};

const admin = await user("announce global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const orgAdmin = await user("announce org admin");
const member = await user("announce member");
const french = await user("announce french member");
const outsider = await user("announce outsider");
sql(`update "User" set locale='fr' where id='${french.id}'`);
await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI" });
const organization = (await call(admin, "POST", "/admin/organizations", { name: `Announce Church ${stamp}`, adminEmail: orgAdmin.email })).body;
for (const [n, who] of [member, french].entries()) {
  sql(`insert into "OrganizationMembership" (id, "organizationId", "userId", role, "joinedAt", "updatedAt") values ('oman${n}${stamp}', '${organization.id}', '${who.id}', 'MEMBER', now(), now())`);
}
const mine = async (who, kind) => (await call(who, "GET", "/users/me/notifications")).body.items.filter((item) => item.kind === kind);

// --- defaults: pushed, not emailed
let r = await call(member, "GET", "/users/me/notifications/settings");
check("announcements pushed but not emailed until one chooses", r.body.kinds.ANNOUNCEMENT.push === true && r.body.kinds.ANNOUNCEMENT.email === false && r.body.kinds.ORGANIZATION_ANNOUNCEMENT.email === false, JSON.stringify(r.body.kinds.ANNOUNCEMENT));

// --- only global admins, in Admin
r = await call(member, "GET", "/admin/announcements");
check("Admin > Announcements: global admins only", r.status === 403, String(r.status));
r = await call(admin, "POST", "/admin/announcements", { texts: {} });
check("words in one language at least", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", "/admin/announcements", { texts: { de: { title: "Neu" } } });
check("a language that isn't offered: refused", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "POST", "/admin/announcements", { texts: { en: { title: "New", url: "javascript:alert(1)" } } });
check("a link that isn't a page or a web address: refused", r.status === 400 && JSON.stringify(r.body).includes("url"), JSON.stringify(r.body));
r = await call(admin, "POST", "/admin/announcements", { texts: { en: { title: "New" } }, audience: "ORGANIZATION" });
check("an organisation's members, but which: refused", r.status === 400, JSON.stringify(r.body));

r = await call(admin, "POST", "/admin/announcements", { texts: { en: { title: "Everyone draft", body: "Not sent" } } });
check("a draft for everyone, saying how many it would reach", r.status === 201 && r.body.sentAt === null && r.body.audience === "EVERYONE" && r.body.recipients >= 5 && r.body.createdBy?.id === admin.id, JSON.stringify(r.body));
const everyone = r.body;
check("…a draft sends nothing", (await mine(member, "ANNOUNCEMENT")).length === 0);

const en = { title: `Version ${stamp} is here`, body: "Pinch to zoom charts.", url: "https://docs.oneverse.top/whats-new/" };
const fr = { title: `La version ${stamp} est là`, body: "Zoomez sur les grilles.", url: "https://docs.oneverse.top/fr/whats-new/" };
r = await call(admin, "POST", "/admin/announcements", { texts: { en, fr }, audience: "ORGANIZATION", organizationId: organization.id });
check("for an organisation's members: 3 with its admin", r.status === 201 && r.body.recipients === 3 && r.body.organizationName === organization.name, JSON.stringify(r.body));
const news = r.body;

r = await call(admin, "POST", `/admin/announcements/${news.id}/send`);
check("sent: marked, to 3", r.status === 200 && !!r.body.sentAt && r.body.recipients === 3, JSON.stringify(r.body));
check("the Worker makes one notification each", await until(async () => (await mine(member, "ORGANIZATION_ANNOUNCEMENT")).length === 1 && (await mine(french, "ORGANIZATION_ANNOUNCEMENT")).length === 1 && (await mine(orgAdmin, "ORGANIZATION_ANNOUNCEMENT")).length === 1));
let [item] = await mine(member, "ORGANIZATION_ANNOUNCEMENT");
check("its words, the organisation and the English link", item.data.texts.en.title === en.title && item.data.texts.fr.title === fr.title && item.data.organization === organization.name && item.url === en.url && item.read === false, JSON.stringify(item));
check("not to someone outside it", (await mine(outsider, "ORGANIZATION_ANNOUNCEMENT")).length === 0);
r = await call(admin, "POST", `/admin/announcements/${news.id}/send`);
check("sending twice sends nothing more", r.status === 200 && (await until(async () => true)) && sql(`select count(*) from "Notification" where "announcementId"='${news.id}'`) === "3");
check("the push job looks at it: pushed, never emailed by default", await until(() => sql(`select count(*) from "Notification" where "announcementId"='${news.id}' and "pushedAt" is not null and "emailedAt" is not null`) === "3"));

// --- fixed after sending: in everyone's notifications
r = await call(admin, "PATCH", `/admin/announcements/${news.id}`, { texts: { en: { ...en, title: `${en.title}!` }, fr } });
[item] = await mine(member, "ORGANIZATION_ANNOUNCEMENT");
check("its words fixed for everyone", r.status === 200 && item.data.texts.en.title === `${en.title}!` && item.data.organization === organization.name, JSON.stringify(item.data));
r = await call(admin, "PATCH", `/admin/announcements/${news.id}`, { audience: "EVERYONE" });
check("sent: who it's for can't change", r.status === 409, String(r.status));

// --- an organisation's admins, for its members
r = await call(member, "POST", `/organizations/${organization.id}/announcements`, { texts: { en: { title: "Hi" } } });
check("a member can't announce", r.status === 403, String(r.status));
r = await call(outsider, "GET", `/organizations/${organization.id}/announcements`);
check("someone outside doesn't see them", r.status === 404, String(r.status));
r = await call(orgAdmin, "POST", `/organizations/${organization.id}/announcements`, { texts: { fr: { title: "Nouveau lieu", body: "Rue Neuve dès dimanche." } } });
check("its admin drafts one, in their language", r.status === 201 && r.body.audience === "ORGANIZATION" && r.body.organizationId === organization.id && r.body.recipients === 3, JSON.stringify(r.body));
const local = r.body;
r = await call(orgAdmin, "PATCH", `/organizations/${organization.id}/announcements/${everyone.id}`, { texts: { en: { title: "Hijack" } } });
check("…not someone else's", r.status === 404, String(r.status));
r = await call(orgAdmin, "POST", `/organizations/${organization.id}/announcements/${local.id}/send`);
check("sent to its members", r.status === 200 && !!r.body.sentAt, JSON.stringify(r.body));
check("…each told once", await until(async () => (await mine(member, "ORGANIZATION_ANNOUNCEMENT")).length === 2));
r = await call(orgAdmin, "GET", `/organizations/${organization.id}/announcements`);
check("its admin lists the organisation's, newest first", r.status === 200 && r.body.length === 2 && r.body[0].id === local.id, JSON.stringify(r.body.map((one) => one.id)));
r = await call(admin, "GET", "/admin/announcements");
check("Admin lists them all", r.body.some((one) => one.id === local.id) && r.body.some((one) => one.id === everyone.id), String(r.body.length));

// --- taken back: out of everyone's notifications
r = await call(orgAdmin, "DELETE", `/organizations/${organization.id}/announcements/${local.id}`);
check("taken back", r.status === 204, String(r.status));
check("…gone from their notifications", (await mine(member, "ORGANIZATION_ANNOUNCEMENT")).length === 1 && sql(`select count(*) from "Notification" where "announcementId"='${local.id}'`) === "0");
r = await call(admin, "DELETE", `/admin/announcements/${everyone.id}`);
check("a draft deleted", r.status === 204 && (await call(admin, "GET", "/admin/announcements")).body.every((one) => one.id !== everyone.id), String(r.status));

finish();
