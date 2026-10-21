import type { TeamMember, TeamPosition } from "@oneverse/core";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { OperatorConsole } from "@oneverse/operator/components/operator-console";
import { OperatorProvider } from "@oneverse/operator/host";
import { apiClient } from "#/lib/api-client";
import { setMode } from "#/lib/mode";
import { markCurrent, markPlayed } from "#/lib/set-progress";
import { songverseOperatorHost } from "#/lib/operator-host";
import { disableSync, enableSync, syncState, useSync } from "#/lib/sync-client";
import { setlistTitle } from "#/lib/setlists";

export const Route = createFileRoute("/_protected/sets/$setlistId_/operate")({
  // The item looked at (issue #277), picked in the sidebar's set list.
  validateSearch: (search: Record<string, unknown>): { item?: string } => (typeof search.item === "string" && search.item ? { item: search.item } : {}),
  loader: async ({ params }) => {
    // As the screens may show it: its passages where their Bible may be projected (issue #301).
    const copy = await apiClient.getSetlistOffline(params.setlistId, { forScreens: true });
    // A team set's positions and who holds them (issue #275): its notes filtered by them.
    const teamId = copy.set.teamId;
    const [members, positions] = teamId ? await Promise.all([apiClient.listTeamMembers(teamId).catch(() => [] as TeamMember[]), apiClient.listTeamPositions(teamId).catch(() => [] as TeamPosition[])]) : [[], []];
    return { copy, members, positions };
  },
  component: OperatorPage,
});

/**
 * The media operator's view of a set (issues #269, #275, #277, #305), in
 * Live mode: the console from @oneverse/operator on Songverse's sync client,
 * the set's items in the sidebar as in Live. It follows the set without
 * playing along (no metronome, no stems); it may still take the whole lead.
 */
function OperatorPage() {
  const { t, i18n } = useTranslation();
  const { setlistId } = Route.useParams();
  const { item: picked } = Route.useSearch();
  const navigate = useNavigate();
  const { copy, members, positions } = Route.useLoaderData();
  const sync = useSync();
  // Always Live (issue #277): the sidebar lists the set as Live does.
  useEffect(() => setMode("live"), []);
  useEffect(() => {
    // Turned on here: off again on leaving; already on (from Live), left as it was.
    const wasOn = syncState().setId === setlistId;
    enableSync(setlistId, false, { follow: false });
    return () => {
      if (!wasOn) disableSync();
    };
  }, [setlistId]);
  const host = songverseOperatorHost(setlistId);
  const presenting = sync.session?.presenting ?? null;
  // The item looked at: the one picked in the sidebar, else the one on the screens.
  const itemId = (picked && copy.songs.some((one) => one.item.id === picked) ? picked : null) ?? presenting?.itemId ?? sync.session?.itemId ?? copy.songs[0]?.item.id ?? null;
  const look = (item: string) => void navigate({ to: "/sets/$setlistId/operate", params: { setlistId }, search: { item }, replace: true });
  // The sidebar's progress, as in Live: the item on the screens is where the set is, the ones before it played.
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const now = presenting?.itemId ?? null;
    if (!now || now === shown.current) return;
    if (shown.current) markPlayed(setlistId, shown.current);
    markCurrent(setlistId, now);
    shown.current = now;
  }, [presenting?.itemId, setlistId]);

  return (
    <OperatorProvider host={host}>
      <OperatorConsole
        copy={copy}
        members={members as TeamMember[]}
        positions={positions as TeamPosition[]}
        itemId={itemId}
        onLook={look}
        title={setlistTitle(copy.set, t, i18n.language)}
        back={
          <Button variant="ghost" size="icon" render={<Link to="/sets/$setlistId" params={{ setlistId }} aria-label={t("screens.operator.back")} />}>
            <ArrowLeft />
          </Button>
        }
      />
    </OperatorProvider>
  );
}
