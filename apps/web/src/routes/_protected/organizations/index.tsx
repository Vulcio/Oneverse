import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EntityAvatar } from "#/components/entity-avatar";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { apiClient } from "#/lib/api-client";
import { forgetMyOrganizations } from "#/lib/organizations";

export const Route = createFileRoute("/_protected/organizations/")({
  loader: () => apiClient.listMyOrganizations(),
  component: OrganizationsIndex,
});

/** One's organisations (issue #241), and making one where one may. */
function OrganizationsIndex() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { mode, canCreate, organizations } = Route.useLoaderData();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const organization = await apiClient.createOrganization({ name, description: description || undefined });
      forgetMyOrganizations();
      await navigate({ to: "/organizations/$organizationId", params: { organizationId: organization.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("organizations.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("organizations.description")}</p>
      </div>
      {mode === "NONE" ? (
        <p className="text-sm text-muted-foreground">{t("organizations.turnedOff")}</p>
      ) : (
        <Card>
          <CardContent>
            {organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("organizations.noneYet")}</p>
            ) : (
              <ul className="flex flex-col divide-y" data-testid="organizations-list">
                {organizations.map((organization) => (
                  <li key={organization.id}>
                    <Link
                      to="/organizations/$organizationId"
                      params={{ organizationId: organization.id }}
                      className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 hover:text-primary"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <EntityAvatar name={organization.name} color={organization.color} avatarUrl={null} size={36} />
                        <div className="min-w-0">
                          <p className="font-medium">{organization.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t("organizations.teamCount", { count: organization.teamCount })} · {t("organizations.members", { count: organization.memberCount })}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">{organization.currentUserRole === "ADMIN" ? t("teams.roleAdmin") : t("teams.roleMember")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      {canCreate ? (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-sm">{t("organizations.create")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="organization-name">{t("organizations.name")}</Label>
              <Input id="organization-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="organization-description">{t("organizations.descriptionLabel")}</Label>
              <Textarea id="organization-description" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="self-start" disabled={creating || name.trim().length < 2} onClick={() => void create()} data-testid="organization-create">
              {creating ? t("organizations.creating") : t("organizations.createButton")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
