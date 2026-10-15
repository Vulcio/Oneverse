import { Avatar, AvatarFallback, AvatarImage } from "@songverse/ui/components/avatar";
import { cn } from "@songverse/ui/lib/utils";

/** Someone's small round picture, or their initials. */
export function PersonAvatar({ name, avatarUrl, size = 20, className }: { name: string; avatarUrl: string | null; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <Avatar className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback className="bg-amber-200 font-sans font-semibold text-amber-950 dark:bg-amber-300" style={{ fontSize: Math.max(8, Math.round(size * 0.42)) }}>
        {initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}
