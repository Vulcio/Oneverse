import type { CreateRoleRequest } from "@oneverse/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";

/** What a role allows, all optional: the server's roles have every field, a team's or an organisation's some. */
export type EditableRole = { name: string; description: string } & Partial<
  Record<"canReview" | "canSeparateStems" | "canKeepLosslessAudio" | "canUploadAudio" | "canOperateScreens" | "canCue" | "canRoute" | "canManageScreens" | "canUseOwnStorage" | "canStoreFiles" | "teamAssignable", boolean>
> & { stemSeparationMonthlyLimit?: number | null; storageLimitMb?: number | null };

/**
 * Whose role it is: the server's (Admin > Roles), an organisation's own, or a
 * team's own (issue #206). The same editor, the same rules: an organisation's
 * and a team's offer only what's theirs to allow - stems on their own Sonic
 * server and their sets' screens, and, an organisation's, room in its own
 * bucket and audio uploads there.
 */
export type RoleEditorKind = "server" | "organization" | "team";

export function RoleEditor({ kind, role, onClose, onSubmit }: { kind: RoleEditorKind; role: EditableRole | null; onClose: () => void; onSubmit: (data: CreateRoleRequest & { canStoreFiles?: boolean }) => Promise<void> }) {
  const { t } = useTranslation();
  const server = kind === "server";
  const organization = kind === "organization";
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [canReview, setCanReview] = useState(role?.canReview ?? false);
  const [canSeparateStems, setCanSeparateStems] = useState(role?.canSeparateStems ?? false);
  const [canKeepLossless, setCanKeepLossless] = useState(role?.canKeepLosslessAudio ?? false);
  const [canUploadAudio, setCanUploadAudio] = useState(role?.canUploadAudio ?? false);
  const [canOperateScreens, setCanOperateScreens] = useState(role?.canOperateScreens ?? false);
  const [canCue, setCanCue] = useState(role?.canCue ?? false);
  const [canRoute, setCanRoute] = useState(role?.canRoute ?? false);
  const [canManageScreens, setCanManageScreens] = useState(role?.canManageScreens ?? false);
  const [canUseOwnStorage, setCanUseOwnStorage] = useState(role?.canUseOwnStorage ?? false);
  const [teamAssignable, setTeamAssignable] = useState(role?.teamAssignable ?? false);
  const [canStoreFiles, setCanStoreFiles] = useState(role?.canStoreFiles ?? false);
  const [monthlyLimit, setMonthlyLimit] = useState(role?.stemSeparationMonthlyLimit?.toString() ?? "");
  const [hasStorage, setHasStorage] = useState(role?.storageLimitMb != null);
  const [storageMb, setStorageMb] = useState(role?.storageLimitMb?.toString() ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    const data: CreateRoleRequest & { canStoreFiles?: boolean } = {
      name: name.trim(),
      description: description.trim(),
      canSeparateStems,
      stemSeparationMonthlyLimit: canSeparateStems && monthlyLimit.trim() ? Number(monthlyLimit) : null,
      canOperateScreens,
      canCue,
      canRoute,
      canManageScreens,
      ...(server || organization ? { canUploadAudio, canKeepLosslessAudio: canKeepLossless, storageLimitMb: hasStorage && storageMb.trim() ? Number(storageMb) : null } : {}),
      ...(server ? { canReview, canUseOwnStorage, teamAssignable } : {}),
      // An organisation's: keeping files in its bucket, its tier there optional (else its default).
      ...(organization ? { canStoreFiles, storageLimitMb: canStoreFiles && storageMb.trim() ? Number(storageMb) : null } : {}),
    };
    try {
      await onSubmit(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  // An organisation's or a team's own role says where it counts.
  const hint = (key: string) => (server ? t(`admin.${key}Hint`) : t(`ownRoles.${key}Hint`, { defaultValue: t(`admin.${key}Hint`) }));
  const check = (checked: boolean, onChange: (value: boolean) => void, label: string, hintText: string, testId: string) => (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 size-4" checked={checked} onChange={(event) => onChange(event.target.checked)} data-testid={testId} />
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hintText}</span>
      </span>
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? t("admin.roleEditTitle", { name: role.name }) : t("admin.roleNew")}</DialogTitle>
          <DialogDescription>{server ? t("admin.roleEditDescription") : t(organization ? "ownRoles.editDescriptionOrganization" : "ownRoles.editDescriptionTeam")}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-name">{t("admin.roleName")}</Label>
            <Input id="role-name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} data-testid="role-name" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role-description">{t("admin.roleDescriptionLabel")}</Label>
            <Textarea id="role-description" maxLength={300} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t("admin.roleAllows")}</legend>
            {server ? check(canReview, setCanReview, t("admin.roleReview"), hint("roleReview"), "role-review") : null}
            {check(canSeparateStems, setCanSeparateStems, t("admin.roleStems"), hint("roleStems"), "role-stems")}
            {canSeparateStems ? (
              <div className="ml-7 flex flex-col gap-1.5">
                <Label htmlFor="role-stems-limit">{t("admin.roleStemsLimit")}</Label>
                <Input id="role-stems-limit" type="number" min={1} max={10000} value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value)} className="max-w-40" data-testid="role-stems-limit" />
                <span className="text-xs text-muted-foreground">{hint("roleStemsLimit")}</span>
              </div>
            ) : null}
            {server || organization ? check(canUploadAudio, setCanUploadAudio, t("admin.roleAudioUploads"), hint("roleAudioUploads"), "role-audio-uploads") : null}
            {server || organization ? check(canKeepLossless, setCanKeepLossless, t("admin.roleLossless"), hint("roleLossless"), "role-lossless") : null}
            {check(canOperateScreens, setCanOperateScreens, t("admin.roleOperateScreens"), hint("roleOperateScreens"), "role-operate-screens")}
            {check(canCue, setCanCue, t("admin.roleCue"), hint("roleCue"), "role-cue")}
            {check(canRoute, setCanRoute, t("admin.roleRoute"), hint("roleRoute"), "role-route")}
            {check(canManageScreens, setCanManageScreens, t("admin.roleManageScreens"), hint("roleManageScreens"), "role-manage-screens")}
            {server ? check(canUseOwnStorage, setCanUseOwnStorage, t("admin.roleOwnStorage"), hint("roleOwnStorage"), "role-own-storage") : null}
            {server ? check(teamAssignable, setTeamAssignable, t("admin.roleTeamAssignable"), hint("roleTeamAssignable"), "role-team-assignable") : null}
            {server ? check(hasStorage, setHasStorage, t("admin.roleStorageTier"), hint("roleStorageTier"), "role-storage") : null}
            {hasStorage && server ? (
              <div className="ml-7 flex flex-col gap-1.5">
                <Label htmlFor="role-storage-mb">{t("admin.roleStorageMb")}</Label>
                <Input id="role-storage-mb" type="number" min={0} required value={storageMb} onChange={(event) => setStorageMb(event.target.value)} className="max-w-40" data-testid="role-storage-mb" />
              </div>
            ) : null}
            {organization ? check(canStoreFiles, setCanStoreFiles, t("ownRoles.storeFiles"), t("ownRoles.storeFilesHint"), "role-store-files") : null}
            {organization && canStoreFiles ? (
              <div className="ml-7 flex flex-col gap-1.5">
                <Label htmlFor="role-storage-mb">{t("admin.roleStorageMb")}</Label>
                <Input id="role-storage-mb" type="number" min={0} value={storageMb} onChange={(event) => setStorageMb(event.target.value)} className="max-w-40" data-testid="role-storage-mb" />
                <span className="text-xs text-muted-foreground">{t("ownRoles.storageMbHint")}</span>
              </div>
            ) : null}
          </fieldset>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("admin.cancel")}
            </Button>
            <Button type="submit" disabled={pending} data-testid="role-save">
              {pending ? t("admin.saving") : t("admin.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
