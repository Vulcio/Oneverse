import { textSlides, type SetlistItemText } from "@oneverse/core";

/** A text item's slides, one after the other, as a player reads them in the set or in Live. */
export function TextItemSlides({ text, className }: { text: SetlistItemText; className?: string }) {
  return (
    <div className={`flex flex-col gap-6 ${className ?? ""}`} data-testid="set-text-slides">
      {textSlides(text).map((slide) => (
        <p key={slide.passId} className="text-xl leading-relaxed whitespace-pre-line">
          {slide.lines.join("\n")}
        </p>
      ))}
    </div>
  );
}
