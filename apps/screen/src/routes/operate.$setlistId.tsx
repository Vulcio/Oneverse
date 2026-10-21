import type { TeamMember, TeamPosition } from "@oneverse/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { apiToken } from "@oneverse/app/api-client";
import { getApiUrl } from "@oneverse/app/public-env";
import { OperatorConsole } from "@oneverse/operator/components/operator-console";
import { OperatorProvider } from "@oneverse/operator/host";
import { createLiveClient } from "@oneverse/operator/lib/live-client";
import { setlistTitle } from "@oneverse/screen/lib/set-items";
import { Button } from "@oneverse/ui/components/button";
import { apiClient } from "#/lib/api-client";

/**
 * A set's console in the screen app (issue #305): what Songverse's
 * operator page has, on a connection that only presents (no metronome, no
 * stems, no lead). `?item=` is the item looked at.
 */
export const Route = createFileRoute("/operate/$setlistId")({
  validateSearch: (search: Record<string, unknown>): { item?: string } => (typeof search.item === "string" && search.item ? { item: search.item } : {}),
  loader: async ({ params }) => {
    const copy = await apiClient.getSetlistOffline(params.setlistId);
    // A team set's positions and who holds them (issue #275): its notes filtered by them.
    const teamId = copy.set.teamId;
    const [members, positions] = teamId ? await Promise.all([apiClient.listTeamMembers(teamId).catch(() => [] as TeamMember[]), apiClient.listTeamPositions(teamId).catch(() => [] as TeamPosition[])]) : [[], []];
    return { copy, members, positions };
  },
  component: OperatePage,
});

function OperatePage() {
  const { t, i18n } = useTranslation();
  const { setlistId } = Route.useParams();
  const { item: picked } = Route.useSearch();
  const navigate = useNavigate();
  const { copy, members, positions } = Route.useLoaderData();
  const live = useMemo(() => createLiveClient({ apiUrl: getApiUrl(), token: apiToken }), []);
  useEffect(() => {
    live.open(setlistId);
    return () => live.close();
  }, [live, setlistId]);
  const { session } = live.host.useLive();
  // The item looked at: the one picked, else the one on the screens.
  const itemId = (picked && copy.songs.some((one) => one.item.id === picked) ? picked : null) ?? session?.presenting?.itemId ?? session?.itemId ?? copy.songs[0]?.item.id ?? null;
  const look = (item: string) => void navigate({ to: "/operate/$setlistId", params: { setlistId }, search: { item }, replace: true });
  return (
    <OperatorProvider host={live.host}>
      <OperatorConsole
        copy={copy}
        members={members as TeamMember[]}
        positions={positions as TeamPosition[]}
        itemId={itemId}
        onLook={look}
        title={setlistTitle(copy.set, t, i18n.language)}
        back={
          <Button variant="ghost" size="icon" render={<Link to="/operate" aria-label={t("screens.operator.back")} />}>
            <ArrowLeft />
          </Button>
        }
      />
    </OperatorProvider>
  );
}
