import type { Suggestion } from "@songverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "@songverse/ui/components/confirm-button";
import { Badge } from "@songverse/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { apiClient } from "#/lib/api-client";

export const isOpenSuggestion = (suggestion: Pick<Suggestion, "state">) => suggestion.state === "OPEN" || suggestion.state === "UNDER_REVIEW";

export function suggestionVariant(state: Suggestion["state"]) {
  if (state === "REJECTED") return "destructive" as const;
  if (state === "WITHDRAWN") return "muted" as const;
  return "default" as const;
}

/**
 * The changes the user suggested to this catalogue song (issue #74), where
 * each stands, with the reviewer's note; an open one can be withdrawn.
 * Nothing shows until there's one.
 */
export function MySuggestionsCard({ songVersionId, refreshKey }: { songVersionId: string; refreshKey: number }) {
  const { t, i18n } = useTranslation();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiClient
      .listSongSuggestions(songVersionId)
      .then(setSuggestions)
      .catch(() => {});
  useEffect(() => {
    void load();
  }, [songVersionId, refreshKey]);

  if (suggestions.length === 0) return null;
  return (
    <Card data-testid="my-suggestions">
      <CardHeader>
        <CardTitle>{t("suggestions.mineTitle")}</CardTitle>
        <CardDescription>{t("suggestions.mineDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {t("history.changed", { what: suggestion.changes.map((change) => t(`history.changes.${change}`)).join(t("history.and")) })}
                </span>
                <Badge variant={suggestionVariant(suggestion.state)}>{t(`suggestions.state${suggestion.state}`)}</Badge>
              </div>
              <span className="text-xs text-muted-foreground">{new Date(suggestion.createdAt).toLocaleDateString(i18n.language)}</span>
              {suggestion.description ? <p className="text-muted-foreground">{suggestion.description}</p> : null}
              {suggestion.reviewNotes ? (
                <p>
                  <span className="font-medium">{t("suggestions.reviewerNote")} </span>
                  {suggestion.reviewNotes}
                </p>
              ) : null}
              {isOpenSuggestion(suggestion) ? (
                <div className="self-start">
                  <ConfirmButton
                    label={t("suggestions.withdraw")}
                    confirmLabel={t("suggestions.confirmWithdraw")}
                    busyLabel={t("suggestions.withdrawing")}
                    cancelLabel={t("songEditor.cancel")}
                    busy={busy}
                    onConfirm={async () => {
                      setBusy(true);
                      try {
                        await apiClient.withdrawSuggestion(suggestion.id);
                        await load();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
