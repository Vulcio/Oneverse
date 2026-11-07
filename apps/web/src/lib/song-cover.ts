/**
 * A song's cover when it has no image of its own (issue #81): a colour from
 * its title and its initials, the same for the same song everywhere - the
 * library's cards, and the lock screen while it plays (issue #173).
 */

/** The same colour for the same song, every time: a hue from its title. */
export function hueOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) | 0;
  return Math.abs(hash) % 360;
}

/** Up to two letters for a title: "Amazing Grace" is "AG", "Hosanna" is "H". */
export function initialsOf(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]!.toUpperCase())
    .join("");
}

/** The cover's two colours, from top left to bottom right. */
export function coverColors(title: string): [string, string] {
  const hue = hueOf(title);
  return [`hsl(${hue} 55% 48%)`, `hsl(${(hue + 40) % 360} 60% 28%)`];
}

// Lucide's music-2, as the library's cover has it in its corner.
const NOTE = ["M12 18V2l7 4", "M4 18a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"];
const COVER_SIZE = 512;

/** The cover drawn as a PNG (512 px), for what can only show an image; null where a canvas can't be drawn. */
async function drawnCover(title: string): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = COVER_SIZE;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const [from, to] = coverColors(title);
  const gradient = g.createLinearGradient(0, 0, COVER_SIZE, COVER_SIZE);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  g.fillStyle = gradient;
  g.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineCap = g.lineJoin = "round";
  const initials = initialsOf(title);
  if (initials) {
    g.font = `600 ${COVER_SIZE * 0.3}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.25)";
    g.shadowBlur = 8;
    g.fillText(initials, COVER_SIZE / 2, COVER_SIZE / 2);
    g.shadowBlur = 0;
  }
  // The note: big in the middle without initials, small in the corner with them.
  const scale = initials ? 2.6 : 8;
  const at = initials ? COVER_SIZE - 24 * scale - 20 : (COVER_SIZE - 24 * scale) / 2;
  g.save();
  g.globalAlpha = initials ? 0.6 : 1;
  g.translate(at, at);
  g.scale(scale, scale);
  g.lineWidth = 2;
  for (const path of NOTE) g.stroke(new Path2D(path));
  g.restore();
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function loads(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });
}

let drawnUrl: string | null = null;

/**
 * The artwork for the lock screen and the Now Playing of a song (issue #173,
 * `MediaMetadata.artwork`): its image at a few widths, when it loads (its
 * address is signed for a day or two, and a copy kept offline can be older);
 * else its drawn cover. The Songverse mark over it comes later.
 */
export async function mediaArtwork(song: { title: string; imageUrl?: string | null }): Promise<MediaImage[]> {
  if (song.imageUrl && (await loads(`${song.imageUrl}&w=512`))) {
    return [96, 256, 512].map((width) => ({ src: `${song.imageUrl}&w=${width}`, sizes: `${width}x${width}` }));
  }
  const blob = await drawnCover(song.title);
  if (!blob) return [];
  // One at a time: the last song's goes as the next one's is made.
  if (drawnUrl) URL.revokeObjectURL(drawnUrl);
  drawnUrl = URL.createObjectURL(blob);
  return [{ src: drawnUrl, sizes: `${COVER_SIZE}x${COVER_SIZE}`, type: "image/png" }];
}
