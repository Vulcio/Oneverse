import { parseBibleReference } from "@oneverse/core";
import { describe, expect, it } from "vite-plus/test";
import { youVersionBibleById, youVersionBibles, youVersionPassage, YouVersionApiError, type Fetcher } from "./youversion-api.js";

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
    if (passage === "JHN.3") return json({ id: "JHN.3", content: "Now there was a Pharisee named Nicodemus,\n a leader of the Jews.", reference: "John 3" });
    if (passage && VERSES[passage]) return json({ id: passage, content: VERSES[passage], reference: `John 3:${passage.split(".")[2]}` });
    return json({ message: "Not found" }, 404);
  };
  return { fetcher, asked };
}

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
    const long = await youVersionBibleById(3034, "test-key", answer({ ...BSB, copyright: "", promotional_content: "<p>Scripture taken from the <b>BSB</b> &amp; used by permission.</p>" }));
    expect(long.copyright).toBe("Scripture taken from the BSB & used by permission.");
    const none = await youVersionBibleById(3034, "test-key", answer({ ...BSB, copyright: " ", promotional_content: null }));
    expect(none.copyright).toBeNull();
    // A text out of copyright, as Martin 1744 (FMAR) comes: its title and info instead.
    expect(none.attribution).toBe(`Berean Standard Bible. ${BSB.info}`);
    const bare = await youVersionBibleById(3034, "test-key", answer({ ...BSB, copyright: null, promotional_content: null, info: null }));
    expect(bare.attribution).toBe("Berean Standard Bible");
  });

  it("asks for a verse, a chapter, and verses one by one", async () => {
    const api = fakeApi();
    const verse = await youVersionPassage(3034, parseBibleReference("John 3:16")!, "test-key", api.fetcher);
    expect(verse).toEqual([{ id: "JHN.3.16", reference: "John 3:16", text: VERSES["JHN.3.16"] }]);

    const chapter = await youVersionPassage(3034, parseBibleReference("John 3")!, "test-key", api.fetcher);
    expect(chapter).toEqual([{ id: "JHN.3", reference: "John 3", text: "Now there was a Pharisee named Nicodemus, a leader of the Jews." }]);

    api.asked.length = 0;
    const range = await youVersionPassage(3034, parseBibleReference("Jean 3.16-18")!, "test-key", api.fetcher);
    expect(range.map((part) => part.id)).toEqual(["JHN.3.16", "JHN.3.17", "JHN.3.18"]);
    expect(api.asked.map((call) => call.url.pathname)).toEqual([
      "/v1/bibles/3034/books/JHN/chapters/3/verses",
      "/v1/bibles/3034/passages/JHN.3.16",
      "/v1/bibles/3034/passages/JHN.3.17",
      "/v1/bibles/3034/passages/JHN.3.18",
    ]);
    expect(api.asked[1]!.url.searchParams.get("format")).toBe("text");
  });

  it("refuses a whole book and a passage of too many parts", async () => {
    const api = fakeApi();
    await expect(youVersionPassage(3034, parseBibleReference("John")!, "test-key", api.fetcher)).rejects.toMatchObject({ status: 400 });
    // The same verses twice are asked for once.
    const twice = await youVersionPassage(3034, parseBibleReference("John 3:16-17, 16-17")!, "test-key", api.fetcher);
    expect(twice.map((part) => part.id)).toEqual(["JHN.3.16", "JHN.3.17"]);
    api.asked.length = 0;
    await expect(youVersionPassage(3034, parseBibleReference("Psalm 1-61")!, "test-key", api.fetcher)).rejects.toMatchObject({ status: 400 });
    expect(api.asked).toEqual([]);
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
