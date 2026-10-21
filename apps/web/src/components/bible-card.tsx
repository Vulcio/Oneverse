import { BookOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";

/**
 * The Bible in the sidebar (issue #310), on a team's or an organisation's
 * page for its admins: off until they turn it on, for their members (an
 * organisation's: the members of its teams). A team in an organisation that
 * turned it on has it already.
 */
export function BibleCard({ enabled, fromOrganization, onChange }: { enabled: boolean; fromOrganization?: string | null; onChange: (enabled: boolean) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card data-testid="bible-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpen className="size-4" aria-hidden />
          {t("biblePage.title")}
        </CardTitle>
        <CardDescription>{t("biblePage.cardDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={on || !!fromOrganization}
            disabled={busy || !!fromOrganization}
            onChange={(event) => {
              const next = event.target.checked;
              setBusy(true);
              setError(null);
              void onChange(next)
                .then(
                  () => setOn(next),
                  (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
                )
                .finally(() => setBusy(false));
            }}
            data-testid="bible-enabled"
          />
          {t("biblePage.enable")}
        </label>
        {fromOrganization ? <p className="text-xs text-muted-foreground">{t("biblePage.fromOrganization", { name: fromOrganization })}</p> : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
