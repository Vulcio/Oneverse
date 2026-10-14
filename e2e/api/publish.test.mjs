// Publishing to the global catalogue: submitting, the review queue, the
// reviewer role, approving (the song itself moves to the catalogue, issue
// #73), merging, sending back, rejecting, withdrawing, and global admins
// publishing directly.
import { API, stamp, sql, check, user, call, api, finish } from "../lib/harness.mjs";

const admin = await user("Pub admin");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const reviewer = await user("Pub reviewer");
const alice = await user("Pub alice");
const bob = await user("Pub bob");
const [globalTag] = sql(`select id from "Tag" where scope='GLOBAL' and "isApproved" limit 1`).split("\n");

const title = `Publish Me ${stamp}`;
const song = await api(alice, "POST", "/song-versions", {
  title,
  language: "en",
  artists: ["Alice Band"],
  composers: ["Alice Writer"],
  notes: "My private rehearsal notes",
  tagIds: [globalTag],
  content: "{start_of_verse}\n[G]Hello [C]world\n{end_of_verse}",
});

// --- the reviewer role
let r = await call(reviewer, "GET", "/submissions");
check("the queue is for reviewers only", r.status === 403, String(r.status));
const reviewerRole = (await api(admin, "GET", "/admin/roles")).find((role) => role.builtIn === "REVIEWER");
r = await call(admin, "PUT", `/admin/users/${reviewer.id}/roles`, { roleIds: [reviewerRole.id] });
check("an admin gives someone the Reviewer role", r.status === 204, String(r.status));
const reviewerRow = (await api(admin, "GET", "/admin/users")).find((u) => u.id === reviewer.id);
check("the admin user list shows it", reviewerRow?.isReviewer === true && reviewerRow.roles.some((role) => role.id === reviewerRole.id), JSON.stringify(reviewerRow?.roles));
check("/users/me says so", (await api(reviewer, "GET", "/users/me")).isReviewer === true);

// --- submitting
r = await call(alice, "GET", `/song-versions/${song.id}/publication`);
check(
  "before: nothing submitted, can submit, can't publish directly",
  r.status === 200 && r.body.submission === null && r.body.published === null && r.body.canSubmit === true && r.body.canPublishDirectly === false,
  JSON.stringify(r.body),
);
r = await call(bob, "POST", `/song-versions/${song.id}/submissions`, {});
check("someone who can't edit the song can't submit it", r.status === 403, String(r.status));
r = await call(alice, "POST", `/song-versions/${song.id}/publish`, {});
check("only global admins publish directly", r.status === 403, String(r.status));
r = await call(alice, "POST", `/song-versions/${song.id}/submissions`, { message: "Please add this one" });
check("submit without copyright or CCLI", r.status === 201 && r.body.state === "SUBMITTED" && r.body.submitterMessage === "Please add this one", JSON.stringify(r.body));
const sub1 = r.body.id;
r = await call(alice, "POST", `/song-versions/${song.id}/submissions`, {});
check("can't submit twice while one is open", r.status === 409, String(r.status));
check("the song shows as submitted", (await api(alice, "GET", `/song-versions/${song.id}`)).publicationState === "SUBMITTED");

// Alice's own layer on it: a file everyone who could see the song saw (only her), one kept private, an arrangement, a personal tag.
const upload = async (name, visibility) => {
  const form = new FormData();
  form.append("type", "PDF");
  form.append("visibility", visibility);
  form.append("file", new Blob([`%PDF-1.4 ${name} ${stamp}`], { type: "application/pdf" }), name);
  return (await fetch(`${API}/song-versions/${song.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${alice.bearer}` }, body: form })).json();
};
const shownFile = await upload("lead-sheet.pdf", "SONG");
await upload("my-take.pdf", "PRIVATE");
const arrangement = await api(alice, "POST", `/song-versions/${song.id}/arrangements`, { name: "Alice's way" });
const categoryId = sql(`select "categoryId" from "Tag" where id='${globalTag}'`);
sql(`insert into "Tag" (id, "categoryId", slug, label, scope, "ownerUserId", "updatedAt") values ('ptag${stamp}', '${categoryId}', 'alice-${stamp}', 'Alice only', 'USER', '${alice.id}', now())`);
sql(`insert into "SongVersionTag" (id, "songVersionId", "tagId") values ('pvt${stamp}', '${song.id}', 'ptag${stamp}')`);
const historyBefore = (await api(alice, "GET", `/song-versions/${song.id}/history`)).length;

// --- reviewing
r = await call(reviewer, "GET", "/submissions");
check("it's in the queue", r.status === 200 && r.body.some((s) => s.id === sub1 && s.song.title === title && s.submitter.id === alice.id), JSON.stringify(r.body).slice(0, 300));
r = await call(reviewer, "GET", `/song-versions/${song.id}`);
check("a reviewer can open a submitted song", r.status === 200, String(r.status));
check("but it isn't in their library", !(await api(reviewer, "GET", `/song-versions?q=${encodeURIComponent(title)}`)).items.some((s) => s.id === song.id));
r = await call(bob, "GET", `/song-versions/${song.id}`);
check("others still can't see it", r.status === 403, String(r.status));
r = await call(reviewer, "POST", `/submissions/${sub1}/start-review`);
check("start review", r.status === 201 && r.body.state === "UNDER_REVIEW" && r.body.reviewer?.id === reviewer.id, JSON.stringify(r.body).slice(0, 200));
r = await call(reviewer, "POST", `/submissions/${sub1}/request-changes`, { notes: "" });
check("sending back needs a note", r.status === 400, String(r.status));
r = await call(reviewer, "POST", `/submissions/${sub1}/request-changes`, { notes: "Please add the bridge" });
check("send back for changes", r.status === 201 && r.body.state === "NEEDS_CHANGES" && r.body.reviewNotes === "Please add the bridge");
r = await call(alice, "GET", `/song-versions/${song.id}/publication`);
check("the submitter sees the notes", r.body.submission?.state === "NEEDS_CHANGES" && r.body.submission.reviewNotes === "Please add the bridge" && r.body.canSubmit === false);
const told = async (kind) => (await api(alice, "GET", "/users/me/notifications?limit=100")).items.filter((item) => item.kind === kind);
check("…and is told, with them (issue #149)", (await told("SUBMISSION_RETURNED"))[0]?.data.note === "Please add the bridge" && (await told("SUBMISSION_RETURNED"))[0].data.by === "Pub reviewer");
r = await call(alice, "POST", `/submissions/${sub1}/resubmit`, { message: "Bridge added" });
check("resubmit", r.status === 201 && r.body.state === "SUBMITTED" && r.body.submitterMessage === "Bridge added", JSON.stringify(r.body).slice(0, 200));
check("it's mine", (await api(alice, "GET", "/submissions/mine")).some((s) => s.id === sub1));

// --- approving: the song itself moves to the catalogue
r = await call(reviewer, "POST", `/submissions/${sub1}/approve`, { trustLabel: "Checked by the team" });
check("approve", r.status === 201 && r.body.state === "APPROVED" && r.body.publishedVersionId === song.id, JSON.stringify(r.body).slice(0, 200));
check("…the submitter told it's in the catalogue", (await told("SUBMISSION_PUBLISHED"))[0]?.url === `/library/${song.id}`);
const globalId = song.id;
const published = await api(bob, "GET", `/song-versions/${globalId}`);
check(
  "anyone sees it, with its chart, credits and global tag, credited to Alice",
  published.ownerScope === "GLOBAL" &&
    published.ownerUserId === null &&
    published.publicationState === "APPROVED" &&
    published.title === title &&
    published.documentJson.sections.length === 1 &&
    published.contributors.map((c) => c.source).join("|") === "Alice Band|Alice Writer" &&
    published.contributedBy?.id === alice.id &&
    published.tags.some((t) => t.id === globalTag),
  JSON.stringify({ scope: published.ownerScope, state: published.publicationState, by: published.contributedBy, tags: published.tags?.length }),
);
check("with the trust label", sql(`select "trustLabel" from "SongVersion" where id='${globalId}'`) === "Checked by the team");
check("one song: no copy", Number(sql(`select count(*) from "SongVersion" where lower(title)=lower('${title}')`)) === 1);
check("Alice's own tag stays hers", !published.tags.some((t) => t.id === `ptag${stamp}`) && (await api(alice, "GET", `/song-versions/${globalId}`)).tags.some((t) => t.id === `ptag${stamp}`));
const aliceFiles = await api(alice, "GET", `/song-versions/${globalId}/attachments`);
check(
  "her files are still there for her, now only hers",
  aliceFiles.length === 2 && aliceFiles.every((f) => f.visibility === "PRIVATE") && aliceFiles.some((f) => f.id === shownFile.id),
  JSON.stringify(aliceFiles.map((f) => [f.filename, f.visibility])),
);
check("nobody else sees them", (await api(bob, "GET", `/song-versions/${globalId}/attachments`)).length === 0);
check("her arrangement stays, hers", (await api(alice, "GET", `/arrangements/${arrangement.id}`)).songVersionId === globalId);
check("its history goes on", (await api(bob, "GET", `/song-versions/${globalId}/history`)).length === historyBefore);
r = await call(alice, "PATCH", `/song-versions/${globalId}`, { title: "Mine again" });
check("Alice no longer edits it herself", r.status === 403, String(r.status));
r = await call(alice, "GET", `/song-versions?q=${encodeURIComponent(title)}`);
check("her library lists it once", r.body.items.filter((s) => s.title === title).length === 1 && r.body.items[0].contributedBy?.id === alice.id);
check("audit trail", Number(sql(`select count(*) from "AuditEvent" where "entityId" in ('${sub1}','${globalId}')`)) >= 4);
r = await call(alice, "POST", `/song-versions/${song.id}/submissions`, {});
check("a published song can't be submitted again", r.status === 403 || r.status === 409, String(r.status));

// --- duplicates: a reason, then merging into the existing song
const bobSong = await api(bob, "POST", "/song-versions", { title: title.toUpperCase(), language: "en", artists: ["Alice Band"] });
r = await call(bob, "GET", `/song-versions/${bobSong.id}/publication`);
check("look-alikes are shown before submitting", r.body.matches.some((m) => m.id === globalId && m.reason === "titleAndArtist"), JSON.stringify(r.body.matches));
r = await call(bob, "POST", `/song-versions/${bobSong.id}/submissions`, {});
check("a look-alike needs a reason", r.status === 409 && r.body.matches?.some((m) => m.id === globalId), JSON.stringify(r.body).slice(0, 200));
r = await call(bob, "POST", `/song-versions/${bobSong.id}/submissions`, { duplicateReason: "Live version" });
check("with a reason it goes through, look-alikes kept for the reviewer", r.status === 201 && r.body.duplicateReason === "Live version" && r.body.matches.length === 1);
const sub2 = r.body.id;
r = await call(reviewer, "POST", `/submissions/${sub2}/merge`, { targetId: bobSong.id });
check("merging needs a global target", r.status === 400, String(r.status));
r = await call(reviewer, "POST", `/submissions/${sub2}/merge`, { targetId: globalId, notes: "Same song" });
check("merge into the existing song", r.status === 201 && r.body.state === "APPROVED" && r.body.mergeTargetId === globalId && r.body.publishedVersionId === globalId);
check("no second catalogue song", Number(sql(`select count(*) from "SongVersion" where "ownerScope"='GLOBAL' and lower(title)=lower('${title}')`)) === 1);
r = await call(bob, "GET", `/song-versions/${bobSong.id}`);
check("bob's song is folded into it (#75): no copy left", r.status === 404, String(r.status));
check("his library lists the catalogue song", (await api(bob, "GET", `/song-versions?q=${encodeURIComponent(title)}`)).items.some((s) => s.id === globalId));

// --- rejecting, withdrawing, reviewing your own
const other = await api(bob, "POST", "/song-versions", { title: `Reject Me ${stamp}`, language: "en", artists: ["Bob"] });
const sub3 = (await api(bob, "POST", `/song-versions/${other.id}/submissions`, {})).id;
r = await call(reviewer, "POST", `/submissions/${sub3}/reject`, { notes: "Not a song" });
check("reject", r.body.state === "REJECTED" && r.body.reviewNotes === "Not a song");
r = await call(reviewer, "POST", `/submissions/${sub3}/approve`, {});
check("a closed submission can't be approved", r.status === 409, String(r.status));
r = await call(bob, "POST", `/song-versions/${other.id}/submissions`, { message: "Try again" });
check("after a rejection it can be submitted again", r.status === 201, String(r.status));
r = await call(bob, "POST", `/submissions/${r.body.id}/withdraw`);
check("withdraw", r.body.state === "WITHDRAWN" && (await api(bob, "GET", `/song-versions/${other.id}`)).publicationState === "DRAFT");
const reviewersSong = await api(reviewer, "POST", "/song-versions", { title: `Reviewer Song ${stamp}`, language: "en", artists: ["R"] });
const sub4 = (await api(reviewer, "POST", `/song-versions/${reviewersSong.id}/submissions`, {})).id;
r = await call(reviewer, "POST", `/submissions/${sub4}/approve`, {});
check("reviewers can't approve their own", r.status === 403, String(r.status));
r = await call(bob, "GET", `/submissions/${sub4}`);
check("others can't read someone's submission", r.status === 403, String(r.status));
r = await call(admin, "POST", `/submissions/${sub4}/approve`, {});
check("a global admin can", r.status === 201 && r.body.state === "APPROVED");

// --- global admins publish their own songs directly, when they choose to
const adminSong = await api(admin, "POST", "/song-versions", { title: `Admin Song ${stamp}`, language: "en", artists: ["Admin"] });
check("an admin's song isn't global by default", adminSong.ownerScope === "USER");
r = await call(admin, "GET", `/song-versions/${adminSong.id}/publication`);
check("admins get the direct option", r.body.canPublishDirectly === true);
r = await call(admin, "POST", `/song-versions/${adminSong.id}/publish`, {});
check("publish directly", r.status === 201 && r.body.state === "APPROVED" && r.body.reviewer?.id === admin.id && !!r.body.publishedVersionId);
check("visible to everyone", (await call(bob, "GET", `/song-versions/${r.body.publishedVersionId}`)).status === 200);

// --- the reviewer role can be taken away
await call(admin, "PUT", `/admin/users/${reviewer.id}/roles`, { roleIds: [] });
r = await call(reviewer, "GET", "/submissions");
check("removing the role closes the queue", r.status === 403, String(r.status));

// --- deleting a song with submissions, or the global copy
r = await call(bob, "DELETE", `/song-versions/${other.id}`);
check("a song with submissions can be deleted", r.status === 204, String(r.status));
const adminPublished = sql(`select "publishedVersionId" from "Submission" where "songVersionId"='${adminSong.id}'`);
check("published in place", adminPublished === adminSong.id);
r = await call(admin, "DELETE", `/song-versions/${adminSong.id}`);
check("a global song can be deleted", r.status === 204, String(r.status));

// --- accounts: a transfer moves open submissions with the songs; deleting works
const carol = await user("Pub carol");
const carolSong = await api(carol, "POST", "/song-versions", { title: `Carol Song ${stamp}`, language: "en", artists: ["Carol"] });
const sub5 = (await api(carol, "POST", `/song-versions/${carolSong.id}/submissions`, {})).id;
r = await call(admin, "POST", `/admin/users/${carol.id}/delete`, { contentAction: "transfer", retentionDays: 7 });
const dave = await user("Pub dave");
r = await call(dave, "POST", `/transfers/${r.body.transferUrl.split("/").pop()}/claim`);
check("claiming the songs of someone with a submission", r.status === 204, String(r.status));
check("the submission moves with the song", sql(`select "submitterId" from "Submission" where id='${sub5}'`) === dave.id);
check("the new owner can withdraw it", (await call(dave, "POST", `/submissions/${sub5}/withdraw`)).body?.state === "WITHDRAWN");
r = await call(admin, "POST", `/admin/users/${bob.id}/delete`, { contentAction: "delete" });
check("deleting a submitter with everything they own", r.status === 201, String(r.status));
r = await call(admin, "POST", `/admin/users/${reviewer.id}/delete`, { contentAction: "delete" });
check("deleting a reviewer", r.status === 201, String(r.status));
check("their reviews stay, unattributed", sql(`select coalesce("reviewerId", 'none') from "Submission" where id='${sub1}'`) === "none");

finish();
