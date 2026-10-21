import { cn } from "@oneverse/ui/lib/utils";

// Soft colours that read in light and dark themes alike, one per artist.
const HUES = [15, 45, 90, 150, 190, 220, 265, 310, 340];

/**
 * An artist's round picture (issue #86): theirs when there's one, else
 * their initials on a colour that's always the same for the same name.
 */
export function ArtistPicture({ name, imageUrl, size = "card" }: { name: string; imageUrl?: string | null; size?: "card" | "large" }) {
  const box = size === "large" ? "size-28 text-3xl sm:size-36 sm:text-4xl" : "size-20 text-xl sm:size-24 sm:text-2xl";
  if (imageUrl) {
    return <img src={`${imageUrl}&w=320`} alt="" loading="lazy" data-testid="artist-image" className={cn("shrink-0 rounded-full object-cover shadow-sm", box)} />;
  }
  const hue = HUES[[...name.toLowerCase()].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % HUES.length]!;
  const initials = name
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join("");
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-sm", box)}
      style={{ backgroundColor: `oklch(62% 0.12 ${hue})` }}
      data-testid="artist-initials"
      aria-hidden
    >
      {initials || "♪"}
    </span>
  );
}
