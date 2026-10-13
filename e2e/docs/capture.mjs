// Demo content and the docs' screenshots, in each language (run by
// screenshots.mjs, which starts a fresh copy of the app for it). The songs
// are in the public domain.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { API, WEB, api, signIn, sql, user } from "../lib/harness.mjs";

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
  en: { user: "Alex Martin", email: "alex.martin@example.com", bandmate: "Sam Taylor", guest: "Jordan Kim", friend: "Chris Lane", asking: "Taylor Reed", reviewer: "Robin Lee", why: "It's 'relieved', with one l.", team: "Morning Band", set: "Sunday service", arrangement: "Sunday band", songbook: "Hymns", note: "Softly, piano only", addedLine: "Sing it a|gain", service: "Morning service", rehearsal: "Rehearsal", hall: "Main hall", zone: "Europe/London", organization: "Grace Church", welcome: "Welcome team", greeter: "Greeter", coffee: "Coffee" },
  fr: { user: "Camille Durand", email: "camille.durand@example.com", bandmate: "Hugo Petit", guest: "Lucas Martin", friend: "Chloe Bernard", asking: "Emma Roux", reviewer: "Alice Moreau", why: "C'est « relieved », avec un seul l.", team: "Groupe du matin", set: "Culte du dimanche", arrangement: "Groupe du dimanche", songbook: "Cantiques", note: "Doucement, piano seul", addedLine: "Chante-le en|core", service: "Culte du matin", rehearsal: "Répétition", hall: "Grande salle", zone: "Europe/Paris", organization: "Église de la Grâce", welcome: "Équipe d'accueil", greeter: "Accueil", coffee: "Café" },
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
    const page = await context.newPage();
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
    await shoot("set-song", `/sets/${set.id}/songs/${items[0].id}`, () => page.locator("[data-pass]").first().waitFor(), { fullPage: true });
    // The Display panel (issue #209), on a phone: the bottom of the screen, the chart still in view.
    await page.setViewportSize({ width: 390, height: 844 });
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
    await shoot("screens-pair", `/screens?code=${screenCode}&setlistId=${set.id}`, () => page.getByTestId("screen-pair-form").waitFor());
    // Screen themes (issue #194): the built-in ones, each playing its sample song.
    await shoot(
      "screen-themes",
      null,
      async () => {
        await page.getByTestId("builtin-themes").scrollIntoViewIfNeeded();
        await page.getByTestId("builtin-theme-concert").getByTestId("screen-lyrics").waitFor();
        await page.waitForTimeout(1500);
      },
      { element: page.getByTestId("builtin-themes") },
    );
    await page.getByTestId("screen-pair-form").getByRole("button").click();
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
