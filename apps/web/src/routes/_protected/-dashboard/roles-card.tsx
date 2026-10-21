import { INSTRUMENTS, TECH_ROLES, type CustomInstrument, type UserProfile } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { useInstrumentLabel } from "@oneverse/planning/instruments";
import { cn } from "@oneverse/ui/lib/utils";

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/** A group of on/off chips; any number can be on. */
function ChipGroup<T extends string>({
  label,
  options,
  selected,
  labelFor,
  onToggle,
  disabled,
}: {
  label: string;
  options: readonly T[];
  selected: readonly T[];
  labelFor: (option: T) => string;
  onToggle: (option: T) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(option)}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
                on ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-muted",
              )}
            >
              {on ? <Check className="size-3.5" /> : null}
              {labelFor(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

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
