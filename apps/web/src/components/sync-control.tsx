import { useNavigate } from "@tanstack/react-router";
import { Check, MonitorUp, Presentation, RadioTower, Timer, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@oneverse/ui/components/dropdown-menu";
import { useMetronome } from "#/lib/metronome-engine";
import { useStems } from "#/lib/stem-engine";
import { allowPresenter, cueScreens, disableSync, enableSync, endSync, leadSync, publishPresenting, unlockSyncAudio, useSync } from "#/lib/sync-client";
import { cn } from "@oneverse/ui/lib/utils";

/** The cues a singer has (issue #322), in the order they're read. */
const CUES = [
  ["previous", "item", "screens.cuePreviousItem"],
  ["previous", "section", "screens.cuePreviousSection"],
  ["next", "section", "screens.cueNextSection"],
  ["next", "item", "screens.cueNextItem"],
] as const;

/**
 * Sync play (issue #13) for a set: on or off, who leads, and Lead or End
 * for those who can edit the set. On a set's page, its songs and Live.
 */
export function SyncControl({ setId, itemId, compact = false, className }: { setId: string; itemId?: string; compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sync = useSync();
  const metronome = useMetronome();
  const on = sync.setId === setId && sync.status !== "off";
  const session = on ? sync.session : null;
  const following = on && !!session && !sync.leading;
  // People in the set besides the leader, once each: who the leader may let present.
  const presenterChoices = on ? [...new Map(sync.members.filter((member) => !member.screen && !member.leading).map((member) => [member.id, member])).values()] : [];
  const stems = useStems();
  const blocked = following && (metronome.audioBlocked || stems.audioBlocked);
  const label = !on
    ? t("sync.button")
    : sync.leading
      ? t("sync.leading")
      : session
        ? t("sync.followingShort", { name: session.leader.name })
        : t("sync.button");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant={on ? "default" : "outline"} size={compact ? "icon" : "default"} className={cn(blocked && "animate-pulse ring-2 ring-amber-500", compact && "size-10", className)} aria-label={compact ? label : undefined} title={label} data-testid="sync-control" data-state-sync={!on ? "off" : sync.leading ? "leading" : session ? "following" : "on"} />}>
          <RadioTower />
          {compact ? null : <span className="max-w-40 truncate">{label}</span>}
        </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-testid="sync-menu">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span>{t("sync.title")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {!on
              ? t("sync.description")
              : sync.status === "connecting" && !session
                ? t("sync.connecting")
                : sync.leading
                  ? t("sync.leading")
                  : session
                    ? session.leader.online
                      ? t("sync.leaderIs", { name: session.leader.name })
                      : t("sync.leaderOffline", { name: session.leader.name })
                    : sync.canLead
                      ? t("sync.noLeader")
                      : t("sync.waitingForLeader")}
          </span>
          {on && sync.members.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground" data-testid="sync-members">
              {t("sync.inSync", { count: sync.members.length })} · {[...new Set(sync.members.map((member) => (member.screen ? t("screens.memberName", { name: member.name }) : member.name)))].slice(0, 6).join(", ")}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {blocked ? (
          <DropdownMenuItem onClick={unlockSyncAudio}>
            <Volume2 />
            {t("sync.tapToHear")}
          </DropdownMenuItem>
        ) : null}
        {!on ? (
          <DropdownMenuItem
            onClick={() => {
              // Within the press: the browser lets the metronome make sound from now on.
              unlockSyncAudio();
              enableSync(setId);
            }}
          >
            {t("sync.turnOn")}
          </DropdownMenuItem>
        ) : (
          <>
            {sync.canLead && !sync.leading && sync.status === "on" ? (
              <DropdownMenuItem onClick={leadSync}>{session ? t("sync.leadInstead") : t("sync.lead")}</DropdownMenuItem>
            ) : null}
            {/* Screens (issue #186): presenting the set on them, from Live, and adding one. */}
            {(sync.leading || sync.canPresent) && itemId ? (
              <DropdownMenuItem
                disabled={!sync.canPresent}
                onClick={() => publishPresenting(session?.presenting ? null : { itemId, slide: 0, black: false })}
                data-testid="sync-present"
              >
                <Presentation />
                {session?.presenting ? t("screens.stopPresenting") : t("screens.present")}
              </DropdownMenuItem>
            ) : null}
            {/* Cue (issue #322): someone who may move the screens on, but not present any slide - a singer. */}
            {sync.canCue && !sync.canPresent && session ? (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("screens.cue")}</DropdownMenuLabel>
                {CUES.map(([direction, to, label]) => (
                  <DropdownMenuItem key={label} closeOnClick={false} onClick={() => cueScreens(direction, to)} data-testid={`sync-cue-${direction}-${to}`}>
                    {t(label)}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            {/* Who else presents (issue #305): the leader lets someone in the set send slides too, for this session. */}
            {sync.leading && presenterChoices.length ? (
              <>
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("screens.letPresent")}</DropdownMenuLabel>
                {presenterChoices.map((member) => {
                  const allowed = !!session?.presenters?.some((one) => one.id === member.id);
                  return (
                    <DropdownMenuItem key={member.id} closeOnClick={false} onClick={() => allowPresenter(member.id, !allowed)} role="menuitemcheckbox" aria-checked={allowed} data-testid="sync-presenter">
                      <Check className={cn(!allowed && "invisible")} />
                      {member.name}
                    </DropdownMenuItem>
                  );
                })}
              </>
            ) : null}
            {sync.canLead ? (
              <DropdownMenuItem onClick={() => void navigate({ to: "/screens", search: { setlistId: setId } })} data-testid="sync-screens">
                <MonitorUp />
                {t("screens.addScreen")}
              </DropdownMenuItem>
            ) : null}
            {/* The media operator's view (issue #269), in its own tab: Live carries on here. */}
            {sync.canLead ? (
              <DropdownMenuItem onClick={() => window.open(`/sets/${setId}/operate`, "_blank")} data-testid="sync-operator">
                <Timer />
                {t("screens.operator.open")}
              </DropdownMenuItem>
            ) : null}
            {sync.canLead && session ? (
              <DropdownMenuItem variant="destructive" onClick={endSync} title={t("sync.endConfirm")}>
                {t("sync.end")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={disableSync}>{t("sync.turnOff")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
