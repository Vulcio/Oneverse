import { entityColor, type EntityColor } from "@oneverse/core";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { sizedAvatarUrl } from "../lib/avatar-url";
import { initials } from "../lib/initials";
import { cn } from "../lib/utils";

/** Each colour's swatch and initials, in shades that read on light and dark themes (issue #161). */
export const ENTITY_COLOR_CLASSES: Record<EntityColor, string> = {
  red: "bg-red-600 text-white dark:bg-red-500",
  orange: "bg-orange-600 text-white dark:bg-orange-500",
  amber: "bg-amber-500 text-amber-950",
  lime: "bg-lime-500 text-lime-950",
  green: "bg-green-600 text-white dark:bg-green-500",
  teal: "bg-teal-600 text-white dark:bg-teal-500",
  sky: "bg-sky-600 text-white dark:bg-sky-500",
  blue: "bg-blue-600 text-white dark:bg-blue-500",
  violet: "bg-violet-600 text-white dark:bg-violet-500",
  pink: "bg-pink-600 text-white dark:bg-pink-500",
};

/**
 * A team's or a songbook's avatar (issue #161): its picture, or its
 * initials on its colour - the chosen one, else one from its name. Rounded
 * squares, so they don't read as people.
 */
export function EntityAvatar({
  name,
  color,
  avatarUrl,
  size = 24,
  className,
}: {
  name: string;
  color: string | null | undefined;
  avatarUrl?: string | null;
  /** Pixels it's drawn at. */
  size?: number;
  className?: string;
}) {
  return (
    <Avatar className={cn("rounded-md", className)} style={{ width: size, height: size }} data-testid="entity-avatar">
      {avatarUrl ? <AvatarImage src={sizedAvatarUrl(avatarUrl, size)} alt="" className="rounded-md object-cover" /> : null}
      <AvatarFallback
        className={cn("rounded-md font-semibold", ENTITY_COLOR_CLASSES[entityColor(color, name)])}
        style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}
        data-color={entityColor(color, name)}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
