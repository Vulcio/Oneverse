/**
 * What another app gave Songverse (issue #407): shared to it (the manifest's
 * `share_target`, kept by the service worker until read) or a file opened with
 * it on a computer (`file_handlers`, through `launchQueue`).
 */
export interface Incoming {
  files: File[];
  /** A page's title, words, or an address, as the other app shared them. */
  title: string;
  text: string;
  url: string;
}

const SHARED = "songverse-shared";

/** What was shared, read once: the service worker's copy is cleared as it's read. */
export async function takeShared(): Promise<Incoming | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARED);
    const meta = await cache.match("/shared/meta");
    if (!meta) return null;
    const kept = (await meta.json()) as { title?: string; text?: string; url?: string; files?: { key: string; name: string; type: string }[] };
    const files: File[] = [];
    for (const file of kept.files ?? []) {
      const response = await cache.match(file.key);
      if (response) files.push(new File([await response.blob()], file.name || "shared", { type: file.type }));
    }
    await caches.delete(SHARED);
    return { files, title: kept.title ?? "", text: kept.text ?? "", url: kept.url ?? "" };
  } catch {
    return null;
  }
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

/** Files opened with Songverse (Chrome and Edge on computers): each launch's, as it comes. */
export function onLaunchedFiles(take: (files: File[]) => void): void {
  const queue = (window as Window & { launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void } }).launchQueue;
  queue?.setConsumer((params) => {
    if (params.files.length === 0) return;
    void Promise.all(params.files.map((handle) => handle.getFile())).then(take, () => {});
  });
}

/** Words shared without a file, as a file: a new song takes it the same way. */
export function textAsFile(incoming: Pick<Incoming, "title" | "text">): File | null {
  const text = incoming.text.trim();
  if (!text) return null;
  const name = `${incoming.title.trim().replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) || "Shared"}.txt`;
  return new File([text], name, { type: "text/plain" });
}

/** What a new song can be made from: a chart (ChordPro, plain text) or a PDF. */
export function isChartFile(file: File): boolean {
  return /\.(cho|chordpro|chopro|crd|pro|txt|pdf)$/i.test(file.name) || file.type === "text/plain" || file.type === "application/pdf";
}

// Handed from the Import page to the new song's page, in the same tab.
let handed: File | null = null;

export function handOver(file: File): void {
  handed = file;
}

/** The file handed over for a new song, taken once. */
export function takeHandedOver(): File | null {
  const file = handed;
  handed = null;
  return file;
}
