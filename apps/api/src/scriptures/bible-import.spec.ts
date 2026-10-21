import { describe, expect, it } from "vite-plus/test";
import { BibleImportError, detectBibleFormat, importBible } from "./bible-import.js";
import { decodeEntities } from "./xml-reader.js";

const ZEFANIA = `<?xml version="1.0" encoding="utf-8"?>
<!--Visit the online documentation for Zefania XML Markup-->
<XMLBIBLE xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" biblename="King James Version" type="x-bible" status="v">
  <INFORMATION>
    <title>King James Version</title>
    <identifier>KJV</identifier>
    <language>ENG</language>
    <rights>Public Domain</rights>
  </INFORMATION>
  <BIBLEBOOK bnumber="43" bname="John" bsname="Jn">
    <CHAPTER cnumber="3">
      <CAPTION>Jesus and Nicodemus</CAPTION>
      <VERS vnumber="16">For God so loved the world,<NOTE type="x-studynote">a note</NOTE> that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.</VERS>
      <VERS vnumber="17">For God sent not his Son into the world to condemn the world; but that the world through him might be saved.</VERS>
      <VERS vnumber="18"/>
    </CHAPTER>
  </BIBLEBOOK>
  <BIBLEBOOK bnumber="1" bname="Genesis">
    <CHAPTER cnumber="1">
      <VERS vnumber="1">In the <gr str="430">beginning</gr> God created the heaven and the earth.</VERS>
      <VERS vnumber="2">And the earth was without form, and void;<BR art="x-nl"/>and darkness &amp; light.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
</XMLBIBLE>`;

const BEBLIA = `<?xml version="1.0" encoding="utf-8"?>
<bible translation="Louis Segond 1910" language="fr">
  <testament name="Old">
    <book number="1">
      <chapter number="1">
        <verse number="1">Au commencement, Dieu créa les cieux et la terre.</verse>
        <verse number="2">La terre était informe et vide&#160;: il y avait des ténèbres.</verse>
      </chapter>
    </book>
  </testament>
  <testament name="New">
    <book number="43">
      <chapter number="3">
        <verse number="16">Car Dieu a tant aimé le monde qu'il a donné son Fils unique.</verse>
      </chapter>
    </book>
  </testament>
</bible>`;

const OSIS_CONTAINERS = `<?xml version="1.0" encoding="UTF-8"?>
<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">
  <osisText osisIDWork="WEB" osisRefWork="Bible" xml:lang="en">
    <header>
      <work osisWork="WEB"><title>World English Bible</title><rights>Public Domain</rights></work>
      <work osisWork="Bible"><title>Bible</title></work>
    </header>
    <div type="book" osisID="John">
      <title type="main">The Good News According to John</title>
      <chapter osisID="John.3">
        <title>Nicodemus</title>
        <verse osisID="John.3.16">For God so loved the world<note type="x-footnote">a note</note>, that he gave his one and only Son.</verse>
        <verse osisID="John.3.17 John.3.18">For God didn't send his Son into the world to judge the world.</verse>
      </chapter>
    </div>
  </osisText>
</osis>`;

const OSIS_MILESTONES = `<?xml version="1.0" encoding="UTF-8"?>
<osis:osis xmlns:osis="http://www.bibletechnologies.net/2003/OSIS/namespace">
<osis:osisText osisIDWork="KJV" xml:lang="en">
<osis:header><osis:work osisWork="KJV"><osis:title>King James Version (1769)</osis:title></osis:work></osis:header>
<osis:div type="book" osisID="Gen">
<osis:chapter sID="Gen.1" osisID="Gen.1"/>
<osis:p><osis:verse sID="Gen.1.1" osisID="Gen.1.1"/>In the beginning God created the heaven and the earth.<osis:verse eID="Gen.1.1"/>
<osis:verse sID="Gen.1.2" osisID="Gen.1.2"/>And the earth was without form,</osis:p>
<osis:p>and void.<osis:verse eID="Gen.1.2"/></osis:p>
<osis:chapter eID="Gen.1"/>
<osis:chapter sID="Gen.2" osisID="Gen.2"/>
<osis:verse sID="Gen.2.1" osisID="Gen.2.1"/>Thus the heavens<osis:lb/>and the earth were finished.
<osis:chapter eID="Gen.2"/>
</osis:div>
<osis:div type="book" osisID="Tob"><osis:chapter osisID="Tob.1"><osis:verse osisID="Tob.1.1">The book of the words of Tobit.</osis:verse></osis:chapter></osis:div>
<osis:div type="book" osisID="AddEsth"><osis:chapter osisID="AddEsth.1"><osis:verse osisID="AddEsth.1.1">An addition.</osis:verse></osis:chapter></osis:div>
</osis:osisText>
</osis:osis>`;

const verses = (bible: ReturnType<typeof importBible>) =>
  bible.books.flatMap((book) => book.chapters.flatMap((chapter) => chapter.verses.map((verse) => [book.number, chapter.number, verse.number, verse.endNumber ?? null, verse.text])));

describe("detectBibleFormat", () => {
  it("tells the formats apart by their first element", () => {
    expect(detectBibleFormat(ZEFANIA)).toBe("zefania");
    expect(detectBibleFormat(BEBLIA)).toBe("beblia");
    expect(detectBibleFormat(OSIS_CONTAINERS)).toBe("osis");
    expect(detectBibleFormat(OSIS_MILESTONES)).toBe("osis");
    expect(detectBibleFormat('﻿ {"name": "KJV"}')).toBe("json-bible");
    expect(detectBibleFormat('<!DOCTYPE osis [<!ENTITY x "y">]><osis/>')).toBe("osis");
    expect(detectBibleFormat("<html><body/></html>")).toBeNull();
    expect(detectBibleFormat("Genesis 1:1")).toBeNull();
  });
});

describe("importBible", () => {
  it("reads Zefania: its details, books in order, notes and captions left out", () => {
    const bible = importBible(ZEFANIA);
    expect(bible.name).toBe("King James Version");
    expect(bible.metadata).toEqual({ abbreviation: "KJV", language: "ENG", copyright: "Public Domain", sourceFormat: "zefania" });
    expect(bible.books.map((book) => [book.number, book.name, book.osisId])).toEqual([
      [1, "Genesis", "Gen"],
      [43, "John", "John"],
    ]);
    expect(verses(bible)).toEqual([
      [1, 1, 1, null, "In the beginning God created the heaven and the earth."],
      [1, 1, 2, null, "And the earth was without form, and void; and darkness & light."],
      [43, 3, 16, null, "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."],
      [43, 3, 17, null, "For God sent not his Son into the world to condemn the world; but that the world through him might be saved."],
    ]);
  });

  it("reads Beblia, naming its books from the book list", () => {
    const bible = importBible(BEBLIA);
    expect(bible.name).toBe("Louis Segond 1910");
    expect(bible.metadata).toEqual({ language: "fr", sourceFormat: "beblia" });
    expect(bible.books.map((book) => [book.number, book.name])).toEqual([
      [1, "Genesis"],
      [43, "John"],
    ]);
    expect(verses(bible)[1]).toEqual([1, 1, 2, null, "La terre était informe et vide : il y avait des ténèbres."]);
  });

  it("reads OSIS with verses as elements: headings and notes left out, combined verses kept as one", () => {
    const bible = importBible(OSIS_CONTAINERS);
    expect(bible.name).toBe("World English Bible");
    expect(bible.metadata).toEqual({ language: "en", abbreviation: "WEB", copyright: "Public Domain", sourceFormat: "osis" });
    expect(verses(bible)).toEqual([
      [43, 3, 16, null, "For God so loved the world, that he gave his one and only Son."],
      [43, 3, 17, 18, "For God didn't send his Son into the world to judge the world."],
    ]);
  });

  it("reads OSIS with verses as milestones, across paragraphs, ended by the next chapter", () => {
    const bible = importBible(OSIS_MILESTONES);
    expect(bible.name).toBe("King James Version (1769)");
    expect(bible.books.map((book) => [book.number, book.osisId])).toEqual([
      [1, "Gen"],
      [69, "Tob"],
      [1000, "AddEsth"],
    ]);
    expect(verses(bible).slice(0, 3)).toEqual([
      [1, 1, 1, null, "In the beginning God created the heaven and the earth."],
      [1, 1, 2, null, "And the earth was without form, and void."],
      [1, 2, 1, null, "Thus the heavens and the earth were finished."],
    ]);
  });

  it("reads a json-bible file", () => {
    const bible = importBible(JSON.stringify({ name: "KJV", metadata: { publisher: "" }, books: [{ number: 1, name: "Genesis", chapters: [{ number: 1, verses: [{ number: 1, text: "In the beginning" }] }] }] }));
    expect(bible.metadata.sourceFormat).toBe("json-bible");
    expect(verses(bible)).toEqual([[1, 1, 1, null, "In the beginning"]]);
  });

  it("refuses what it can't read, with a reason", () => {
    expect(() => importBible("<html/>")).toThrow(BibleImportError);
    expect(() => importBible('<XMLBIBLE><BIBLEBOOK bnumber="1"><CHAPTER cnumber="1"><VERS vnumber="1">In the')).toThrow("The file ends before <vers> is closed.");
    expect(() => importBible('<XMLBIBLE><BIBLEBOOK bnumber="1"></CHAPTER></XMLBIBLE>')).toThrow("</chapter> closes an element it doesn't match.");
    expect(() => importBible('<XMLBIBLE biblename="x"><BIBLEBOOK bnumber="1"></BIBLEBOOK></XMLBIBLE>')).toThrow("The file holds no verse.");
    expect(() => importBible("<bible><book><chapter number=\"1\"/></book></bible>")).toThrow("A book has no number.");
    expect(() => importBible('<osis><verse osisID="Gen.1.1" x="1')).toThrow("The file isn't well-formed XML");
    expect(() => importBible("{ not json")).toThrow("The file isn't valid JSON.");
    expect(() => importBible('{"books": 3}')).toThrow("The file isn't a json-bible file");
  });
});

describe("decodeEntities", () => {
  it("decodes XML's entities and character references, and leaves others", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#233; &#xE9; &unknown; &#0;")).toBe("a & b <c> \"d\" 'e' é é &unknown; &#0;");
  });
});
