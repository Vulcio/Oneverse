import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { DatePicker } from "@oneverse/ui/components/date-picker";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { apiClient } from "#/lib/api-client";
import { formatSetDate, todayIso } from "#/lib/setlists";
import { NativeSelect } from "@oneverse/ui/components/native-select";

export const Route = createFileRoute("/_protected/sets/new")({
  // From a song's Add to set (issue #330): the song goes in the new set.
  validateSearch: (search: Record<string, unknown>): { song?: string } => (typeof search.song === "string" && search.song ? { song: search.song } : {}),
  component: NewSet,
});

function NewSet() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const { teams } = Route.useRouteContext();
  const { song } = Route.useSearch();
  const adminTeams = teams.filter((team) => team.currentUserRole === "ADMIN");

  const [eventDate, setEventDate] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const set = await apiClient.createSetlist({
        name: name.trim() || undefined,
        eventDate: eventDate || undefined,
        teamId: owner || undefined,
      });
      // A song that can't go in it (a team set takes the team's songs): the set is made all the same, and its page says nothing is in it.
      if (song) await apiClient.addSetlistItem(set.id, { songVersionId: song }).catch(() => null);
      await router.invalidate();
      await navigate({ to: "/sets/$setlistId", params: { setlistId: set.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("sets.newSet")}</h1>
      <Card>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="set-date">{t("sets.dateLabel")}</Label>
              <DatePicker id="set-date" min={todayIso()} value={eventDate} clearable onChange={setEventDate} testId="set-date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="set-name">{t("sets.nameLabel")}</Label>
              <Input
                id="set-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder={eventDate ? formatSetDate(eventDate, i18n.language, "long") : t("sets.untitled")}
              />
              <p className="text-xs text-muted-foreground">{t("sets.dateHint")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="set-owner">{t("sets.ownerLabel")}</Label>
              <NativeSelect
                id="set-owner"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="w-full"
              >
                <option value="">{t("sets.ownerPersonal")}</option>
                {adminTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </NativeSelect>
              {teams.length > adminTeams.length ? <p className="text-xs text-muted-foreground">{t("sets.ownerTeamHint")}</p> : null}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? t("sets.creating") : t("sets.create")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
