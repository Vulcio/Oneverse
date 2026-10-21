import type { StemPart } from "@oneverse/core";

/** Demucs's `two_stems` for a 2-part separation: the vocals, and the rest. */
export function twoStemsOf(parts: string): string | undefined {
  return parts === "2" ? "vocals" : undefined;
}

/**
 * A Demucs output file's part (issue #63): vocals, drums, bass and other;
 * with 6 parts guitar and piano (Keys); with 2, the vocals and the rest
 * ("no_vocals", an instrumental).
 */
export function partOfStem(filename: string, _parts: string): { stemPart: StemPart; partName: string | null; label: string } {
  const name = filename.replace(/\.[a-z0-9]{1,5}$/i, "").toLowerCase();
  switch (name) {
    case "vocals":
      return { stemPart: "VOCALS", partName: null, label: "Vocals" };
    case "drums":
      return { stemPart: "DRUMS", partName: null, label: "Drums" };
    case "bass":
      return { stemPart: "BASS", partName: null, label: "Bass" };
    case "guitar":
      return { stemPart: "GUITAR", partName: null, label: "Guitar" };
    case "piano":
      return { stemPart: "KEYS", partName: "Piano", label: "Piano" };
    case "no_vocals":
      return { stemPart: "OTHER", partName: "Instrumental", label: "Instrumental" };
    case "other":
      return { stemPart: "OTHER", partName: null, label: "Other" };
    default:
      return { stemPart: "OTHER", partName: filename.replace(/\.[a-z0-9]{1,5}$/i, ""), label: filename.replace(/\.[a-z0-9]{1,5}$/i, "") };
  }
}
