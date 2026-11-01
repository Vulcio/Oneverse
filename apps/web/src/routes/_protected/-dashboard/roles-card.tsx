import { INSTRUMENTS, TECH_ROLES, type CustomInstrument, type UserProfile } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { useInstrumentLabel } from "@oneverse/planning/instruments";
import { ChipGroup, sameSet, toggled } from "#/components/role-chips";

export function RolesCard({ profile, customInstruments }: { profile: UserProfile; customInstruments: readonly CustomInstrument[] }) {
  const { t } = useTranslation();
  const instrumentLabel = useInstrumentLabel(customInstruments);
  // The built-in ones, then those an admin added (issue #166).
  const instrumentOptions = [...INSTRUMENTS, ...customInstruments.map((instrument) => instrument.id)];
  const router = useRouter();
  const [instruments, setInstruments] = useState(profile.instruments);
  const [techRoles, setTechRoles] = useState(profile.techRoles);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setInstruments(profile.instruments);
    setTechRoles(profile.techRoles);
  }, [profile.instruments, profile.techRoles]);

  const dirty = !sameSet(instruments, profile.instruments) || !sameSet(techRoles, profile.techRoles);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      await apiClient.updateMe({ instruments, techRoles });
      await router.invalidate();
      setMessage({ kind: "ok", text: t("roles.saved") });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="roles">
      <CardHeader>
        <CardTitle className="text-sm">{t("roles.title")}</CardTitle>
        <CardDescription>{t("roles.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ChipGroup
            label={t("roles.instrumentsLabel")}
            options={instrumentOptions}
            selected={instruments}
            labelFor={instrumentLabel}
            onToggle={(instrument) => {
              setMessage(null);
              setInstruments((current) => toggled(current, instrument));
            }}
            disabled={pending}
          />
          <ChipGroup
            label={t("roles.techRolesLabel")}
            options={TECH_ROLES}
            selected={techRoles}
            labelFor={(role) => t(`roles.techRole.${role}`)}
            onToggle={(role) => {
              setMessage(null);
              setTechRoles((current) => toggled(current, role));
            }}
            disabled={pending}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || !dirty}>
              {pending ? t("roles.saving") : t("roles.save")}
            </Button>
            {message ? (
              <p className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
