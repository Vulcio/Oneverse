import type { AdminUserSummary, TransferLink } from "@songverse/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@songverse/ui/components/card";
import { DataTable } from "@songverse/ui/components/data-table";
import { apiClient } from "#/lib/api-client";
import { InvitationsCard } from "./-invitations-card";
import { RolesDialog } from "./-roles-dialog";
import { BanDialog, DeleteNowDialog, DeleteUserDialog, TransferLinkDialog } from "./-user-dialogs";
import { useUsersColumns, type UserAction } from "./-users-columns";

export const Route = createFileRoute("/_protected/admin/users")({
  loader: async () => {
    const [users, roles, security, invitations] = await Promise.all([
      apiClient.adminListUsers(),
      apiClient.adminListRoles(),
      apiClient.adminGetSecuritySettings(),
      apiClient.adminListSignupInvitations(),
    ]);
    return { users, roles, inviteOnly: security.settings.signupInviteOnly, invitations };
  },
  component: AdminUsersPage,
});

type OpenDialog =
  | { kind: "roles" | "ban" | "delete" | "deleteNow"; user: AdminUserSummary }
  | { kind: "link"; name: string; link: TransferLink };

function AdminUsersPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = Route.useRouteContext();
  const { users, roles, inviteOnly, invitations } = Route.useLoaderData();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await router.invalidate();
  }, [router]);

  const closeAndRefresh = useCallback(async () => {
    setDialog(null);
    await refresh();
  }, [refresh]);

  const onAction = useCallback(
    (action: UserAction, user: AdminUserSummary) => {
      setActionError(null);
      if (action === "unban") {
        void apiClient
          .adminUpdateUser(user.id, { banned: false })
          .then(refresh)
          .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (action === "newTransferLink") {
        void apiClient
          .adminRegenerateTransferLink(user.id)
          .then((link) => setDialog({ kind: "link", name: user.displayName, link }))
          .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)));
        return;
      }
      setDialog({ kind: action, user });
    },
    [refresh],
  );

  const columns = useUsersColumns(session.userId, onAction);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("nav.adminUsers")}</h1>
        <p className="text-sm text-muted-foreground">{t("admin.usersDescription")}</p>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      <Card className="p-0">
        <DataTable columns={columns} data={users} filterPlaceholder={t("admin.usersFilterPlaceholder")} />
      </Card>

      {/* Who can sign up (issue #198). */}
      <InvitationsCard inviteOnly={inviteOnly} invitations={invitations} />

      {dialog?.kind === "roles" ? (
        <RolesDialog
          title={t("admin.userRolesTitle", { name: dialog.user.displayName })}
          description={t("admin.userRolesDescription")}
          roles={roles}
          selected={dialog.user.roles.map((role) => role.id)}
          inherited={dialog.user.teamRoles}
          onClose={() => setDialog(null)}
          onSave={async (roleIds) => {
            await apiClient.adminSetUserRoles(dialog.user.id, { roleIds });
            await closeAndRefresh();
          }}
        />
      ) : null}
      {dialog?.kind === "ban" ? <BanDialog user={dialog.user} onClose={() => setDialog(null)} onDone={closeAndRefresh} /> : null}
      {dialog?.kind === "delete" ? (
        <DeleteUserDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDeleted={async (link) => {
            setDialog(link ? { kind: "link", name: dialog.user.displayName, link } : null);
            await refresh();
          }}
        />
      ) : null}
      {dialog?.kind === "deleteNow" ? (
        <DeleteNowDialog user={dialog.user} onClose={() => setDialog(null)} onDone={closeAndRefresh} />
      ) : null}
      {dialog?.kind === "link" ? <TransferLinkDialog name={dialog.name} link={dialog.link} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
