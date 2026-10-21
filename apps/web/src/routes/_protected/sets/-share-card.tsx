import type { SetlistSharing } from "@oneverse/core";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@oneverse/ui/components/avatar";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { apiClient } from "#/lib/api-client";
import { sizedAvatarUrl } from "@oneverse/ui/lib/avatar-url";
import { initials } from "@oneverse/ui/lib/initials";

/** Share link and guest list, for the set's editors. */
export function ShareCard({ setlistId }: { setlistId: string }) {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState<SetlistSharing | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getSetlistSharing(setlistId)
      .then((result) => !cancelled && setSharing(result))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [setlistId]);

  async function run(change: Promise<SetlistSharing>) {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      setSharing(await change);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const url = sharing?.link ? `${window.location.origin}/set-invite/${sharing.link.token}` : null;

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("sets.share")}</CardTitle>
        <CardDescription>{t("sets.shareDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sharing === null ? null : url ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Input readOnly value={url} aria-label={t("sets.share")} onFocus={(event) => event.target.select()} />
              <Button type="button" variant="outline" onClick={() => void copy()}>
                {copied ? <Check /> : <Copy />}
                {copied ? t("sets.copied") : t("sets.copyLink")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("sets.resetLinkHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void run(apiClient.resetSetlistShareLink(setlistId))}
              >
                {t("sets.resetLink")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => void run(apiClient.removeSetlistShareLink(setlistId))}
              >
                {t("sets.turnOffLink")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">{t("sets.shareOff")}</p>
            <Button type="button" size="sm" disabled={pending} onClick={() => void run(apiClient.resetSetlistShareLink(setlistId))}>
              {t("sets.turnOnLink")}
            </Button>
          </div>
        )}

        {sharing ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-sm font-medium">{t("sets.guests")}</p>
            {sharing.guests.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("sets.noGuests")}</p>
            ) : (
              <ul className="flex flex-col divide-y" data-testid="set-guests">
                {sharing.guests.map((guest) => (
                  <li key={guest.userId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-8 shrink-0">
                        {guest.avatarUrl ? <AvatarImage src={sizedAvatarUrl(guest.avatarUrl, 32)} alt="" /> : null}
                        <AvatarFallback className="text-xs">{initials(guest.displayName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{guest.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">{guest.email}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={pending}
                      aria-label={t("sets.removeGuest", { name: guest.displayName })}
                      onClick={() => void run(apiClient.removeSetlistGuest(setlistId, guest.userId))}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
