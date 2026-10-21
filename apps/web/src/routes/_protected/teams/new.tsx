import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";

export const Route = createFileRoute("/_protected/teams/new")({
  component: NewTeam,
});

function NewTeam() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const team = await apiClient.createTeam({ name, description: description.trim() || undefined });
      await navigate({ to: "/teams/$teamId", params: { teamId: team.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("teams.createTeam")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("teams.details")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-name">{t("teams.name")}</Label>
            <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Worship Team" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="team-description">{t("teams.descriptionLabel")}</Label>
            <Textarea id="team-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button onClick={() => void submit()} disabled={submitting || !name.trim()}>
        {submitting ? t("teams.creating") : t("teams.createTeam")}
      </Button>
    </div>
  );
}
