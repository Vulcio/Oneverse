import type { LanguageCode, SongbookKind } from "@songverse/core";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { Button } from "@songverse/ui/components/button";
import { LanguageSelect } from "#/components/language-select";
import { Card, CardContent, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";

export const Route = createFileRoute("/_protected/songbooks/new")({
  component: NewSongbook,
});

type Ownership = "personal" | "global" | `team:${string}`;

function NewSongbook() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, teams } = Route.useRouteContext();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<SongbookKind>("SIMPLE");
  const [abbreviation, setAbbreviation] = useState("");
  const [language, setLanguage] = useState("");
  const [publisher, setPublisher] = useState("");
  const [year, setYear] = useState("");
  const [ownership, setOwnership] = useState<Ownership>("personal");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const songbook = await apiClient.createSongbook({
        name,
        kind,
        abbreviation: abbreviation.trim() || undefined,
        language: (language.trim() || undefined) as LanguageCode | undefined,
        publisher: publisher.trim() || undefined,
        year: year.trim() ? Number(year) : undefined,
        teamId: ownership.startsWith("team:") ? ownership.slice(5) : undefined,
        global: ownership === "global",
      });
      await navigate({ to: "/songbooks/$songbookId", params: { songbookId: songbook.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("songbooks.createSongbook")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("songbooks.details")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="songbook-name">{t("songbooks.name")}</Label>
            <Input id="songbook-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Louange et Réveil" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="songbook-kind">{t("songbooks.kind")}</Label>
            <NativeSelect
              id="songbook-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as SongbookKind)}
              className="w-full"
            >
              <option value="SIMPLE">{t("songbooks.kindSimple")}</option>
              <option value="NUMBERED">{t("songbooks.kindNumbered")}</option>
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              {kind === "SIMPLE" ? t("songbooks.kindSimpleDescription") : t("songbooks.kindNumberedDescription")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="songbook-abbreviation">{t("songbooks.abbreviation")}</Label>
            <Input
              id="songbook-abbreviation"
              value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
              placeholder="L&R"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="songbook-language">{t("songbooks.language")}</Label>
            <LanguageSelect
              id="songbook-language"
              value={language}
              onChange={setLanguage}
              allowEmpty
              emptyLabel={t("common.noLanguage")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="songbook-publisher">{t("songbooks.publisher")}</Label>
            <Input id="songbook-publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="songbook-year">{t("songbooks.year")}</Label>
            <Input id="songbook-year" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("songbooks.ownership")}</CardTitle>
        </CardHeader>
        <CardContent>
          <NativeSelect
            id="songbook-ownership"
            value={ownership}
            onChange={(e) => setOwnership(e.target.value as Ownership)}
            className="w-full"
          >
            <option value="personal">{t("songbooks.personal")}</option>
            {teams.map((team) => (
              <option key={team.id} value={`team:${team.id}`}>
                {team.name}
              </option>
            ))}
            {session.isGlobalAdmin ? <option value="global">{t("songbooks.global")}</option> : null}
          </NativeSelect>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button onClick={() => void submit()} disabled={submitting || !name.trim()}>
        {submitting ? t("songbooks.creating") : t("songbooks.createSongbook")}
      </Button>
    </div>
  );
}
