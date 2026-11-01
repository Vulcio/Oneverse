import type { OrganizationSetup } from "@oneverse/core";
import { CircleCheck, Circle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";

const DOCS = "https://docs.oneverse.top";

/** A page of the user documentation, in the reader's language: its headings' anchors are too. */
function guide(language: string, path: { en: string; fr: string }) {
  return language.startsWith("fr") ? `${DOCS}/fr${path.fr}` : `${DOCS}${path.en}`;
}

/**
 * Its admins' setup checklist (issue #364), at the top of a new
 * organisation's page until they put it away: people in, its groups, their
 * rights, then - where this server allows them and the app shows them
 * (`onPage`) - its own bucket and its own Sonic server, each with what it's
 * for and a guide.
 */
export function OrganizationSetupCard({ setup, onPage, onDismiss }: { setup: OrganizationSetup; onPage: { roles: boolean; storage: boolean; sonic: boolean }; onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const steps: { key: string; done: boolean; anchor: string | null; docs: { en: string; fr: string }; optional?: boolean; extra?: ReactNode }[] = [
    { key: "invite", done: setup.invited, anchor: "invite-links", docs: { en: "/organizations/#an-organisations-page", fr: "/organizations/#la-page-dune-organisation" } },
    { key: "groups", done: setup.teams, anchor: "groups", docs: { en: "/organizations/#groups", fr: "/organizations/#groupes" } },
    { key: "roles", done: setup.roles, anchor: onPage.roles ? "roles" : null, docs: { en: "/organizations/#its-own-roles", fr: "/organizations/#ses-rôles-propres" } },
  ];
  if (setup.storageAllowed) {
    steps.push({
      key: "storage",
      done: setup.storage,
      anchor: onPage.storage ? "own-storage" : null,
      docs: { en: "/own-storage/", fr: "/own-storage/" },
      optional: true,
      extra: (
        <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
          <li>{t("organizations.setup.storagePrivate")}</li>
          <li>{t("organizations.setup.storageYours")}</li>
        </ul>
      ),
    });
  }
  if (setup.sonicAllowed) steps.push({ key: "sonic", done: setup.sonic, anchor: onPage.sonic ? "sonic-server" : null, docs: { en: "/sonic/", fr: "/sonic/" }, optional: true });
  const done = steps.filter((step) => step.done).length;

  return (
    <Card data-testid="organization-setup">
      <CardHeader className="relative">
        <CardTitle className="text-sm">{t("organizations.setup.title", { done, count: steps.length })}</CardTitle>
        <CardDescription>{t("organizations.setup.description")}</CardDescription>
        <Button type="button" variant="ghost" size="icon" className="absolute top-0 right-4" onClick={onDismiss} aria-label={t("organizations.setup.dismiss")} data-testid="organization-setup-dismiss">
          <X className="size-4" aria-hidden />
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {steps.map((step) => (
            <li key={step.key} className="flex gap-3" data-step={step.key} data-done={step.done}>
              {step.done ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-label={t("organizations.setup.done")} /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t(`organizations.setup.${step.key}`)}
                  {step.optional ? <span className="font-normal text-muted-foreground"> · {t("organizations.setup.optional")}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">{t(`organizations.setup.${step.key}Hint`)}</p>
                {step.extra}
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  {step.anchor ? (
                    <a href={`#${step.anchor}`} className="text-primary hover:underline">
                      {t("organizations.setup.show")}
                    </a>
                  ) : step.key !== "invite" && step.key !== "groups" ? (
                    <span className="text-muted-foreground">{t("organizations.setup.inSongverse")}</span>
                  ) : null}
                  <a href={guide(i18n.language, step.docs)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {t("organizations.setup.guide")}
                  </a>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
