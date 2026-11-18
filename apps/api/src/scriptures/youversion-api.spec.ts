import { parseBibleReference } from "@oneverse/core";
import { describe, expect, it } from "vite-plus/test";
import { cacheFreshness, youVersionBibleById, youVersionBibles, youVersionBooks, youVersionHtmlVerses, youVersionPassage, youVersionSearch, YouVersionApiError, type Fetcher } from "./youversion-api.js";

// Answers shaped as developers.youversion.com/api documents them (no App
// Key was registered yet to record real ones): version 3034 is the Berean
// Standard Bible in the documentation's examples.
const BSB = {
  id: 3034,
  abbreviation: "BSB",
  title: "Berean Standard Bible",
  localized_title: "Berean Standard Bible",
  localized_abbreviation: "BSB",
  language_tag: "en",
  copyright: "The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, OpenBible.com, and the Berean Bible Translation Committee.",
  info: "This text of God's Word has been dedicated to the public domain.",
  promotional_content: null,
  publisher_url: "https://berean.bible",
  youversion_deep_link: "https://www.bible.com/versions/3034",
  books: ["GEN", "JHN"],
  organization_id: null,
};

const VERSES: Record<string, string> = {
  "JHN.3.16": "For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.",
  "JHN.3.17": "For God did not send His Son into the world to condemn the world, but to save the world through Him.",
  "JHN.3.18": "Whoever believes in Him is not condemned, but whoever does not believe has already been condemned.",
};

/** A stand-in for the API, keeping what it was asked. */
function fakeApi(appKey = "test-key") {
  const asked: { url: URL; key: string | null }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetcher: Fetcher = async (input, init) => {
    const url = new URL(String(input));
    const key = new Headers(init?.headers).get("x-yvp-app-key");
    asked.push({ url, key });
    if (!key) return json({ fault: { faultstring: "Failed to resolve API Key variable request.header.x-yvp-app-key", detail: { errorcode: "steps.oauth.v2.FailedToResolveAPIKey" } } }, 401);
    if (key === "spent") return new Response("Rate limit exceeded.", { status: 429, headers: { "content-type": "text/plain" } });
    if (key !== appKey) return json({ fault: { faultstring: "Invalid ApiKey", detail: { errorcode: "oauth.v2.InvalidApiKey" } } }, 401);
    const path = url.pathname;
    if (path === "/v1/bibles") return json({ data: url.searchParams.getAll("language_ranges[]").includes("en") ? [BSB] : [], next_page_token: null, total_size: 1 });
    if (path === "/v1/bibles/3034") return json(BSB);
    if (path === "/v1/bibles/3034/books/JHN/chapters/3/verses") return json({ data: Array.from({ length: 36 }, (_, i) => ({ id: String(i + 1), passage_id: `JHN.3.${i + 1}`, title: String(i + 1) })) });
    const passage = /^\/v1\/bibles\/3034\/passages\/(.+)$/.exec(path)?.[1];
    // As YouVersion's HTML marks verses: an empty marker, then a label (its SDK's own test data).
    const html = (from: number, to: number) =>
      `<div class="p">${Array.from({ length: to - from + 1 }, (_, i) => from + i)
        .map((v) => `<span class="yv-v" v="${v}"></span><span class="yv-vlbl">${v}</span>${VERSES[`JHN.3.${v}`] ?? `Verse ${v}.`}`)
        .join(" ")}</div>`;
    if (passage === "JHN.3" || passage === "JHN.4") return json({ id: passage, content: html(1, 36), reference: `John ${passage.slice(4)}` });
    const range = /^JHN\.3\.(\d+)(?:-(\d+))?$/.exec(passage ?? "");
    if (range) return json({ id: passage, content: html(Number(range[1]), Number(range[2] ?? range[1])), reference: `John 3:${range[1]}${range[2] ? `-${range[2]}` : ""}` });
    return json({ message: "Not found" }, 404);
  };
  return { fetcher, asked };
}

/** Answers without a Cache-Control header. */
const api200 = () => fakeApi().fetcher;

describe("YouVersion's Platform API", () => {
  it("lists a language's versions, the key in X-YVP-App-Key", async () => {
    const api = fakeApi();
    const bibles = await youVersionBibles("en", "test-key", api.fetcher);
    expect(bibles).toEqual([
      { id: 3034, abbreviation: "BSB", title: "Berean Standard Bible", languageTag: "en", copyright: BSB.copyright, attribution: BSB.copyright, info: BSB.info, link: "https://www.bible.com/versions/3034" },
    ]);
    expect(api.asked[0]!.key).toBe("test-key");
    expect(api.asked[0]!.url.searchParams.get("language_ranges[]")).toBe("en");
    expect(await youVersionBibles("fr", "test-key", api.fetcher)).toEqual([]);
  });

  it("takes the long copyright when there's no short one, else the title and info, as plain text", async () => {
    const answer = (body: unknown): Fetcher => async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const { bible: long } = await youVersionBibleById(3034, "test-key", answer({ ...BSB, copyright: "", promotional_content: "<p>Scripture taken from the <b>BSB</b> &amp; used by permission.</p>" }));
    expect(long.copyright).toBe("Scripture taken from the BSB & used by permission.");
    const { bible: none } = await youVersionBibleById(3034, "test-key", answer({ ...BSB, copyright: " ", promotional_content: null }));
    expect(none.copyright).toBeNull();
    // A text out of copyright, as Martin 1744 (FMAR) comes: its title and info instead.
    expect(none.attribution).toBe(`Berean Standard Bible. ${BSB.info}`);
    const { bible: bare } = await youVersionBibleById(3034, "test-key", answer({ ...BSB, copyright: null, promotional_content: null, info: null }));
    expect(bare.attribution).toBe("Berean Standard Bible");
  });

  it("asks once a chapter: a verse, verses of a chapter, a whole chapter, as HTML split into verses", async () => {
    const api = fakeApi();
    const { parts: verse } = await youVersionPassage(3034, parseBibleReference("John 3:16")!, "test-key", api.fetcher);
    expect(verse).toEqual([{ id: "JHN.3.16", reference: "John 3:16", text: VERSES["JHN.3.16"] }]);
    expect(api.asked[0]!.url.searchParams.get("format")).toBe("html");

    api.asked.length = 0;
    const { parts: range } = await youVersionPassage(3034, parseBibleReference("Jean 3.16-18")!, "test-key", api.fetcher);
    expect(range.map((part) => part.id)).toEqual(["JHN.3.16", "JHN.3.17", "JHN.3.18"]);
    expect(range[1]!.text).toBe(VERSES["JHN.3.17"]);
    // One request, not a verse list and one a verse (issue #485).
    expect(api.asked.map((call) => call.url.pathname)).toEqual(["/v1/bibles/3034/passages/JHN.3.16-18"]);

    const { parts: chapter } = await youVersionPassage(3034, parseBibleReference("John 3")!, "test-key", api.fetcher);
    expect(chapter).toHaveLength(36);
    expect(chapter[15]).toMatchObject({ id: "JHN.3.16", text: VERSES["JHN.3.16"] });

    api.asked.length = 0;
    // Across chapters: each chapter once, its verses outside the passage left out.
    const { parts: across } = await youVersionPassage(3034, parseBibleReference("John 3:35-4:2")!, "test-key", api.fetcher);
    expect(across.map((part) => part.id)).toEqual(["JHN.3.35", "JHN.3.36", "JHN.4.1", "JHN.4.2"]);
    expect(api.asked.map((call) => call.url.pathname)).toEqual(["/v1/bibles/3034/passages/JHN.3", "/v1/bibles/3034/passages/JHN.4"]);
  });

  it("refuses a whole book and a passage of too many chapters", async () => {
    const api = fakeApi();
    await expect(youVersionPassage(3034, parseBibleReference("John")!, "test-key", api.fetcher)).rejects.toMatchObject({ status: 400 });
    // The same verses twice are asked for once.
    api.asked.length = 0;
    const { parts: twice } = await youVersionPassage(3034, parseBibleReference("John 3:16-17, 16-17")!, "test-key", api.fetcher);
    expect(twice.map((part) => part.id)).toEqual(["JHN.3.16", "JHN.3.17"]);
    expect(api.asked).toHaveLength(1);
    api.asked.length = 0;
    await expect(youVersionPassage(3034, parseBibleReference("Psalm 1-61")!, "test-key", api.fetcher)).rejects.toMatchObject({ status: 400 });
    expect(api.asked).toEqual([]);
  });

  it("reads verses out of YouVersion's HTML, leaving labels, notes and headings out", () => {
    const html = `<div class="s1">The Love of God</div><div class="p"><span class="yv-v" v="16"></span><span class="yv-vlbl">16</span>For God so loved<span class="yv-n f"><span class="ft">Or <i>only begotten</i></span></span> the world.</div>
      <div class="q1"><span class="yv-v" v="17"><span class="yv-vlbl">17</span>He sent &ldquo;His&rdquo; Son &amp; saved<br/>us.</span></div>
      <div class="p"><span class="yv-v" v="18-19"></span><span class="yv-vlbl">18-19</span>Two verses &#8212; one.</div>`;
    expect(youVersionHtmlVerses(html)).toEqual([
      { verse: "16", text: "For God so loved the world." },
      { verse: "17", text: "He sent \u201cHis\u201d Son & saved us." },
      { verse: "18-19", text: "Two verses \u2014 one." },
    ]);
    expect(youVersionHtmlVerses("<p>No marks here.</p>")).toEqual([]);
  });

  it("keeps an answer as long as its Cache-Control says (RFC 9111), never without one", () => {
    const fresh = (headers: Record<string, string>) => cacheFreshness(new Headers(headers), Date.parse("2026-11-16T12:00:00Z"));
    expect(fresh({})).toEqual({ shared: null, private: null });
    expect(fresh({ "cache-control": "public, max-age=3600" })).toEqual({ shared: 3600, private: 3600 });
    expect(fresh({ "Cache-Control": "max-age=3600, s-maxage=600" })).toEqual({ shared: 600, private: 3600 });
    // A private answer: a screen may keep it for itself, this server not for everyone.
    expect(fresh({ "cache-control": "private, max-age=86400" })).toEqual({ shared: 0, private: 86400 });
    expect(fresh({ "cache-control": "no-store" })).toEqual({ shared: 0, private: 0 });
    expect(fresh({ "cache-control": "max-age=3600, no-cache" })).toEqual({ shared: 0, private: 0 });
    // Already this old when it came: that much less.
    expect(fresh({ "cache-control": "max-age=3600", age: "600" })).toEqual({ shared: 3000, private: 3000 });
    expect(fresh({ "cache-control": "max-age=60", age: "600" })).toEqual({ shared: 0, private: 0 });
    expect(fresh({ "cache-control": 'max-age="120"' })).toEqual({ shared: 120, private: 120 });
    expect(fresh({ "cache-control": "max-age=soon" })).toEqual({ shared: 0, private: 0 });
    // Expires counts when there's no max-age, from the answer's own Date.
    expect(fresh({ date: "Mon, 16 Nov 2026 12:00:00 GMT", expires: "Mon, 16 Nov 2026 13:00:00 GMT" })).toEqual({ shared: 3600, private: 3600 });
    expect(fresh({ expires: "0" })).toEqual({ shared: 0, private: 0 });
  });

  it("says how long a passage may be kept on a screen: the shortest of its requests'", async () => {
    const answer =
      (control: (path: string) => string): Fetcher =>
      async (input) => {
        const path = new URL(String(input)).pathname;
        const id = path.split("/").pop()!;
        return new Response(JSON.stringify({ id, content: `<span class="yv-v" v="1"></span>Verse.`, reference: id }), { status: 200, headers: { "content-type": "application/json", "cache-control": control(path) } });
      };
    const across = await youVersionPassage(3034, parseBibleReference("John 3:36-4:1")!, "test-key", answer((path) => (path.endsWith("JHN.3") ? "max-age=7200" : "max-age=600")));
    expect(across.keepSeconds).toBe(600);
    const none = await youVersionPassage(3034, parseBibleReference("John 3:16")!, "test-key", api200());
    expect(none.keepSeconds).toBe(0);
  });

  it("tells its errors apart", async () => {
    const api = fakeApi();
    const failure = (promise: Promise<unknown>) => promise.then(() => null, (err: unknown) => err as YouVersionApiError);
    const wrongKey = await failure(youVersionBibles("en", "other", api.fetcher));
    expect(wrongKey).toBeInstanceOf(YouVersionApiError);
    expect(wrongKey).toMatchObject({ status: 401, message: "YouVersion refused the App Key: Invalid ApiKey" });
    expect(await failure(youVersionBibles("en", "spent", api.fetcher))).toMatchObject({ status: 429 });
    expect(await failure(youVersionBibleById(9999, "test-key", api.fetcher))).toMatchObject({ status: 404 });
  });
});

describe("a version's books and its search (issue #507)", () => {
  /** Answers as developers.youversion.com/api and /search-apis document them. */
  function stand(answers: Record<string, unknown>) {
    const asked: URL[] = [];
    const fetcher: Fetcher = async (input) => {
      const url = new URL(String(input));
      asked.push(url);
      const body = answers[url.pathname];
      return body === undefined ? new Response("", { status: 404 }) : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } });
    };
    return { asked, fetcher };
  }

  it("names the books as the version does, with each chapter's last verse, intros and unknown books left out", async () => {
    const { fetcher, asked } = stand({
      "/v1/bibles/128/books": {
        data: [
          { id: "JHN", title: "Juan", abbreviation: "Jn.", canon: "new_testament", intro: { id: "INTRO" }, chapters: [{ id: "INTRO", verses: [] }, { id: "1", verses: [{ id: "1" }, { id: "2" }, { id: "51" }] }, { id: "2", verses: [{ id: "1" }, { id: "24-25" }] }] },
          { id: "XYZ", title: "Unknown", chapters: [{ id: "1", verses: [{ id: "1" }] }] },
        ],
      },
    });
    const { books, fresh } = await youVersionBooks(128, "key", fetcher);
    expect(books).toEqual([{ number: 43, name: "Juan", abbreviation: "Jn", verses: [51, 25] }]);
    expect(fresh.shared).toBe(600);
    expect(asked).toHaveLength(1);
  });

  it("searches verses and topics in one request, never images, and pages verses on", async () => {
    const { fetcher, asked } = stand({
      "/v1/search-unified": { verses: [{ reference: "JHN.3.16" }, { reference: "1CO.13.4" }, { reference: "JHN.3.16" }], topics: [{ id: 42, text: "love", subtopics: ["trust"] }], images: [{ id: "x", passage_id: "1CO.13.4-8" }], user_intent: "topical", did_you_mean: [], search_instead_for: null },
      "/v1/search-verses": { verses: [{ reference: "1JN.4.8" }], user_intent: "text", did_you_mean: ["love"], search_instead_for: "love", next_page_token: "p2" },
    });
    const first = await youVersionSearch({ bibleId: 3034, query: "love", language: "en", intent: "unknown" }, "key", fetcher);
    expect(first.answer).toEqual({ verses: ["JHN.3.16", "1CO.13.4"], topics: [{ id: 42, text: "love", subtopics: ["trust"] }], userIntent: "topical", didYouMean: [], searchInsteadFor: null, nextPageToken: null });
    expect(asked[0]!.searchParams.getAll("fields[]")).toEqual(["verses", "topics"]);
    expect(asked[0]!.searchParams.getAll("language_ranges[]")).toEqual(["en"]);
    expect(asked[0]!.searchParams.get("user_intent")).toBeNull();
    const more = await youVersionSearch({ bibleId: 3034, query: "lvoe", language: "en", intent: "text", pageToken: "p1" }, "key", fetcher);
    expect(more.answer).toMatchObject({ verses: ["1JN.4.8"], didYouMean: ["love"], searchInsteadFor: "love", nextPageToken: "p2" });
    expect(asked[1]!.pathname).toBe("/v1/search-verses");
    expect(asked[1]!.searchParams.get("page_token")).toBe("p1");
    expect(asked[1]!.searchParams.get("user_intent")).toBe("text");
  });
});
