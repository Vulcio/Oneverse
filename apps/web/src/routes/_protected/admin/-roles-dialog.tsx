import type { AdminRole } from "@songverse/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { formatBytes } from "#/lib/format-bytes";

/** A role's short account of what it allows, for a list or a badge's title. */
export function useRoleSummary() {
  const { t } = useTranslation();
  return (role: Pick<AdminRole, "canReview" | "canSeparateStems" | "canKeepLosslessAudio" | "canUploadAudio" | "stemSeparationMonthlyLimit" | "storageLimitMb">) =>
    [
      role.canReview ? t("admin.roleAllowsReview") : null,
      role.canSeparateStems
        ? role.stemSeparationMonthlyLimit === null
          ? t("admin.roleAllowsStems")
          : t("admin.roleAllowsStemsLimited", { count: role.stemSeparationMonthlyLimit })
        : null,
      role.canUploadAudio ? t("admin.roleAllowsAudioUploads") : null,
      role.canKeepLosslessAudio ? t("admin.roleAllowsLossless") : null,
      role.storageLimitMb === null ? null : t("admin.roleStorage", { size: formatBytes(role.storageLimitMb * 1024 * 1024) }),
    ]
      .filter(Boolean)
      .join(" · ");
}

/**
 * The roles a user or a team has (issue #160), ticked on or off. What a
 * user gets through their teams is shown alongside, not editable here.
 */
export function RolesDialog({
  title,
  description,
  roles,
  selected,
  inherited = [],
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  roles: AdminRole[];
  selected: string[];
  inherited?: { id: string; name: string; teamName: string }[];
  onClose: () => void;
  onSave: (roleIds: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const summary = useRoleSummary();
  const [chosen, setChosen] = useState(() => new Set(selected));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      await onSave([...chosen]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("admin.rolesNone")}{" "}
            <Link to="/admin/roles" className="underline">
              {t("nav.adminRoles")}
            </Link>
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto" data-testid="roles-dialog-list">
            {roles.map((role) => (
              <li key={role.id}>
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={chosen.has(role.id)}
                    onChange={(event) => {
                      const next = new Set(chosen);
                      if (event.target.checked) next.add(role.id);
                      else next.delete(role.id);
                      setChosen(next);
                    }}
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{role.name}</span>
                    <span className="text-xs text-muted-foreground">{summary(role) || role.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {inherited.length ? (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="font-medium">{t("admin.rolesFromTeams")}</span>
            {inherited.map((role) => (
              <span key={`${role.id}-${role.teamName}`}>{t("admin.roleFromTeam", { role: role.name, team: role.teamName })}</span>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("admin.cancel")}
          </Button>
          <Button type="button" disabled={pending} onClick={() => void save()} data-testid="roles-dialog-save">
            {pending ? t("admin.saving") : t("admin.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
