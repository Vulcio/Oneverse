import { Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { cn } from "@oneverse/ui/lib/utils";
import { useLive } from "../host";

/**
 * "Continue on Pulse" (issue #247, docs/live-session.md): while this device
 * can't reach the cloud and the set has a Pulse it holds a pass to, a link to
 * Pulse's own page on the venue's network. Nothing otherwise. In Live and the
 * operator's console.
 */
export function ContinueOnPulse({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { ready, pulseLink } = useLive();
  if (ready || !pulseLink) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm", className)} data-testid="continue-on-pulse">
      <p className="min-w-0 flex-1">{t("screens.continueOnPulseHint")}</p>
      <Button size="sm" render={<a href={pulseLink} />}>
        <Radio />
        {t("screens.continueOnPulse")}
      </Button>
    </div>
  );
}
