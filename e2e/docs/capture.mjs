// Demo content and the docs' screenshots, in each language (run by
// screenshots.mjs, which starts a fresh copy of the app for it). The songs
// are in the public domain.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, PLANIVERSE, WEB, api, signIn, sql, user } from "../lib/harness.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/docs/src/assets/screenshots");
const STEMS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/stems");

const SONGS = [
  {
    title: "Amazing Grace",
    artists: ["John Newton"],
    key: "G",
    tempo: 72,
    capo: 3,
    content: `{start_of_verse: Verse 1}
[G]Amazing [G7]grace! How [C]sweet the [G]sound
That [G]saved a [Em]wretch like [D]me!
I [G]once was [G7]lost, but [C]now am [G]found;
Was [Em]blind, but [D]now I [G]see.
{end_of_verse}

{start_of_verse: Verse 2}
'Twas [G]grace that [G7]taught my [C]heart to [G]fear,
And [G]grace my [Em]fears re[D]lieved;
How [G]precious [G7]did that [C]grace ap[G]pear
The [Em]hour I [D]first be[G]lieved!
{end_of_verse}
`,
  },
  {
    title: "Be Thou My Vision",
    artists: ["Traditional Irish"],
    key: "D",
    tempo: 84,
    content: `{start_of_verse}
[D]Be Thou my [G]Vision, O [D]Lord of my [A]heart;
[Bm]Naught be all [G]else to me, [D]save that Thou [A]art.
[G]Thou my best [A]Thought, by [Bm]day or by [G]night,
[D]Waking or [G]sleeping, Thy [D]presence my [A]light.
{end_of_verse}
`,
  },
  {
    title: "Holy, Holy, Holy",
    artists: ["Reginald Heber"],
    key: "D",
    tempo: 92,
    content: `{start_of_verse}
[D]Holy, holy, [Bm]holy! [G]Lord God Al[D]mighty!
Early in the [Bm]morning our [E]song shall rise to [A]Thee;
[D]Holy, holy, [Bm]holy, [G]merciful and [D]mighty!
[G]God in three [D]Persons, [Bm]bless[A]ed [D]Trinity!
{end_of_verse}
`,
  },
];

const LOCALES = {
  en: { user: "Alex Martin", email: "alex.martin@example.com", bandmate: "Sam Taylor", guest: "Jordan Kim", friend: "Chris Lane", asking: "Taylor Reed", reviewer: "Robin Lee", why: "It's 'relieved', with one l.", team: "Morning Band", set: "Sunday service", arrangement: "Sunday band", songbook: "Hymns", note: "Softly, piano only", addedLine: "Sing it a|gain", service: "Morning service", rehearsal: "Rehearsal", hall: "Main hall", zone: "Europe/London", organization: "Grace Church", welcome: "Welcome team", greeter: "Greeter", coffee: "Coffee", brand: "Sunday mornings", brandColors: ["Primary", "Secondary", "Accent"] },
  fr: { user: "Camille Durand", email: "camille.durand@example.com", bandmate: "Hugo Petit", guest: "Lucas Martin", friend: "Chloe Bernard", asking: "Emma Roux", reviewer: "Alice Moreau", why: "C'est « relieved », avec un seul l.", team: "Groupe du matin", set: "Culte du dimanche", arrangement: "Groupe du dimanche", songbook: "Cantiques", note: "Doucement, piano seul", addedLine: "Chante-le en|core", service: "Culte du matin", rehearsal: "Répétition", hall: "Grande salle", zone: "Europe/Paris", organization: "Église de la Grâce", welcome: "Équipe d'accueil", greeter: "Accueil", coffee: "Café", brand: "Dimanche matin", brandColors: ["Principale", "Secondaire", "Accent"] },
};

const nextSunday = () => {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
  return date.toISOString().slice(0, 10);
};

// A fake microphone, for the recorder (issue #123): someone singing at a
// good level (issue #141), a held note swelling and fading - not Chromium's
// own beeps, which are loud enough to clip.
function singing() {
  const rate = 48000;
  const samples = new Int16Array(rate * 4);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    samples[i] = Math.round(Math.sin(2 * Math.PI * 220 * t) * (0.2 + 0.15 * Math.sin(Math.PI * t)) * 32767);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length * 2, 40);
  const file = path.join(tmpdir(), "songverse-docs-singing.wav");
  writeFileSync(file, Buffer.concat([header, Buffer.from(samples.buffer)]));
  return file;
}
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${singing()}`] });
try {
  for (const [locale, text] of Object.entries(LOCALES)) {
    console.log(`\n${locale}`);
    const dir = path.join(OUT, locale);
    mkdirSync(dir, { recursive: true });

    // --- the demo content
    const me = await user(text.user);
    // A plain address rather than the harness's random one, since it shows on some pages.
    sql(`update "User" set locale='${locale}', email='${text.email}' where id='${me.id}'`);
    me.email = text.email;
    const team = await api(me, "POST", "/teams", { name: text.team });
    const songs = [];
    for (const song of SONGS) {
      songs.push(await api(me, "POST", "/song-versions", { ...song, language: "en", contentFormat: "CHORDPRO", teamId: team.id }));
    }
    const grace = songs[0];
    // The Library's home (issue #81): songs looked at lately, and a favorite.
    for (const song of [...songs].reverse()) await api(me, "POST", `/song-versions/${song.id}/views`);
    await api(me, "PUT", `/song-versions/${grace.id}/favorite`);
    // Its history (issue #71) spread over a few days, as saves minutes apart are one step.
    const earlier = (hours) =>
      sql(`update "SongVersionRevision" set "createdAt" = "createdAt" - interval '${hours} hours', "updatedAt" = "updatedAt" - interval '${hours} hours' where "songVersionId" = '${grace.id}'`);
    earlier(26);
    // Sung again at the end, a tone higher.
    const doc = (await api(me, "GET", `/song-versions/${grace.id}`)).documentJson;
    const flow = [...doc.flow, { id: "fi_last", sectionId: doc.sections[0].id, label: null, keyChange: { steps: 2, key: "A" }, note: null }];
    await api(me, "PATCH", `/song-versions/${grace.id}`, { flow, revision: doc.revision });
    earlier(20);
    // A bandmate, also a team admin, fixes a chord and fills in the rights.
    const bandmate = await user(text.bandmate);
    sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "updatedAt") values ('tm-docs-${locale}', '${team.id}', '${bandmate.id}', 'ADMIN', now())`);
    const fixed = (await api(bandmate, "GET", `/song-versions/${grace.id}`)).documentJson;
    await api(bandmate, "PATCH", `/song-versions/${grace.id}`, {
      content: SONGS[0].content.replace("wretch like [D]me!", "wretch like [D7]me!"),
      contentFormat: "CHORDPRO",
      copyright: "Public domain",
      revision: fixed.revision,
    });
    earlier(2);

    // The band's usual arrangement: a tone up, capo 2, a replaced chord, a hidden one, a note and an added line.
    let arrangement = await api(me, "POST", `/song-versions/${grace.id}/arrangements`, { name: text.arrangement, teamId: team.id });
    const song = (await api(me, "GET", `/song-versions/${grace.id}`)).documentJson;
    const [verse1, verse2] = song.sections;
    const document = structuredClone(arrangement.document);
    document.defaults = { ...document.defaults, transposeSteps: 2, capo: 2, tempo: 76 };
    // Key changes are named in the arrangement's key (the editor renames them when its key changes).
    document.items[2].keyChange = { steps: 2, key: "B" };
    document.items[0].overrides = [
      { type: "chord", chordId: verse1.lines[0].chords[1].id, raw: "G/B" },
      { type: "performance_note", lineId: verse1.lines[0].id, note: text.note },
    ];
    // A line only this version sings (#24), with its chords.
    const [before, after] = text.addedLine.split("|");
    document.items[1].overrides = [
      { type: "hide_chord", chordId: verse2.lines[1].chords[1].id },
      {
        type: "insert_line",
        afterLineId: verse2.lines[verse2.lines.length - 1].id,
        line: { id: "ins_line_docs", kind: "lyric", text: before + after, chords: [{ id: "ins_chd_docs1", at: 0, raw: "G" }, { id: "ins_chd_docs2", at: before.length, raw: "D" }] },
      },
    ];
    arrangement = await api(me, "PATCH", `/arrangements/${arrangement.id}`, { document, updatedAt: arrangement.updatedAt });
    arrangement = await api(me, "PATCH", `/arrangements/${arrangement.id}`, { isTeamDefault: true, updatedAt: arrangement.updatedAt });

    // Its stems, for the Practice player.
    for (const [file, stemPart] of [["Morning Light - Vocals.opus", "VOCALS"], ["03 drums.mp3", "DRUMS"], ["Morning Light - Bass.mp3", "BASS"], ["track4.opus", "KEYS"]]) {
      const form = new FormData();
      form.append("type", "AUDIO");
      form.append("stemPart", stemPart);
      // The band's to share (issue #72).
      form.append("visibility", "TEAM");
      form.append("teamId", team.id);
      form.append("file", new Blob([readFileSync(path.join(STEMS, file))], { type: "application/octet-stream" }), file);
      await fetch(`${API}/song-versions/${grace.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
    }
    // Where its sections start in them (issue #110): the verses, then the first again.
    const cueDoc = (await api(me, "GET", `/song-versions/${grace.id}`)).documentJson;
    const cuePoints = cueDoc.flow.map((pass, index) => ({ at: index * 6.5, sectionId: pass.sectionId }));
    for (const file of await api(me, "GET", `/song-versions/${grace.id}/attachments`)) {
      if (file.stemPart) await api(me, "PATCH", `/song-versions/${grace.id}/attachments/${file.id}`, { cuePoints });
    }

    {
      const form = new FormData();
      form.append("type", "AUDIO");
      form.append("file", new Blob([readFileSync(path.join(STEMS, "Morning Light - Vocals.opus"))], { type: "application/octet-stream" }), locale === "fr" ? "Ma prise.opus" : "My take.opus");
      await fetch(`${API}/song-versions/${grace.id}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${me.bearer}` }, body: form });
    }

    const set = await api(me, "POST", "/setlists", { name: text.set, eventDate: nextSunday(), teamId: team.id });
    for (const { id } of songs) await api(me, "POST", `/setlists/${set.id}/items`, { songVersionId: id });
    const items = (await api(me, "GET", `/setlists/${set.id}`)).items;

    const songbook = await api(me, "POST", "/songbooks", { name: text.songbook, kind: "NUMBERED", abbreviation: locale === "fr" ? "CA" : "HY" });
    for (const [i, { id }] of songs.entries()) await api(me, "POST", `/songbooks/${songbook.id}/entries`, { songVersionId: id, entryCode: String(i + 1) });

    // An artist's bio (issue #86), as a global admin would write it: the providers aren't reachable here.
    for (let i = 0; i < 40 && !(await api(me, "GET", "/artists/detail?name=John%20Newton")).lookedUp; i++) await new Promise((r) => setTimeout(r, 250));
    const newton = sql(`select id from "Artist" where key = 'john newton'`);
    const bios = {
      en: "John Newton (1725–1807) was an English sailor, slave-ship captain and, after his conversion, an Anglican clergyman and abolitionist. He wrote the words of Amazing Grace for a New Year's service in Olney in 1773.",
      fr: "John Newton (1725-1807) fut marin, capitaine de navire négrier puis, après sa conversion, pasteur anglican et abolitionniste. Il écrivit les paroles d'Amazing Grace pour un culte du Nouvel An à Olney, en 1773.",
    };
    for (const [language, bio] of Object.entries(bios)) {
      sql(`insert into "ArtistBio" (id, "artistId", language, text, custom, "updatedAt") values ('bio-docs-${language}', '${newton}', '${language}', '${bio.replace(/'/g, "''")}', true, now()) on conflict ("artistId", language) do update set text = excluded.text, custom = true`);
    }

    // --- the screenshots
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: locale === "fr" ? "fr-FR" : "en-US", colorScheme: "light", permissions: ["microphone"] });
    let page = await context.newPage();
    await signIn(page, me);
    const shoot = async (name, url, ready, options = {}) => {
      if (url) {
        await page.goto(`${WEB}${url}`);
        await page.waitForLoadState("networkidle");
      }
      if (ready) await ready();
      await page.waitForTimeout(300);
      const target = options.element ?? page;
      await target.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 85, fullPage: options.fullPage ?? false });
      console.log(`  ${name}`);
    };

    await shoot("dashboard", "/dashboard");
    await shoot("library", "/library");
    await shoot("songs", "/library/songs", () => page.getByTestId("library-range").waitFor());
    await shoot("artists", "/library/artists", () => page.getByTestId("artist-list").waitFor());
    await shoot("artist", "/library/artists/John%20Newton", () => page.getByTestId("artist-bio").waitFor());
    await shoot("search", null, async () => {
      await page.keyboard.press("Control+k");
      // A letter in something of every kind in the demo content, in both languages.
      await page.getByRole("combobox").fill("n");
      await page.getByRole("group", { name: /Teams|Équipes/ }).waitFor();
    });
    await page.keyboard.press("Escape");
    await shoot("song-info", `/library/${grace.id}`);
    await shoot("song-editor", `/library/${grace.id}?tab=editor`, () => page.locator(".ProseMirror").waitFor());
    await shoot("song-order", null, null, { element: page.getByTestId("song-order") });
    // Who sees each file (issue #72): the stems shared with the band, a recording kept to oneself.
    await shoot("song-files", `/library/${grace.id}?tab=audio`, () => page.getByTestId("audio-list").waitFor());
    // Recording a part into the stems (issue #123): the dialog, ready.
    await shoot("recorder", null, async () => {
      await page.getByTestId("record-part").first().click();
      await page.locator('[data-testid="recorder"][data-phase="ready"]').waitFor();
    }, { element: page.getByTestId("recorder") });
    await page.keyboard.press("Escape");
    await page.getByTestId("recorder").waitFor({ state: "detached" });
    await shoot("song-history", `/library/${grace.id}?tab=history`, () => page.getByTestId("history-chart-diff").waitFor());
    await shoot("versions", `/library/${grace.id}?tab=arrangements`, () => page.getByTestId("arrangement-list").waitFor());
    await shoot("version-editor", `/library/${grace.id}/arrangements/${arrangement.id}`, () => page.locator("[data-pass-editor]").first().waitFor(), { fullPage: true });
    await shoot("set", `/sets/${set.id}`, () => page.getByTestId("set-song-row").first().waitFor());
    // Notes (issue #256): the band's on a chord, the set's after a verse with a reply, one's own on the song.
    {
      const graceDoc = (await api(me, "GET", `/song-versions/${grace.id}`)).documentJson;
      const [verse1, verse2] = graceDoc.sections;
      const line = verse1.lines[0];
      const fr = locale === "fr";
      await api(me, "POST", "/notes", { songVersionId: grace.id, content: fr ? "Laisser sonner" : "Let ring", place: "TEAM", teamId: team.id, anchor: { kind: "chord", sectionId: verse1.id, lineId: line.id, chordId: line.chords[1].id } });
      const setNote = await api(me, "POST", "/notes", { songVersionId: grace.id, content: fr ? "Piano seul sur ce couplet" : "Piano only on this verse", place: "SET", setlistId: set.id, anchor: { kind: "section", sectionId: verse2.id, passId: graceDoc.flow.find((pass) => pass.sectionId === verse2.id).id } });
      await api(me, "POST", `/notes/${setNote.id}/replies`, { content: fr ? "Je reprends au refrain" : "I'll come back in on the last line" });
      await api(me, "POST", "/notes", { songVersionId: grace.id, content: fr ? "Capo 3, commencer doucement" : "Capo 3, start soft", place: "ME" });
    }
    await shoot("set-song", `/sets/${set.id}/songs/${items[0].id}`, () => page.locator("[data-note-id]").first().waitFor(), { fullPage: true });
    // Notes in the margin (issue #264): numbered, a line to what each is on.
    {
      const margin = { notesPlacement: "margin", notesLook: "minimal", notesSize: "M", notesColor: "amber" };
      await api(me, "PATCH", "/users/me", { displaySettings: { EDIT: margin, PRACTICE: margin, LIVE: margin } });
      await shoot("notes-margin", `/sets/${set.id}/songs/${items[0].id}`, () => page.locator("[data-note-connector]").first().waitFor({ state: "attached" }), { element: page.getByTestId("song-chart") });
      const back = { notesPlacement: null, notesLook: null, notesSize: null, notesColor: null };
      await api(me, "PATCH", "/users/me", { displaySettings: { EDIT: back, PRACTICE: back, LIVE: back } });
    }
    // The Display panel (issue #209), on a phone: the bottom of the screen, the chart still in view.
    await page.setViewportSize({ width: 390, height: 844 });
    // Adding a note on a word, on a phone (issue #256): where it's saved says who sees it.
    await shoot("notes", `/sets/${set.id}/songs/${items[0].id}`, async () => {
      const word = page.getByTestId("song-chart").locator("[data-line] [data-at]", { hasText: locale === "fr" ? "grace" : "grace" }).first();
      await word.scrollIntoViewIfNeeded();
      const box = await word.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
      await page.getByTestId("add-note-input").fill(locale === "fr" ? "Tenir jusqu'à la ligne suivante" : "Hold it into the next line");
    });
    await page.keyboard.press("Escape");
    await shoot("display", `/sets/${set.id}/songs/${items[0].id}`, async () => {
      await page.locator("[data-pass]").first().waitFor();
      await page.getByTestId("display-open").click();
      await page.getByTestId("display-section").click();
      await page.getByTestId("display-section-chords").click();
      await page.getByTestId("display-notation-LETTERS").waitFor();
    });
    await page.getByTestId("display-close").click();
    await page.setViewportSize({ width: 1280, height: 800 });
    // A second row of chords (issue #230): letters with Roman numerals under them.
    const rows = { secondRow: { names: "ROMAN" } };
    await api(me, "PATCH", "/users/me", { displaySettings: { EDIT: rows, PRACTICE: rows } });
    await shoot("chord-rows", `/sets/${set.id}/songs/${items[0].id}`, async () => {
      await page.locator("[data-chord-second]").first().waitFor();
      // Clear of the sticky header.
      await page.locator("[data-pass]").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    }, {
      element: page.locator("[data-pass]").first(),
    });
    await api(me, "PATCH", "/users/me", { displaySettings: { EDIT: { secondRow: null }, PRACTICE: { secondRow: null } } });
    // Sync play (issue #13): on, leading, its menu open; then ended and off, for the rest.
    const syncControl = page.getByTestId("sync-control");
    const syncItem = (name) => page.getByTestId("sync-menu").getByRole("menuitem", { name });
    await shoot("sync", `/sets/${set.id}`, async () => {
      await syncControl.click();
      await syncItem(/^(Turn sync on|Activer la synchro)$/).click();
      await page.locator('[data-testid="sync-control"][data-state-sync="on"]').waitFor();
      await syncControl.click();
      await syncItem(/^(Lead the set|Mener la liste)$/).click();
      await page.locator('[data-testid="sync-control"][data-state-sync="leading"]').waitFor();
      await syncControl.click();
      await page.getByTestId("sync-members").waitFor();
    });
    await syncItem(/^(End the session|Terminer la session)$/).click();
    await syncControl.click();
    await syncItem(/^(Turn sync off|Désactiver la synchro)$/).click();
    // Live mode (it's remembered, so back to Edit for the rest).
    await shoot("live", `/sets/${set.id}/live/${items[0].id}`, () => page.locator("[data-pass]").first().waitFor());
    // Floating controls over the chart (issue #224), then back to the footer.
    await api(me, "PATCH", "/users/me", { displaySettings: { LIVE: { controls: "floating" } } });
    await shoot("live-floating", `/sets/${set.id}/live/${items[0].id}`, () => page.locator('[data-testid="live-controls"][data-layout="floating"]:not([data-faded])').waitFor());
    await api(me, "PATCH", "/users/me", { displaySettings: { LIVE: { controls: null } } });
    // Screens (issue #186): a big screen showing its code, paired from /screens, then the set presented from Live.
    const tvContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: locale === "fr" ? "fr-FR" : "en-US" });
    const tv = await tvContext.newPage();
    const shootTv = async (name) => {
      await tv.waitForTimeout(500);
      await tv.screenshot({ path: path.join(dir, `${name}.jpg`), type: "jpeg", quality: 85 });
      console.log(`  ${name}`);
    };
    await tv.goto(`${WEB}/screen`);
    await tv.getByTestId("screen-pairing").waitFor();
    await shootTv("screen-code");
    const screenCode = (await tv.getByTestId("screen-code").innerText()).replace("-", "");
    // A brand (issue #279): its logos, colours and fonts.
    {
      const brand = await api(me, "POST", "/brands", { name: text.brand, teamId: team.id });
      await api(me, "PATCH", `/brands/${brand.id}`, {
        colors: [
          { id: "primary", name: text.brandColors[0], light: "#4f46e5", dark: "#818cf8" },
          { id: "secondary", name: text.brandColors[1], light: "#0f766e", dark: "#5eead4" },
          { id: "accent", name: text.brandColors[2], light: "#d97706", dark: "#fbbf24" },
        ],
        fonts: { heading: { family: "display" }, body: { family: "sans" }, lyrics: { family: "rounded" } },
        website: "https://example.org",
      });
      const logo = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><circle cx="20" cy="20" r="14" fill="${fill}"/><text x="42" y="27" font-family="sans-serif" font-size="18" font-weight="700" fill="${fill}">Morning</text></svg>`);
      await shoot("brand", `/brands/${brand.id}`, async () => {
        // Through the page, which draws an SVG into a PNG.
        for (const [kind, fill] of [["logo", "#4f46e5"], ["logo-dark", "#e0e7ff"]]) {
          await page.getByTestId(`brand-upload-${kind}-input`).setInputFiles({ name: `${kind}.svg`, mimeType: "image/svg+xml", buffer: logo(fill) });
          await page.locator(`[data-testid="brand-logo-${kind}"][data-filled] img`).waitFor();
        }
      });
    }
    // Screen templates (issue #194): the built-in ones, each playing its sample song.
    await shoot(
      "screen-themes",
      "/screens?tab=templates",
      async () => {
        await page.getByTestId("builtin-themes").scrollIntoViewIfNeeded();
        await page.getByTestId("builtin-theme-concert").getByTestId("screen-lyrics").waitFor();
        await page.waitForTimeout(1500);
      },
      { element: page.getByTestId("builtin-themes") },
    );
    // Widgets on a template's grid (issue #268): the Stage display layout in the editor.
    await page.getByTestId("builtin-theme-stage-display").getByTestId("customize-theme").click();
    await shoot(
      "screen-widgets",
      null,
      async () => {
        await page.getByTestId("theme-grid-overlay").getByTestId("grid-widget-countdown").click();
        await page.waitForTimeout(1200);
      },
      { element: page.getByTestId("theme-editor") },
    );
    await page.keyboard.press("Escape");
    await page.getByTestId("theme-editor").waitFor({ state: "detached" });
    // A template's parts (issue #281): the Concert template in the editor, its content, background and effects.
    await shoot(
      "screen-template-parts",
      "/screens?tab=templates",
      async () => {
        await page.getByTestId("builtin-theme-concert").getByTestId("customize-theme").click();
        await page.getByTestId("theme-group-parts").waitFor();
        await page.waitForTimeout(1200);
      },
      { element: page.getByTestId("theme-editor") },
    );
    await page.keyboard.press("Escape");
    await page.getByTestId("theme-editor").waitFor({ state: "detached" });
    // Backgrounds that follow the words (issue #296), among the built-in background themes: the four of them.
    {
      await page.goto(`${WEB}/screens?tab=templates`);
      await page.getByTestId("templates-view-background").click();
      const cards = ["flow", "strings", "grid", "bokeh"].map((id) => page.getByTestId(`builtin-part-${id}`));
      await cards[3].scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(2500);
      const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
      const x = Math.min(...boxes.map((one) => one.x)) - 8;
      const y = Math.min(...boxes.map((one) => one.y)) - 8;
      const right = Math.max(...boxes.map((one) => one.x + one.width)) + 8;
      const bottom = Math.max(...boxes.map((one) => one.y + one.height)) + 8;
      await page.screenshot({ path: path.join(dir, "screen-backgrounds.jpg"), type: "jpeg", quality: 85, clip: { x, y, width: right - x, height: bottom - y } });
      console.log("  screen-backgrounds");
    }
    // A shader background (issue #297): the built-in Mesh gradient, customized, its controls.
    await shoot(
      "screen-shader",
      "/screens?tab=templates",
      async () => {
        await page.getByTestId("templates-view-background").click();
        await page.getByTestId("builtin-part-mesh-gradient").getByTestId("customize-part").click();
        await page.locator('[data-testid="theme-shader-input"][data-name="softness"]').waitFor();
        await page.getByTestId("theme-shader-controls").scrollIntoViewIfNeeded();
        await page.waitForTimeout(1500);
      },
      { element: page.getByTestId("part-editor") },
    );
    await page.keyboard.press("Escape");
    await page.getByTestId("part-editor").waitFor({ state: "detached" });
    // Effects (issue #281): the built-in Concert effects, customized.
    await shoot(
      "screen-effects",
      "/screens?tab=templates",
      async () => {
        await page.getByTestId("templates-view-effects").click();
        await page.getByTestId("builtin-part-concert").getByTestId("customize-part").click();
        await page.getByTestId("theme-group-reactions").waitFor();
        await page.waitForTimeout(1200);
      },
      { element: page.getByTestId("part-editor") },
    );
    await page.keyboard.press("Escape");
    await page.getByTestId("part-editor").waitFor({ state: "detached" });
    await shoot("screens-pair", `/screens?code=${screenCode}&setlistId=${set.id}`, () => page.getByTestId("screen-pair-form").waitFor());
    await page.getByTestId("screen-pair-form").getByRole("button").first().click();
    await page.getByTestId("screen-paired").waitFor();
    await tv.locator('[data-testid="screen-display"][data-state="showing"]').waitFor({ timeout: 15000 });
    await page.goto(`${WEB}/sets/${set.id}/live/${items[0].id}`);
    await syncControl.first().click();
    await syncItem(/^(Turn sync on|Activer la synchro)$/).click();
    await page.locator('[data-testid="sync-control"][data-state-sync="on"]').first().waitFor();
    await syncControl.first().click();
    await syncItem(/^(Lead the set|Mener la liste)$/).click();
    await page.locator('[data-testid="sync-control"][data-state-sync="leading"]').first().waitFor();
    await syncControl.first().click();
    await page.getByTestId("sync-present").click();
    await page.getByTestId("present-panel").waitFor();
    await page.getByTestId("present-next").click();
    await tv.locator('[data-testid="screen-showing"][data-slide="1"]').getByTestId("screen-lyrics").waitFor({ timeout: 10000 });
    await shoot("present-panel", null, null, { element: page.getByTestId("present-panel") });
    await shootTv("screen-lyrics");
    // The screen's own menu (issue #276), opened over the words with a double-click.
    await tv.getByTestId("screen-showing").dblclick({ position: { x: 300, y: 300 } });
    await tv.getByTestId("screen-menu").waitFor();
    await shootTv("screen-menu");
    await tv.keyboard.press("Escape");
    await tv.getByTestId("screen-menu").waitFor({ state: "detached" });
    // The operator view (issue #275), in a tab of its own while Live leads: the screens taken, a song's slides.
    {
      const live = page;
      page = await live.context().newPage();
      await page.setViewportSize(live.viewportSize());
      await shoot("operator-view", `/sets/${set.id}/operate`, async () => {
        await page.getByTestId("operator-take-shared").click();
        await page.locator('[data-testid="operator-control"][data-control="shared"]').waitFor();
        await page.locator('[data-testid="operator-slide"][aria-current="true"]').waitFor({ timeout: 10000 });
      });
      // Its layers (issues #280, #287), in the Screens & layers panel: the overlays cleared until the next slide.
      await shoot(
        "operator-layers",
        null,
        async () => {
          await page.getByTestId("operator-drawer-open").click();
          await page.getByTestId("operator-layer-overlays-clear").click();
          await page.locator('[data-testid="operator-layer-overlays"][data-state="cleared"]').waitFor({ timeout: 5000 });
          await page.waitForTimeout(400);
        },
        { element: page.getByTestId("operator-drawer") },
      );
      await page.getByTestId("operator-layers-reset").click();
      await page.close();
      page = live;
    }
    await syncControl.first().click();
    await syncItem(/^(End the session|Terminer la session)$/).click();
    await syncControl.first().click();
    await syncItem(/^(Turn sync off|Désactiver la synchro)$/).click();
    for (const screen of await api(me, "GET", "/screens")) await api(me, "DELETE", `/screens/${screen.id}`);
    await tvContext.close();
    // Practice: the song's stems, docked at the bottom - minimised, then expanded - one muted.
    await page.evaluate(() => localStorage.setItem("songverse.mode", "practice"));
    // Practice: a library song is its chart (issue #67).
    await shoot("practice-song", `/library/${grace.id}`, () => page.getByTestId("practice-song").locator("[data-chord]").first().waitFor());
    // The bars row (issue #238): the song's chords in bars and beats at the top, the click playing.
    {
      await page.goto(`${WEB}/library/${grace.id}`);
      const row = page.getByTestId("bars-row");
      await row.waitFor();
      await row.getByTestId("bars-metronome").click();
      await page.locator('[data-testid="bars-row"][data-source="click"]').waitFor();
      await page.waitForTimeout(4200);
      const box = await row.boundingBox();
      await page.screenshot({ path: path.join(dir, "bars.jpg"), type: "jpeg", quality: 85, clip: { x: box.x, y: box.y, width: box.width, height: box.height + 220 } });
      console.log("  bars");
      await row.getByTestId("bars-metronome").click();
    }
    // The chord grid (issue #238): the song read as its bars, the click playing; then back to the chart, which is kept for the song.
    {
      await page.goto(`${WEB}/library/${grace.id}`);
      await page.getByTestId("chart-view-grid").click();
      const grid = page.getByTestId("chord-grid");
      await grid.waitFor();
      await page.getByTestId("bars-metronome").click();
      await page.locator('[data-testid="chord-grid"][data-source="click"]').waitFor();
      await page.waitForTimeout(4200);
      const box = await grid.boundingBox();
      await page.screenshot({ path: path.join(dir, "chord-grid.jpg"), type: "jpeg", quality: 85, clip: { x: box.x - 24, y: box.y - 76, width: box.width + 48, height: Math.min(box.height + 96, 330) } });
      console.log("  chord-grid");
      await page.getByTestId("bars-metronome").click();
      // Edit bars (issue #238): a chord picked, a bar's tools.
      await page.getByTestId("chord-grid-edit-start").click();
      await grid.locator('[data-grid-bar="1"] [data-grid-words]').click();
      await grid.locator('[data-grid-bar="2"] [data-grid-chord]').first().click();
      const area = await page.getByTestId("chord-grid-area").boundingBox();
      await page.screenshot({ path: path.join(dir, "chord-grid-edit.jpg"), type: "jpeg", quality: 85, clip: { x: area.x - 24, y: area.y - 12, width: area.width + 48, height: Math.min(area.height + 24, 420) } });
      console.log("  chord-grid-edit");
      await page.getByTestId("chord-grid-cancel").click();
      await page.getByTestId("chart-view-chart").click();
      await page.getByTestId("song-chart").waitFor();
    }
    // Chord diagrams (issue #207): the strip of the song's chords, and one chord's card.
    await api(me, "PATCH", "/users/me", { chordDiagrams: "GUITAR" });
    await shoot("chord-diagrams", `/library/${grace.id}`, async () => {
      await page.getByTestId("chord-strip").waitFor();
      await page.locator("[data-chord-id]").nth(2).click();
      await page.getByTestId("chord-card").waitFor();
    });
    await page.keyboard.press("Escape");
    await api(me, "PATCH", "/users/me", { chordDiagrams: "OFF" });
    const dock = page.getByTestId("stem-player");
    await shoot("stems-compact", `/library/${grace.id}`, async () => {
      await page.locator('[data-testid="stem-player"][data-state="ready"]').waitFor({ timeout: 20000 });
      await dock.getByTestId("stem-compact-waveform").getByTestId("stem-waveform").waitFor();
    }, { element: dock });
    await shoot("stems", null, async () => {
      // The song's recording loads first (issue #182): its stems, a press away.
      await dock.getByTestId("stem-switch-multitrack").click();
      await page.locator('[data-testid="stem-player"][data-state="ready"]').getByTestId("stem-part-count").waitFor({ timeout: 20000 });
      await dock.getByRole("button", { name: /Expand|Agrandir/ }).click();
      await dock.getByRole("button", { name: /^(Play|Lecture)$/ }).click();
      await dock.getByTestId("stem-waveform").nth(3).waitFor();
      await dock.getByTestId("stem-track").first().getByTestId("stem-part").click();
      await dock.getByRole("slider").fill("8");
      await dock.getByRole("button", { name: /^(Pause)$/ }).click();
    }, { element: dock });
    // Placing the sections (issue #110): the editor open, the strip above the parts.
    await shoot("stems-sections", null, async () => {
      await dock.getByTestId("stem-cues").click();
      await dock.getByTestId("stem-cue-editor").waitFor();
    }, { element: dock });
    await dock.getByTestId("stem-cues").click();
    // Recording in the player (issue #134): its recorder open above the parts.
    await shoot("stems-record", null, async () => {
      await dock.getByTestId("stem-record").click();
      await page.locator('[data-testid="stem-record-panel"][data-phase="ready"]').waitFor();
    }, { element: dock });
    await dock.getByTestId("stem-record").click();
    await page.getByTestId("stem-record-panel").waitFor({ state: "detached" });
    // The mixer (issue #140), at a phone's width: a fader over each part's waveform.
    await page.setViewportSize({ width: 390, height: 844 });
    await shoot("stems-mixer", null, async () => {
      await dock.getByTestId("stem-mixer").click();
      await dock.getByTestId("stem-volume").nth(0).fill("45");
      await dock.getByTestId("stem-volume").nth(2).fill("70");
    }, { element: dock });
    await dock.getByTestId("stem-mixer-reset").click();
    await dock.getByTestId("stem-mixer").click();
    await page.setViewportSize({ width: 1280, height: 800 });
    // Playing on elsewhere: the button back to the song.
    await dock.getByRole("button", { name: /^(Play|Lecture)$/ }).click();
    await shoot("stems-return", null, async () => {
      // Library, on the sidebar's rail (#80).
      await page.getByTestId("sidebar-rail").getByRole("link", { name: /^(Library|Bibliothèque)$/ }).click();
      await page.getByTestId("stem-return").waitFor();
    });
    await page.getByTestId("stem-return").getByRole("button", { name: "Pause" }).click();
    await page.evaluate(() => localStorage.setItem("songverse.mode", "edit"));
    // The metronome (issue #2): its page, stopped.
    await shoot("metronome", "/metronome", () => page.getByTestId("metronome-beats").waitFor(), { fullPage: true });
    await shoot("songbook", `/songbooks/${songbook.id}`, null, { fullPage: true });
    // Its calendar (issue #235): a weekly service from next Sunday, a rehearsal every other Thursday.
    const service = nextSunday();
    await api(me, "POST", `/teams/${team.id}/events`, { title: text.service, date: service, startTime: "10:00", durationMinutes: 120, timeZone: text.zone, place: text.hall, repeat: { everyWeeks: 1 } });
    await api(me, "POST", `/teams/${team.id}/events`, { title: text.rehearsal, date: new Date(Date.parse(`${service}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10), startTime: "19:30", timeZone: text.zone, repeat: { everyWeeks: 2 } });
    await shoot("team", `/teams/${team.id}`, () => page.getByTestId("team-calendar").locator("[data-event-date]").first().waitFor());
    // People (issue #77): a guest musician connected, the song shared with them, someone asking.
    // Plain addresses rather than the harness's, since they show on the page.
    const named = async (name) => {
      const person = await user(name);
      person.email = `${name.toLowerCase().replace(" ", ".")}.${locale}@example.com`;
      sql(`update "User" set email='${person.email}' where id='${person.id}'`);
      return person;
    };
    const guest = await named(text.guest);
    for (const person of [guest, await named(text.friend)]) {
      await api(me, "POST", "/people/requests", { email: person.email });
      const request = (await api(person, "GET", "/people")).incoming[0];
      await api(person, "POST", `/people/requests/${request.id}/accept`);
    }
    const asking = await named(text.asking);
    await api(asking, "POST", "/people/requests", { email: text.email });
    await api(me, "PUT", `/song-versions/${grace.id}/shares/${guest.id}`, { canEdit: false });
    await shoot("people", "/people", () => page.getByTestId("people-list").waitFor());
    // Organisations (issue #241): on a server with several, one with the team and a welcome team in it.
    sql(`insert into "OrganizationSettings" (id, mode, "anyoneCreates", "updatedAt") values ('singleton', 'MULTI', true, now()) on conflict (id) do update set mode='MULTI', "anyoneCreates"=true`);
    const organization = await api(me, "POST", "/organizations", { name: text.organization });
    await api(me, "PUT", `/teams/${team.id}/organization`, { organizationId: organization.id });
    // A group that only plans, under no one, with its positions; the guest in it, covering one.
    const welcome = await api(me, "POST", `/organizations/${organization.id}/groups`, { name: text.welcome });
    await api(guest, "POST", `/organizations/join/${(await api(me, "POST", `/organizations/${organization.id}/invite-links`, {})).token}`);
    await api(guest, "POST", `/teams/join/${(await api(me, "POST", `/teams/${welcome.id}/invite-links`, {})).token}`);
    const greeter = await api(me, "POST", `/teams/${welcome.id}/positions`, { name: text.greeter });
    await api(me, "POST", `/teams/${welcome.id}/positions`, { name: text.coffee });
    await api(guest, "PUT", `/teams/${welcome.id}/members/${guest.id}/positions`, { positionIds: [greeter.id] });
    await shoot("organization", `/organizations/${organization.id}`, () => page.getByTestId("organization-teams").waitFor(), { fullPage: true });
    await shoot("group", `/teams/${welcome.id}`, () => page.getByTestId("team-positions").waitFor(), { fullPage: true });
    // Its events (issue #241): a weekly service needing the team's drums and two greeters, the guest its host.
    await api(me, "POST", `/organizations/${organization.id}/events`, {
      title: text.service,
      date: nextSunday(),
      startTime: "10:00",
      durationMinutes: 120,
      timeZone: text.zone,
      place: text.hall,
      repeat: { everyWeeks: 1 },
      hostUserId: guest.id,
      needs: [
        { teamId: team.id, parts: [{ part: "DRUMS", count: 1 }, { part: "BASS_GUITAR", count: 1 }] },
        { teamId: welcome.id, parts: [{ position: greeter.id, count: 2 }] },
      ],
    });
    await shoot("organization-events", `/organizations/${organization.id}/events`, () => page.locator("[data-org-event-date]").first().waitFor(), { fullPage: true });
    // Planiverse (issue #241): the same account, signed in through Oneverse without asking again (issue #303).
    await page.goto(`${PLANIVERSE}/calendar`);
    await page.waitForLoadState("networkidle");
    await page.locator("[data-event-date]").first().waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, "planiverse.jpg"), type: "jpeg", quality: 85 });
    console.log("  planiverse");
    await shoot("share-song", `/library/${grace.id}`, async () => {
      await page.getByRole("button", { name: /^(Share|Partager)$/ }).click();
      await page.getByTestId("song-shares").waitFor();
    });
    await page.keyboard.press("Escape");
    // What the device keeps offline, once it has caught up (the set is coming up).
    await shoot("offline-storage", "/offline", () => page.getByText(/Last caught up|Dernière mise à jour/).waitFor({ timeout: 30_000 }));
    await context.close();

    // A suggested change to a catalogue song (issue #74), as the reviewer reads it - last, so the library above doesn't list the song.
    const admin = await user(text.reviewer);
    sql(`update "User" set "isGlobalAdmin"=true, locale='${locale}', email='${text.reviewer.toLowerCase().replace(" ", ".")}@example.com' where id='${admin.id}'`);
    admin.email = `${text.reviewer.toLowerCase().replace(" ", ".")}@example.com`;
    const hymn = await api(admin, "POST", "/song-versions", { ...SONGS[0], title: `${SONGS[0].title} (catalogue)`, language: "en", contentFormat: "CHORDPRO" });
    await api(admin, "POST", `/song-versions/${hymn.id}/publish`, { duplicateReason: "Demo" });
    const hymnDoc = (await api(me, "GET", `/song-versions/${hymn.id}`)).documentJson;
    const suggestion = await api(me, "POST", `/song-versions/${hymn.id}/suggestions`, {
      content: SONGS[0].content.replace("And [G]grace my [Em]fears re[D]lieved;", "And [G]grace my [Em]fears re[D]lieved,"),
      copyright: "Public domain",
      revision: hymnDoc.revision,
      message: text.why,
    });
    const reviewing = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: locale === "fr" ? "fr-FR" : "en-US", colorScheme: "light" });
    const reviewPage = await reviewing.newPage();
    await signIn(reviewPage, admin);
    await reviewPage.goto(`${WEB}/review/suggestions/${suggestion.id}`);
    await reviewPage.getByTestId("history-chart-diff").waitFor();
    await reviewPage.waitForTimeout(300);
    await reviewPage.screenshot({ path: path.join(dir, "suggestion-review.jpg"), type: "jpeg", quality: 85, fullPage: true });
    console.log("  suggestion-review");
    await reviewing.close();
  }
} finally {
  await browser.close();
}
