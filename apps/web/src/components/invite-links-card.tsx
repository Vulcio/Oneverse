import type { CreateInviteLinkInput, TeamInviteLink, TeamRole } from "@songverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NativeSelect } from "#/components/ui/native-select";

/**
 * A team's or an organisation's invite links (issue #241), for its admins:
 * made with a role, an expiry and a number of uses, copied, revoked.
 */
export function InviteLinksCard({
  links,
  description,
  path,
  onCreate,
  onRevoke,
  onChanged,
  onError,
}: {
  links: TeamInviteLink[];
  description: string;
  /** Where a link leads, from its token: "/join/abc". */
  path: (token: string) => string;
  onCreate: (data: CreateInviteLinkInput) => Promise<unknown>;
  onRevoke: (linkId: string) => Promise<unknown>;
  onChanged: () => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [role, setRole] = useState<TeamRole>("MEMBER");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);
  const url = (token: string) => `${window.location.origin}${path(token)}`;

  async function create() {
    setCreating(true);
    try {
      await onCreate({ role, expiresInDays: expiresInDays ? Number(expiresInDays) : undefined, maxUses: maxUses ? Number(maxUses) : undefined });
      setExpiresInDays("");
      setMaxUses("");
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(linkId: string) {
    setBusyLinkId(linkId);
    try {
      await onRevoke(linkId);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyLinkId(null);
    }
  }

  return (
    <Card data-testid="invite-links">
      <CardHeader>
        <CardTitle className="text-sm">{t("teams.inviteLinks")}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-role">{t("teams.roleForInvite")}</Label>
            <NativeSelect id="link-role" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              <option value="MEMBER">{t("teams.roleMember")}</option>
              <option value="ADMIN">{t("teams.roleAdmin")}</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-expires">{t("teams.expiresInDays")}</Label>
            <Input id="link-expires" type="number" min={1} max={365} value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} placeholder={t("teams.never")} className="w-28" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-max-uses">{t("teams.maxUses")}</Label>
            <Input id="link-max-uses" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder={t("teams.unlimited")} className="w-28" />
          </div>
          <Button onClick={() => void create()} disabled={creating} data-testid="invite-link-create">
            {creating ? t("teams.creatingLink") : t("teams.createInviteLink")}
          </Button>
        </div>

        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("teams.noInviteLinksYet")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {links.map((link) => (
              <li key={link.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs" data-testid="invite-link-url">
                    {url(link.token)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {link.role === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")} · {link.usedCount}
                    {link.maxUses !== null ? `/${link.maxUses}` : ""} {t("teams.uses")}
                    {link.expiresAt ? ` · ${t("teams.expires")} ${new Date(link.expiresAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(url(link.token))}>
                    {t("teams.copyLink")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void revoke(link.id)} disabled={busyLinkId === link.id}>
                    {t("teams.revoke")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
