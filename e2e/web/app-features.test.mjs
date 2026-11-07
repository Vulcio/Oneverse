// What the installed web app does with the device (issue #407): the share
// sheet for a song, a set's link and a team's invite link; Share to
// Songverse from another app (the manifest's `share_target`, received by the
// service worker): a chart becomes a new song, any file goes on a song one
// picks, a Songverse link opens; and a file opened with Songverse on a
// computer (`file_handlers`, `launchQueue`). The badge on the icon is in
// web/notifications; persistent storage is asked only in the installed app.
import { chromium } from "playwright";
import { WEB, api, check, finish, signIn, stamp, stepper, user } from "../lib/harness.mjs";

let page;
const step = stepper(() => page);

// --- the manifest
const manifest = await (await fetch(`${WEB}/manifest.webmanifest`)).json();
const target = manifest.share_target;
check(
  "Share to Songverse: files, words and links, posted to the service worker",
  target?.action === "/share-target" && target.method === "POST" && target.enctype === "multipart/form-data" && target.params.files[0].name === "files" && target.params.text === "text" && target.params.url === "url",
  JSON.stringify(target),
);
check("ChordPro files and PDFs open with it on a computer", manifest.file_handlers?.[0]?.action === "/import" && manifest.file_handlers[0].accept["text/plain"].includes(".cho"), JSON.stringify(manifest.file_handlers));

const me = await user("Sharer");
const song = await api(me, "POST", "/song-versions", { title: `Target ${stamp}`, language: "en", artists: ["Band"], content: "[G]Hello [C]world\n", contentFormat: "CHORDPRO" });
const set = await api(me, "POST", "/setlists", { name: `Shared set ${stamp}` });
const team = await api(me, "POST", "/teams", { name: `Sharers ${stamp}` });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// The device's share sheet, as the page asks for it.
await context.addInitScript(() => {
  window.__shared = [];
  navigator.share = async (data) => void window.__shared.push(data);
  navigator.canShare = () => true;
});
page = await context.newPage();
await signIn(page, me);
const lastShared = () => page.waitForFunction(() => window.__shared.at(-1) ?? null).then((handle) => handle.jsonValue());

await step("a song's More menu: Share… with its title and address", async () => {
  await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
  await page.goto(`${WEB}/library/${song.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("practice-more").click();
  await page.getByTestId("practice-menu-share").click();
  const shared = await lastShared();
  if (shared.title !== `Target ${stamp}` || shared.url !== `${WEB}/library/${song.id}`) throw new Error(JSON.stringify(shared));
});

await step("a set's share link, beside Copy link", async () => {
  await page.evaluate(() => (window.__shared = []));
  await page.goto(`${WEB}/sets/${set.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Create a share link" }).click();
  await page.getByTestId("share-button").click();
  const shared = await lastShared();
  if (shared.title !== `Shared set ${stamp}` || !shared.url.startsWith(`${WEB}/set-invite/`)) throw new Error(JSON.stringify(shared));
});

await step("a team's invite link", async () => {
  await page.evaluate(() => (window.__shared = []));
  await page.goto(`${WEB}/teams/${team.id}`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("invite-link-create").click();
  await page.getByTestId("invite-link-url").waitFor();
  await page.getByTestId("share-button").first().click();
  const shared = await lastShared();
  if (shared.title !== `Sharers ${stamp}` || !shared.url.startsWith(`${WEB}/join/`)) throw new Error(JSON.stringify(shared));
});

/** Shares to Songverse as Android does: a form posted to the share target, the service worker answering. */
async function shareToSongverse({ files = [], title = "", text = "", url = "" }) {
  await page.goto(`${WEB}/library`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  await page.evaluate(
    ({ files, title, text, url }) => {
      const form = document.createElement("form");
      form.method = "post";
      form.enctype = "multipart/form-data";
      form.action = "/share-target";
      for (const [name, value] of Object.entries({ title, text, url })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
      const input = document.createElement("input");
      input.type = "file";
      input.name = "files";
      input.multiple = true;
      const list = new DataTransfer();
      for (const file of files) list.items.add(new File([file.content], file.name, { type: file.type }));
      input.files = list.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    },
    { files, title, text, url },
  );
}

await step("shared from another app: a ChordPro chart becomes a new song", async () => {
  await shareToSongverse({ files: [{ name: "shared.cho", type: "text/plain", content: `{title: Shared ${stamp}}\n[G]Shared [D]line\n` }] });
  await page.waitForURL(`${WEB}/import?shared=1`);
  await page.getByTestId("import-file").filter({ hasText: "shared.cho" }).waitFor();
  await page.getByTestId("import-new-song").click();
  await page.waitForURL(`${WEB}/library/new`);
  await page.waitForFunction(() => document.querySelector("#song-content")?.value.includes("[G]Shared [D]line"));
});

await step("…any file goes on a song one picks", async () => {
  await shareToSongverse({ files: [{ name: `notes-${stamp}.txt`, type: "text/plain", content: "Capo 2 on the bridge" }] });
  await page.waitForURL(`${WEB}/import?shared=1`);
  await page.getByTestId("import-attach").click();
  await page.getByTestId("import-song-search").fill(`Target ${stamp}`);
  await page.getByTestId("import-song").filter({ hasText: `Target ${stamp}` }).click();
  await page.waitForURL(`${WEB}/library/${song.id}?tab=files`);
  const files = await api(me, "GET", `/song-versions/${song.id}/attachments`);
  if (!files.some((file) => file.filename === `notes-${stamp}.txt`)) throw new Error(JSON.stringify(files.map((file) => file.filename)));
});

await step("…words become a new song too, and a Songverse link opens its page", async () => {
  await shareToSongverse({ title: "Words", text: "[A]Shared words" });
  await page.waitForURL(`${WEB}/import?shared=1`);
  await page.getByTestId("import-file").filter({ hasText: "Words.txt" }).waitFor();
  await shareToSongverse({ url: `${WEB}/sets/${set.id}` });
  await page.waitForURL(`${WEB}/sets/${set.id}`);
});

await step("opened with Songverse on a computer: the file is offered the same way", async () => {
  const opened = await context.newPage();
  await opened.addInitScript(() => {
    window.launchQueue = { setConsumer: (consumer) => void (window.__launch = consumer) };
  });
  await opened.goto(`${WEB}/import`);
  await opened.getByTestId("import-nothing").waitFor();
  await opened.evaluate(() => window.__launch({ files: [{ getFile: async () => new File(["{title: Opened}\n[C]Opened\n"], "opened.cho", { type: "text/plain" }) }] }));
  await opened.getByTestId("import-file").filter({ hasText: "opened.cho" }).waitFor();
  await opened.close();
});

await browser.close();
finish();
