import { ChevronRight, ExternalLink } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@oneverse/ui/components/collapsible";

/**
 * A step's text, with its links and the app's own words picked out (issue #518):
 * "[label](https://…)" is a link, opened in a new tab; "**Save**" is a button
 * or menu named as it shows. The rest is plain text, never HTML.
 */
export function GuideText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    if (match[1] && match[2]) {
      parts.push(
        <a key={at} href={match[2]} target="_blank" rel="noreferrer" className="inline-flex items-baseline gap-0.5 font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
          {match[1]}
          <ExternalLink className="size-3 shrink-0 self-center" aria-hidden />
        </a>,
      );
    } else {
      parts.push(<strong key={at} className="font-medium text-foreground">{match[3]}</strong>);
    }
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}

/**
 * "How to set it up": numbered steps with links to the right console pages,
 * open by default while the service isn't set up yet (issue #518).
 */
export function SetupGuide({ steps, intro, note, defaultOpen = false, testId }: { steps: string[]; intro?: string; note?: string; defaultOpen?: boolean; testId?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border bg-background" data-testid={testId}>
      <CollapsibleTrigger
        render={<button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-muted/50" />}
      >
        <ChevronRight className={`size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        {t("metadataProviders.setupTitle")}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 border-t px-3 py-3 text-sm text-muted-foreground">
        {intro ? (
          <p>
            <GuideText text={intro} />
          </p>
        ) : null}
        <ol className="flex flex-col gap-2">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 leading-relaxed">
                <GuideText text={step} />
              </span>
            </li>
          ))}
        </ol>
        {note ? (
          <p className="text-xs">
            <GuideText text={note} />
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A guide from the locale: metadataProviders.setup.<key> (steps, and an intro and a note when it has them). */
export function ProviderSetupGuide({ guide, defaultOpen }: { guide: "youtube" | "spotify" | "apple_music" | "musicbrainz" | "youversion"; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const steps = t(`metadataProviders.setup.${guide}.steps`, { returnObjects: true }) as unknown as string[];
  const intro = t(`metadataProviders.setup.${guide}.intro`, { defaultValue: "" });
  const note = t(`metadataProviders.setup.${guide}.note`, { defaultValue: "" });
  return <SetupGuide steps={Array.isArray(steps) ? steps : []} intro={intro || undefined} note={note || undefined} defaultOpen={defaultOpen} testId={`setup-${guide}`} />;
}
