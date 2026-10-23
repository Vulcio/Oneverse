import { cueItem, readArrangementDocument, readItemText, readSongDocument, renderChart, setItemSlides, type CueItem } from "@oneverse/core";
import type { PrismaService } from "../prisma/prisma.service.js";

/**
 * A set's items as a cue sees them (issue #322): where each one's sections
 * start, as every client cuts it (setItemSlides), and its slides' key. A
 * song's lyrics and a text's paragraphs are known here; a passage's verses
 * aren't read for it (a YouVersion one never is): it's one section, no key.
 */
export async function setCueItems(prisma: PrismaService, setId: string): Promise<CueItem[]> {
  const items = await prisma.client.setlistItem.findMany({
    where: { setlistId: setId },
    orderBy: { position: "asc" },
    select: { id: true, kind: true, text: true, songVersion: { select: { id: true, documentJson: true } }, arrangement: { select: { documentJson: true } } },
  });
  return items.map((item) => {
    if (item.kind === "TEXT") {
      const text = readItemText(item.text);
      return cueItem(item.id, text ? setItemSlides({ text }) : null);
    }
    if (!item.songVersion) return cueItem(item.id, null);
    const document = readSongDocument(item.songVersion.documentJson);
    const arrangement = item.arrangement ? readArrangementDocument(item.arrangement.documentJson, document, item.songVersion.id, () => "a").document : null;
    return cueItem(item.id, setItemSlides({ chart: renderChart(document, arrangement) }));
  });
}
