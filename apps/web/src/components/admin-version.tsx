import { Link } from "@tanstack/react-router";
import type { ServerVersionInfo } from "@oneverse/core";
import { cn } from "@oneverse/ui/lib/utils";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";

/**
 * The version running, at the foot of Admin's sidebar (issue #164), so it's seen from every admin
 * page; it opens Metadata, whose Background jobs card has the commit, the migration and the Worker's.
 */
export function AdminVersion({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<ServerVersionInfo | null>(null);

  useEffect(() => {
    let live = true;
    apiClient
      .getServerVersion()
      .then((answer) => {
        if (live) setInfo(answer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!info) return null;
  return (
    <Link
      to="/admin/metadata"
      data-testid="admin-version"
      title={info.commit ?? undefined}
      className={cn("block px-4 py-3 text-xs text-muted-foreground hover:text-foreground", className)}
    >
      {t("jobs.version", { version: info.version })}
    </Link>
  );
}
