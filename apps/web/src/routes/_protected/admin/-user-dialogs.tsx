import type { AdminUserSummary, TransferLink } from "@songverse/core";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { Textarea } from "@songverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";

const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;

interface DialogProps {
  user: AdminUserSummary;
  onClose: () => void;
}

/** Runs `action`, keeping the dialog open with the error shown if it fails. */
function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }
  return { pending, error, submit };
}

function ModalShell({ title, description, onClose, children }: { title: string; description: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function BanDialog({ user, onClose, onDone }: DialogProps & { onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const { pending, error, submit } = useSubmit();

  return (
    <ModalShell title={t("admin.banDialogTitle", { name: user.displayName })} description={t("admin.banDialogDescription")} onClose={onClose}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ban-reason">{t("admin.banReasonLabel")}</Label>
        <Textarea id="ban-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("admin.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() =>
            void submit(async () => {
              await apiClient.adminUpdateUser(user.id, { banned: true, banReason: reason.trim() || undefined });
              await onDone();
            })
          }
        >
          {t("admin.confirmBan")}
        </Button>
      </DialogFooter>
    </ModalShell>
  );
}

export function DeleteUserDialog({ user, onClose, onDeleted }: DialogProps & { onDeleted: (link: TransferLink | undefined) => Promise<void> }) {
  const { t } = useTranslation();
  const [contentAction, setContentAction] = useState<"transfer" | "delete">("transfer");
  const [retentionDays, setRetentionDays] = useState(String(DEFAULT_RETENTION_DAYS));
  const [confirmation, setConfirmation] = useState("");
  const { pending, error, submit } = useSubmit();

  const days = Number(retentionDays);
  const daysValid = Number.isInteger(days) && days >= 1 && days <= MAX_RETENTION_DAYS;
  const canSubmit = confirmation.trim().toLowerCase() === user.email.toLowerCase() && (contentAction === "delete" || daysValid);

  const option = (value: "transfer" | "delete", label: string, hint: string, extra?: ReactNode) => (
    <label className="flex cursor-pointer gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input
        type="radio"
        name="content-action"
        value={value}
        checked={contentAction === value}
        onChange={() => setContentAction(value)}
        className="mt-1 accent-primary"
      />
      <span className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
        {extra}
      </span>
    </label>
  );

  return (
    <ModalShell
      title={t("admin.deleteDialogTitle", { name: user.displayName })}
      description={t("admin.deleteDialogDescription", { songs: user.songCount })}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        {option(
          "transfer",
          t("admin.deleteOptionTransfer"),
          t("admin.deleteOptionTransferHint"),
          contentAction === "transfer" ? (
            <span className="mt-2 flex items-center gap-2">
              <Label htmlFor="retention-days" className="text-xs">
                {t("admin.retentionDaysLabel")}
              </Label>
              <Input
                id="retention-days"
                type="number"
                min={1}
                max={MAX_RETENTION_DAYS}
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
                className="h-8 w-24"
              />
            </span>
          ) : null,
        )}
        {option("delete", t("admin.deleteOptionDelete"), t("admin.deleteOptionDeleteHint"))}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="delete-confirmation">{t("admin.confirmDeleteLabel", { email: user.email })}</Label>
        <Input id="delete-confirmation" value={confirmation} autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("admin.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={!canSubmit || pending}
          onClick={() =>
            void submit(async () => {
              const link = await apiClient.adminDeleteUser(user.id, {
                contentAction,
                ...(contentAction === "transfer" && { retentionDays: days }),
              });
              await onDeleted(link ?? undefined);
            })
          }
        >
          {pending ? t("admin.deleting") : t("admin.confirmDelete")}
        </Button>
      </DialogFooter>
    </ModalShell>
  );
}

export function DeleteNowDialog({ user, onClose, onDone }: DialogProps & { onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const { pending, error, submit } = useSubmit();
  return (
    <ModalShell title={t("admin.deleteNowTitle", { name: user.displayName })} description={t("admin.deleteNowDescription")} onClose={onClose}>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("admin.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() =>
            void submit(async () => {
              await apiClient.adminDeleteUser(user.id, { contentAction: "delete" });
              await onDone();
            })
          }
        >
          {pending ? t("admin.deleting") : t("admin.actionDeleteNow")}
        </Button>
      </DialogFooter>
    </ModalShell>
  );
}

export function TransferLinkDialog({ name, link, onClose }: { name: string; link: TransferLink; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <ModalShell
      title={t("admin.transferLinkTitle")}
      description={t("admin.transferLinkDescription", { name, date: new Date(link.expiresAt).toLocaleDateString(i18n.language) })}
      onClose={onClose}
    >
      <div className="flex gap-2">
        <Input readOnly value={link.transferUrl} onFocus={(event) => event.currentTarget.select()} aria-label={t("admin.transferLinkTitle")} />
        <Button
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(link.transferUrl).then(() => {
              setCopied(true);
            })
          }
        >
          {copied ? t("admin.copied") : t("admin.copyLink")}
        </Button>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>{t("admin.done")}</Button>
      </DialogFooter>
    </ModalShell>
  );
}
