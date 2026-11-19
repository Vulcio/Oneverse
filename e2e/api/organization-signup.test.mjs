// Signing up by asking for an organisation (issue #533): with sign-up by
// invitation only and organisations on, Admin > Users can let anyone else
// sign up by asking for theirs. The organisation comes first - its address
// checked, look-alikes refused - and is kept for the account made next (a
// pass in a cookie); the account only sees where its request stands until
// a global admin approves it. Invite links still let people in.
import { API, ORIGIN, VERIFY_LINK_PATTERN, call, check, finish, logOffset, sql, stamp, user, waitForLog } from "../lib/harness.mjs";

const admin = await user("orgsignup global admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const host = await user("orgsignup team host");

const email = (name) => `e2e-org-signup-${name}-${stamp}@example.com`;
const exists = (address) => sql(`select count(*) from "User" where email='${address}'`) === "1";
const name = `Grace Chapel ${stamp}`;
const details = (extra = {}) => ({
  name,
  kind: "CHURCH",
  street: "12 rue de la Paix",
  postalCode: "75002",
  city: "Paris",
  country: "FR",
  responsibleFirstName: "Marie",
  responsibleLastName: "Curie",
  ...extra,
});

/** Asks for an organisation, signed out: the status, the body, and the pass's cookie. */
async function ask(body) {
  const res = await fetch(`${API}/auth/organization-signup`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), raw: res.headers.getSetCookie().join("\n") };
}
/** A sign-up by email with the cookies given, verified and signed in: who it is, for call(). */
async function signUp(address, cookie = "") {
  const offset = logOffset();
  const res = await fetch(`${API}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie && { cookie }) },
    body: JSON.stringify({ email: address, password: "hunter2pass", name: "Marie Curie" }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200) return { status: res.status, code: body.code };
  const [link] = await waitForLog(offset, VERIFY_LINK_PATTERN);
  await fetch(link, { redirect: "manual" });
  const signedIn = await fetch(`${API}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: address, password: "hunter2pass" }) });
  const session = signedIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const bearer = (await (await fetch(`${API}/api/auth/token`, { headers: { cookie: session, Origin: ORIGIN } })).json()).token;
  return { status: 200, email: address, bearer, cookie: session, id: sql(`select id from "User" where email='${address}'`) };
}

// Requests left by an earlier run look like this one's.
sql(`delete from "OrganizationRequest" where street = '12 rue de la Paix' or street = '12, Rue de la Paix'`);
sql(`delete from "Organization" where street = '12 rue de la Paix'`);

try {
  await call(admin, "DELETE", "/admin/organizations/settings");
  await call(admin, "PUT", "/admin/organizations/settings", { mode: "MULTI" });
  let r = await call(admin, "PUT", "/admin/security", { signupInviteOnly: true });
  let config = await (await fetch(`${API}/auth/public-config`)).json();
  check("by invitation only, sign-up by request is off by default", config.signupInviteOnly === true && config.signupOrganizationRequests === false, JSON.stringify(config));
  r = await ask(details());
  check("…and asking for an organisation is refused", r.status === 403, JSON.stringify(r.body));

  r = await call(admin, "PUT", "/admin/security", { signupOrganizationRequests: true });
  check("Admin: switched on", r.status === 204, String(r.status));
  r = await call(admin, "GET", "/admin/security");
  check("…saved, with its env var", r.body.settings.signupOrganizationRequests.value === true && r.body.settings.signupOrganizationRequests.source === "database" && r.body.settings.signupOrganizationRequests.env === "SIGNUP_ORGANIZATION_REQUESTS", JSON.stringify(r.body.settings.signupOrganizationRequests));
  config = await (await fetch(`${API}/auth/public-config`)).json();
  check("the sign-in page is told", config.signupOrganizationRequests === true, JSON.stringify(config));

  // --- the address is checked
  r = await ask(details({ postalCode: "7500" }));
  check("a postal code not in its country's format is refused", r.status === 400 && r.body.message.some((line) => line.startsWith("postalCode")), JSON.stringify(r.body));
  r = await ask(details({ postalCode: undefined }));
  check("…one is needed where the country has them", r.status === 400 && r.body.message.some((line) => line.startsWith("postalCode")), JSON.stringify(r.body));
  r = await ask(details({ country: "ZZ" }));
  check("a country we know", r.status === 400 && r.body.message.some((line) => line.startsWith("country")), JSON.stringify(r.body));
  r = await ask(details({ responsibleLastName: undefined }));
  check("the person responsible, first and last name", r.status === 400 && r.body.message.some((line) => line.startsWith("responsibleLastName")), JSON.stringify(r.body));
  r = await ask(details({ country: "HK", postalCode: undefined, city: "Hong Kong" }));
  check("no postal code where a country has none", r.status === 204, JSON.stringify(r.body));

  // --- kept for the account made next
  r = await ask(details({ country: "fr", postalCode: " 75002 " }));
  check("asked: kept in a cookie for sign-up", r.status === 204 && /HttpOnly/i.test(r.raw) && /Path=\/api\/auth/i.test(r.raw) && r.cookie.includes("request%3A"), r.raw);
  const draftToken = decodeURIComponent(r.cookie.split("=")[1]).split(":")[1];
  check("…as typed, tidied", sql(`select data->>'country' || '|' || (data->>'postalCode') from "OrganizationSignupDraft" where token='${draftToken}'`) === "FR|75002");

  let stranger = await signUp(email("stranger"));
  check("without one, still by invitation only", stranger.status === 422 && stranger.code === "SIGNUP_INVITE_ONLY" && !exists(email("stranger")), JSON.stringify(stranger));
  const forged = await signUp(email("forger"), "songverse_signup_pass=request:made-up");
  check("…not with a made-up one", forged.status === 422 && !exists(email("forger")), JSON.stringify(forged));

  const marie = await signUp(email("marie"), r.cookie);
  check("with it, the account is made", marie.status === 200 && exists(email("marie")), JSON.stringify(marie));
  const request = JSON.parse(sql(`select row_to_json(r) from "OrganizationRequest" r where "requestedById"='${marie.id}'`));
  check("…and the request is theirs, with its address and the person responsible", request.name === name && request.street === "12 rue de la Paix" && request.postalCode === "75002" && request.country === "FR" && request.responsibleFirstName === "Marie" && request.responsibleLastName === "Curie" && request.contactEmail === email("marie") && request.atSignup === true, JSON.stringify(request));
  check("…the draft gone", sql(`select count(*) from "OrganizationSignupDraft" where token='${draftToken}'`) === "0");
  check("admins aren't told before the account is signed in", sql(`select count(*) from "Notification" where "userId"='${admin.id}' and kind='ORGANIZATION_REQUESTED' and data->>'organization'='${name}'`) === "0");

  // --- waiting: only where it stands
  r = await call(marie, "GET", "/users/me");
  check("their account waits for approval", r.status === 200 && r.body.awaitingApproval === true, JSON.stringify(r.body.awaitingApproval));
  r = await call(marie, "GET", "/teams");
  check("…and nothing else is open to it", r.status === 403 && r.body.code === "ACCOUNT_AWAITING_APPROVAL", JSON.stringify(r.body));
  r = await call(marie, "POST", "/teams", { name: "Sneaky team" });
  check("…not even making a team", r.status === 403, String(r.status));
  r = await call(marie, "PATCH", "/users/me", { displayName: "Marie S. Curie" });
  check("their own profile is", r.status === 200 && r.body.displayName === "Marie S. Curie", JSON.stringify(r.body));
  r = await call(marie, "GET", "/organizations/requests/mine");
  check("the waiting page: their request, waiting", r.status === 200 && r.body.awaitingApproval === true && r.body.requests.length === 1 && r.body.requests[0].status === "PENDING" && r.body.requests[0].atSignup === true, JSON.stringify(r.body));
  check("…and now admins are told", sql(`select count(*) from "Notification" where "userId"='${admin.id}' and kind='ORGANIZATION_REQUESTED' and data->>'organization'='${name}'`) === "1");
  await call(marie, "GET", "/organizations/requests/mine");
  check("…once", sql(`select count(*) from "Notification" where "userId"='${admin.id}' and kind='ORGANIZATION_REQUESTED' and data->>'organization'='${name}'`) === "1");

  // --- duplicates
  r = await ask(details({ name: `grace  chapel, ${stamp}!`, street: "12, Rue de la Paix" }));
  check("the same organisation at the same address, written differently: refused, with it", r.status === 409 && r.body.code === "ORGANIZATION_EXISTS" && r.body.looksLike.some((one) => one.source === "request" && one.id === request.id && one.match === "same"), JSON.stringify(r.body));
  r = await ask(details({ name: `Grace Chapel ${stamp}`, duplicateNote: "We really are another one" }));
  check("…even with a note", r.status === 409 && r.body.code === "ORGANIZATION_EXISTS", JSON.stringify(r.body));
  r = await ask(details({ name: `Saint Paul Choir ${stamp}`, kind: "CHOIR" }));
  check("another name at the same address: asked why", r.status === 409 && r.body.code === "ORGANIZATION_LOOKS_LIKE" && r.body.looksLike.every((one) => one.match === "close"), JSON.stringify(r.body));
  r = await ask(details({ name: `Saint Paul Choir ${stamp}`, kind: "CHOIR", duplicateNote: "The choir rehearsing in Grace Chapel's hall" }));
  check("…sent with a note", r.status === 204, JSON.stringify(r.body));
  r = await ask(details({ street: "40 avenue Jean Jaurès", postalCode: "69007", city: "Lyon" }));
  check("the same name elsewhere is another one", r.status === 204, JSON.stringify(r.body));

  // --- withdrawn, asked again from the waiting page
  r = await call(marie, "DELETE", `/organizations/requests/${request.id}`);
  check("they withdraw it", r.status === 204, String(r.status));
  r = await call(marie, "POST", "/organizations/requests", { ...details(), contactName: "Marie Curie", contactEmail: email("marie") });
  const again = r.body;
  check("…and ask again, still waiting", r.status === 201 && again.atSignup === true && again.street === "12 rue de la Paix" && (await call(marie, "GET", "/users/me")).body.awaitingApproval === true, JSON.stringify(r.body));

  // --- approved
  r = await call(admin, "GET", "/admin/organizations/requests");
  const pending = r.body.pending.find((one) => one.id === again.id);
  check("Admin: the request with its address, made at sign-up, email verified", pending?.street === "12 rue de la Paix" && pending.atSignup === true && pending.requestedBy.emailVerified === true, JSON.stringify(pending));
  r = await call(admin, "POST", `/admin/organizations/requests/${again.id}/approve`);
  const organizationId = r.body.organizationId;
  check("approved", r.status === 201 && typeof organizationId === "string", JSON.stringify(r.body));
  r = await call(marie, "GET", "/users/me");
  check("their account is open", r.body.awaitingApproval === false, JSON.stringify(r.body.awaitingApproval));
  r = await call(marie, "GET", `/organizations/${organizationId}`);
  check("…they run it, with its address and the person responsible", r.status === 200 && r.body.currentUserRole === "ADMIN" && r.body.street === "12 rue de la Paix" && r.body.postalCode === "75002" && r.body.country === "FR" && r.body.responsibleLastName === "Curie", JSON.stringify(r.body));
  r = await call(marie, "GET", "/teams");
  check("…and everything else", r.status === 200, String(r.status));
  r = await ask(details({ name: `Grace Chapel ${stamp}` }));
  check("one like it now here is refused", r.status === 409 && r.body.code === "ORGANIZATION_EXISTS" && r.body.looksLike.some((one) => one.source === "organization" && one.id === organizationId), JSON.stringify(r.body));

  // --- invitations always work
  r = await ask(details({ name: `Hope House ${stamp}`, street: "3 place Bellecour", postalCode: "69002", city: "Lyon" }));
  const pierre = await signUp(email("pierre"), r.cookie);
  check("someone else waits", (await call(pierre, "GET", "/users/me")).body.awaitingApproval === true);
  const team = (await call(host, "POST", "/teams", { name: `Org signup team ${stamp}` })).body;
  const link = (await call(host, "POST", `/teams/${team.id}/invite-links`, { role: "MEMBER" })).body;
  r = await call(pierre, "POST", `/teams/join/${link.token}`);
  check("…and opens a team's invite link: in", r.status === 201 && (await call(pierre, "GET", "/users/me")).body.awaitingApproval === false && (await call(pierre, "GET", "/teams")).status === 200, JSON.stringify(r.body));
  check("…their request still waits for review", sql(`select status from "OrganizationRequest" where "requestedById"='${pierre.id}'`) === "PENDING");

  // --- off again
  await call(admin, "PUT", "/admin/security", { signupOrganizationRequests: false });
  r = await ask(details({ name: `Late ${stamp}`, street: "1 rue Neuve", postalCode: "59000", city: "Lille" }));
  check("switched off: not asked any more", r.status === 403, String(r.status));
} finally {
  // Whatever happened: open again, so the next suites can sign up.
  await call(admin, "PUT", "/admin/security", { signupInviteOnly: null, signupOrganizationRequests: null });
  await call(admin, "DELETE", "/admin/organizations/settings");
  sql(`delete from "OrganizationRequest" where street in ('12 rue de la Paix', '12, Rue de la Paix', '40 avenue Jean Jaurès', '3 place Bellecour')`);
}
finish();
