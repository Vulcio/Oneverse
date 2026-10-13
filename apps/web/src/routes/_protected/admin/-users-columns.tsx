import type { AdminUserSummary } from "@songverse/core";
import type { Column, ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@songverse/ui/components/avatar";
import { Badge } from "@songverse/ui/components/badge";
import { Button } from "@songverse/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@songverse/ui/components/dropdown-menu";
import { sizedAvatarUrl } from "#/lib/avatar-url";
import { formatBytes } from "#/lib/format-bytes";
import { initials } from "#/lib/initials";
import { cn } from "@songverse/ui/lib/utils";

export type UserAction = "roles" | "ban" | "unban" | "delete" | "newTransferLink" | "deleteNow";

function sortableHeader(label: string) {
  return function SortableHeader({ column }: { column: Column<AdminUserSummary, unknown> }) {
    return (
      <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        {label}
        <ArrowUpDown />
      </Button>
    );
  };
}

function StatusBadges({ user, className }: { user: AdminUserSummary; className?: string }) {
  const { t, i18n } = useTranslation();
  if (user.deletedAt && user.transferExpiresAt) {
    return (
      <div className={className}>
        <Badge variant="warning">
          {t("admin.statusPendingTransfer", { date: new Date(user.transferExpiresAt).toLocaleDateString(i18n.language) })}
        </Badge>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {user.bannedAt ? (
        <Badge variant="destructive" title={user.banReason ?? undefined}>
          {t("admin.statusBanned")}
        </Badge>
      ) : null}
      <Badge variant={user.emailVerified ? "muted" : "warning"}>
        {user.emailVerified ? t("admin.statusVerified") : t("admin.statusUnverified")}
      </Badge>
    </div>
  );
}

export function useUsersColumns(currentUserId: string, onAction: (action: UserAction, user: AdminUserSummary) => void) {
  const { t, i18n } = useTranslation();

  return useMemo<ColumnDef<AdminUserSummary>[]>(() => {
    const formatDate = (value: string) => new Date(value).toLocaleDateString(i18n.language);

    return [
      {
        id: "user",
        // Name and email together, so the table's search box matches either.
        accessorFn: (user) => `${user.displayName} ${user.email}`,
        header: sortableHeader(t("admin.columnUser")),
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar className="size-8 shrink-0">
                {user.avatarUrl ? <AvatarImage src={sizedAvatarUrl(user.avatarUrl, 32)} alt="" /> : null}
                <AvatarFallback className="text-xs">{initials(user.displayName)}</AvatarFallback>
              </Avatar>
              {/* Capped so long emails truncate: a table column otherwise grows to fit them. */}
              <div className="max-w-48 min-w-0 sm:max-w-xs">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                  <span className="truncate">{user.displayName}</span>
                  {user.id === currentUserId ? <span className="text-xs font-normal text-muted-foreground">({t("admin.you")})</span> : null}
                  {user.isGlobalAdmin ? <Badge>{t("admin.globalAdmin")}</Badge> : null}
                </p>
                {/* Their roles (issue #160): their own, then their teams'. */}
                {user.roles.length || user.teamRoles.length ? (
                  <p className="mt-1 flex flex-wrap gap-1" data-testid="user-roles">
                    {user.roles.map((role) => (
                      <Badge key={role.id} variant="muted">
                        {role.name}
                      </Badge>
                    ))}
                    {user.teamRoles.map((role) => (
                      <Badge key={`${role.id}-${role.teamName}`} variant="outline" title={t("admin.roleFromTeam", { role: role.name, team: role.teamName })}>
                        {role.name}
                      </Badge>
                    ))}
                  </p>
                ) : null}
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                {/* The Status column is hidden on phones. */}
                <StatusBadges user={user} className="mt-1 sm:hidden" />
              </div>
            </div>
          );
        },
      },
      {
        id: "status",
        accessorFn: (user) =>
          user.deletedAt ? "deleted" : user.bannedAt ? "banned" : user.emailVerified ? "verified" : "unverified",
        header: t("admin.columnStatus"),
        meta: { secondary: true },
        cell: ({ row }) => <StatusBadges user={row.original} />,
      },
      {
        accessorKey: "songCount",
        meta: { secondary: true },
        header: sortableHeader(t("admin.columnSongs")),
      },
      {
        accessorKey: "usedBytes",
        meta: { secondary: true },
        header: sortableHeader(t("admin.columnStorage")),
        cell: ({ row }) => {
          const user = row.original;
          return (
            <div className="text-sm">
              <p>
                {formatBytes(user.usedBytes)} / {user.limitBytes === null ? t("admin.storageUnlimited") : formatBytes(user.limitBytes)}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "createdAt",
        meta: { secondary: true },
        header: sortableHeader(t("admin.columnJoined")),
        cell: ({ row }) => <span className="text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
      },
      {
        id: "actions",
        header: () => null,
        enableSorting: false,
        cell: ({ row }) => {
          const user = row.original;
          const isSelf = user.id === currentUserId;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" aria-label={t("admin.userActions", { name: user.displayName })} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {user.deletedAt ? (
                  <>
                    <DropdownMenuItem onClick={() => onAction("newTransferLink", user)}>{t("admin.actionNewTransferLink")}</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => onAction("deleteNow", user)}>
                      {t("admin.actionDeleteNow")}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => onAction("roles", user)}>{t("admin.actionRoles")}</DropdownMenuItem>
                    {isSelf ? null : (
                      <>
                        {user.bannedAt ? (
                          <DropdownMenuItem onClick={() => onAction("unban", user)}>{t("admin.actionUnban")}</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => onAction("ban", user)}>{t("admin.actionBan")}</DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => onAction("delete", user)}>
                          {t("admin.actionDelete")}
                        </DropdownMenuItem>
                      </>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ];
  }, [t, i18n.language, currentUserId, onAction]);
}
