import type { CustomInstrument, TechRoleValue } from "@oneverse/core";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { useInstrumentLabel } from "../instruments";
import { cn } from "@oneverse/ui/lib/utils";

/** A user's instruments and other roles (dashboard > Roles), instruments first. */
export function RoleBadges({
  instruments,
  techRoles,
  customInstruments,
  className,
}: {
  instruments: readonly string[];
  /** The instruments an admin added (issue #166), to name those among `instruments`. */
  customInstruments?: readonly CustomInstrument[];
  techRoles: readonly TechRoleValue[];
  className?: string;
}) {
  const { t } = useTranslation();
  const instrumentLabel = useInstrumentLabel(customInstruments);
  if (instruments.length === 0 && techRoles.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1", className)} aria-label={t("roles.title")}>
      {instruments.map((instrument) => (
        <li key={instrument}>
          <Badge>{instrumentLabel(instrument)}</Badge>
        </li>
      ))}
      {techRoles.map((role) => (
        <li key={role}>
          <Badge variant="muted">{t(`roles.techRole.${role}`)}</Badge>
        </li>
      ))}
    </ul>
  );
}
