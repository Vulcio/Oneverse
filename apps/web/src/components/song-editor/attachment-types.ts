import type { AttachmentType } from "@oneverse/core";

/** What kind of attachment a file is, going by its type and name. */
export function attachmentTypeFor(file: File): AttachmentType {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("audio/")) return "AUDIO";
  if (file.type.startsWith("image/")) return "IMAGE";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (/\.(cho|chordpro|chopro|crd|pro)$/.test(name)) return "CHORDPRO";
  if (/\.(musicxml|mxl|xml)$/.test(name)) return "MUSICXML";
  if (name.endsWith(".abc")) return "ABC_NOTATION";
  if (file.type.startsWith("text/") || name.endsWith(".txt")) return "TEXT";
  return "OTHER";
}

export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** A picture a chart can be read from by OCR (issue #124): a photo or a scan. */
export const isChartImage = (file: File) => /^image\/(?:png|jpe?g|webp|gif|bmp)$/.test(file.type) || /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(file.name);
