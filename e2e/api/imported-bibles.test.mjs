// Imported Bibles (issue #301): an admin uploads a Bible file, the Worker
// converts it, and its passages are read by reference by anyone signed in;
// what it may be used for is off until the admin says. A file that isn't a
// Bible fails, with why; deleting one removes its verses.
import { API, api, call, check, finish, sql, stamp, user } from "../lib/harness.mjs";

const admin = await user("Bible importer");
sql(`update "User" set "isGlobalAdmin"=true where id='${admin.id}'`);
const reader = await user("Bible reader");

const ZEFANIA = `<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE biblename="E2E Bible ${stamp}">
  <INFORMATION><identifier>E2E</identifier><language>en</language><rights>Public Domain</rights></INFORMATION>
  <BIBLEBOOK bnumber="43" bname="John">
    <CHAPTER cnumber="3">
      <VERS vnumber="16">For God so loved the world.</VERS>
      <VERS vnumber="17">For God sent not his Son.</VERS>
      <VERS vnumber="18">He that believeth on him.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
  <BIBLEBOOK bnumber="19" bname="Psalms">
    <CHAPTER cnumber="23"><VERS vnumber="1">The LORD is my shepherd.</VERS></CHAPTER>
  </BIBLEBOOK>
</XMLBIBLE>`;

const upload = (who, body, filename) => {
  const form = new FormData();
  form.append("file", new Blob([body], { type: "application/xml" }), filename);
  return fetch(`${API}/admin/scriptures/bibles`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form });
};
async function imported(id) {
  for (let i = 0; i < 60; i++) {
    const found = (await api(admin, "GET", "/admin/scriptures/bibles")).find((bible) => bible.id === id);
    if (found?.status !== "IMPORTING") return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("still importing");
}

check("only an admin imports a Bible", (await upload(reader, ZEFANIA, "bible.xml")).status === 403);

let res = await upload(admin, ZEFANIA, "e2e.xml");
const started = await res.json();
check("an admin uploads a Bible file: importing", res.status === 201 && started.status === "IMPORTING", JSON.stringify(started));
check("not listed for others while it imports", !(await api(reader, "GET", "/scriptures/bibles")).some((bible) => bible.id === started.id));

const bible = await imported(started.id);
check("the Worker imports it: its details from the file", bible?.status === "READY" && bible.name === `E2E Bible ${stamp}` && bible.verseCount === 4 && bible.sourceFormat === "zefania" && bible.copyright === "Public Domain", JSON.stringify(bible));
check("its books, as it names them", JSON.stringify(bible.books.map((book) => [book.number, book.name, book.chapters])) === JSON.stringify([[19, "Psalms", 23], [43, "John", 3]]), JSON.stringify(bible.books));
check("its rights all off until the admin says", !bible.rights.projection && !bible.rights.offline && !bible.rights.export);
check("its file is gone once read", sql(`select count(*) from "Bible" where id='${bible.id}' and "sourceStorageKey" is not null`) === "0");

const listed = (await api(reader, "GET", "/scriptures/bibles")).find((one) => one.id === bible.id);
check("anyone signed in sees it", !!listed && listed.rights.projection === false);

let passage = await api(reader, "GET", `/scriptures/bibles/${bible.id}/passage?${new URLSearchParams({ reference: "Jn 3:16-17" })}`);
check(
  "a passage by reference, with its copyright line",
  passage.reference === "John 3:16-17" && passage.chapters.length === 1 && passage.chapters[0].verses.map((verse) => verse.number).join() === "16,17" && passage.bible.copyright === "Public Domain",
  JSON.stringify(passage),
);
passage = await api(reader, "GET", `/scriptures/bibles/${bible.id}/passage?${new URLSearchParams({ reference: "Psaume 23,1" })}`);
check("written as French writes it", passage.chapters?.[0]?.verses?.[0]?.text === "The LORD is my shepherd.", JSON.stringify(passage));
check("a book it lacks: not found", (await call(reader, "GET", `/scriptures/bibles/${bible.id}/passage?${new URLSearchParams({ reference: "Romans 8:28" })}`)).status === 404);
check("verses it lacks: not found", (await call(reader, "GET", `/scriptures/bibles/${bible.id}/passage?${new URLSearchParams({ reference: "John 4:1" })}`)).status === 404);
res = await call(reader, "GET", `/scriptures/bibles/${bible.id}/passage?${new URLSearchParams({ reference: "not a passage" })}`);
check("a reference it can't read: 400, said why", res.status === 400 && res.body.message.some((line) => line.startsWith("reference must be")), JSON.stringify(res.body));

check("only an admin changes it", (await call(reader, "PATCH", `/admin/scriptures/bibles/${bible.id}`, { canProject: true })).status === 403);
const changed = await api(admin, "PATCH", `/admin/scriptures/bibles/${bible.id}`, { abbreviation: "E2E", canProject: true });
check("the admin lets it be projected and names it", changed.rights.projection && !changed.rights.offline && changed.abbreviation === "E2E" && changed.copyright === "Public Domain", JSON.stringify(changed));
check("an unknown field is refused", (await call(admin, "PATCH", `/admin/scriptures/bibles/${bible.id}`, { canPrint: true })).status === 400);
check("its copyright cleared with an empty string", (await api(admin, "PATCH", `/admin/scriptures/bibles/${bible.id}`, { copyright: "" })).copyright === null);

res = await upload(admin, "<html><body>not a Bible</body></html>", "page.xml");
const failed = await imported((await res.json()).id);
check("a file that isn't a Bible fails, with why", failed?.status === "FAILED" && /Zefania, Beblia, OSIS or json-bible/.test(failed.error ?? ""), JSON.stringify(failed));
check("deleting a failed import", (await call(admin, "DELETE", `/admin/scriptures/bibles/${failed.id}`)).status === 204);

check("only an admin deletes it", (await call(reader, "DELETE", `/admin/scriptures/bibles/${bible.id}`)).status === 403);
check("the admin deletes it", (await call(admin, "DELETE", `/admin/scriptures/bibles/${bible.id}`)).status === 204);
check("its verses with it", sql(`select count(*) from "BibleVerse" where "bibleId"='${bible.id}'`) === "0");
check("gone for everyone", (await call(reader, "GET", `/scriptures/bibles/${bible.id}/passage?reference=John%203:16`)).status === 404);
finish();
