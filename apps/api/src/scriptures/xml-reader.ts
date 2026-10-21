/**
 * A small XML reader for Bible files (issue #301): elements, attributes and
 * text, read in order, with the XML entities and CDATA decoded. Names come
 * lower-cased without their namespace prefix ("XMLBIBLE" is "xmlbible",
 * "osis:verse" "verse"), as Zefania, Beblia and OSIS files spell them
 * differently. Comments, processing instructions and the DOCTYPE are skipped;
 * nothing is fetched (no external entities, no DTD).
 */
export interface XmlHandler {
  open(name: string, attributes: Record<string, string>, selfClosing: boolean): void;
  close(name: string): void;
  text(text: string): void;
}

export class XmlError extends Error {}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1).toLowerCase();
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function readXml(xml: string, handler: XmlHandler): void {
  let at = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  const open: string[] = [];
  const end = (marker: string, from: number) => {
    const found = xml.indexOf(marker, from);
    if (found === -1) throw new XmlError(`The file ends inside a ${marker === "-->" ? "comment" : "tag"}.`);
    return found;
  };
  while (at < xml.length) {
    const lt = xml.indexOf("<", at);
    if (lt === -1) {
      handler.text(decodeEntities(xml.slice(at)));
      break;
    }
    if (lt > at) handler.text(decodeEntities(xml.slice(at, lt)));
    if (xml.startsWith("<!--", lt)) {
      at = end("-->", lt + 4) + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const close = end("]]>", lt + 9);
      handler.text(xml.slice(lt + 9, close));
      at = close + 3;
    } else if (xml.startsWith("<?", lt)) {
      at = end("?>", lt + 2) + 2;
    } else if (xml.startsWith("<!", lt)) {
      // A DOCTYPE, with an internal subset in brackets or not.
      const bracket = xml.indexOf("[", lt);
      const gt = end(">", lt);
      at = (bracket !== -1 && bracket < gt ? end(">", end("]", bracket)) : gt) + 1;
    } else if (xml[lt + 1] === "/") {
      const gt = end(">", lt);
      const name = localName(xml.slice(lt + 2, gt).trim());
      if (open.pop() !== name) throw new XmlError(`</${name}> closes an element it doesn't match.`);
      handler.close(name);
      at = gt + 1;
    } else {
      // A start tag: its end is the first ">" outside quotes.
      let gt = lt + 1;
      let quote: string | null = null;
      for (; gt < xml.length; gt++) {
        const char = xml[gt];
        if (quote) {
          if (char === quote) quote = null;
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === ">") {
          break;
        }
      }
      if (gt >= xml.length) throw new XmlError("The file ends inside a tag.");
      const selfClosing = xml[gt - 1] === "/";
      const inner = xml.slice(lt + 1, selfClosing ? gt - 1 : gt);
      const nameEnd = inner.search(/[\s/]|$/);
      const name = localName(inner.slice(0, nameEnd));
      if (!name) throw new XmlError("An element has no name.");
      const attributes: Record<string, string> = {};
      for (const match of inner.slice(nameEnd).matchAll(ATTRIBUTE)) {
        attributes[localName(match[1]!)] = decodeEntities(match[3] ?? match[4] ?? "");
      }
      handler.open(name, attributes, selfClosing);
      if (selfClosing) handler.close(name);
      else open.push(name);
      at = gt + 1;
    }
  }
  if (open.length > 0) throw new XmlError(`The file ends before <${open[open.length - 1]}> is closed.`);
}
