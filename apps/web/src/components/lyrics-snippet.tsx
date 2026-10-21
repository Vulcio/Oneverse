import type { LyricsMatch } from "@oneverse/core";
import { Fragment } from "react";

/** The line a lyrics search found (issue #221), the words found in bold. */
export function LyricsSnippet({ match, className }: { match: LyricsMatch; className?: string }) {
  const pieces: { text: string; found: boolean }[] = [];
  let at = 0;
  for (const [start, end] of [...match.found].sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    if (start > at) pieces.push({ text: match.text.slice(at, start), found: false });
    pieces.push({ text: match.text.slice(start, end), found: true });
    at = end;
  }
  if (at < match.text.length) pieces.push({ text: match.text.slice(at), found: false });
  return (
    <span className={className} data-testid="lyrics-snippet">
      “
      {pieces.map((piece, i) => (
        <Fragment key={i}>{piece.found ? <strong className="font-semibold text-foreground">{piece.text}</strong> : piece.text}</Fragment>
      ))}
      ”
    </span>
  );
}
