// Bibles imported for the suites (issue #301): a Zefania file uploaded by an
// admin, read by the Worker.
import { API, api } from "./harness.mjs";

/** A small Zefania Bible: John 3:16-18 and Psalm 23:1-2, public domain. */
export function zefania(name, abbreviation) {
  return `<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE biblename="${name}">
  <INFORMATION><identifier>${abbreviation}</identifier><language>en</language><rights>Public Domain</rights></INFORMATION>
  <BIBLEBOOK bnumber="43" bname="John">
    <CHAPTER cnumber="3">
      <VERS vnumber="16">For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.</VERS>
      <VERS vnumber="17">For God sent not his Son into the world to condemn the world.</VERS>
      <VERS vnumber="18">He that believeth on him is not condemned.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
  <BIBLEBOOK bnumber="19" bname="Psalms">
    <CHAPTER cnumber="23">
      <VERS vnumber="1">The LORD is my shepherd; I shall not want.</VERS>
      <VERS vnumber="2">He maketh me to lie down in green pastures.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
</XMLBIBLE>`;
}

/** Uploads a Bible file as `admin`; the answer as it is (201 and the Bible, importing). */
export function uploadBible(admin, body, filename = "bible.xml") {
  const form = new FormData();
  form.append("file", new Blob([body], { type: "application/xml" }), filename);
  return fetch(`${API}/admin/scriptures/bibles`, { method: "POST", headers: { Authorization: `Bearer ${admin.bearer}` }, body: form });
}

/** The Bible once the Worker has read it (or failed to), as Admin > Bibles lists it. */
export async function importedBible(admin, id) {
  for (let i = 0; i < 60; i++) {
    const found = (await api(admin, "GET", "/admin/scriptures/bibles")).find((bible) => bible.id === id);
    if (found?.status !== "IMPORTING") return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("still importing");
}

/** A Bible imported and ready, with the rights given (`{ canProject: true }`). */
export async function importBible(admin, name, abbreviation, rights = {}) {
  const started = await (await uploadBible(admin, zefania(name, abbreviation))).json();
  const bible = await importedBible(admin, started.id);
  if (bible?.status !== "READY") throw new Error(`not imported: ${JSON.stringify(bible)}`);
  return Object.keys(rights).length ? api(admin, "PATCH", `/admin/scriptures/bibles/${bible.id}`, rights) : bible;
}
