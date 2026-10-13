import { ApiError, keptSetDetail, onlineOrKept, type SetlistDetail, type SetlistItem, type TeamSummary } from "@songverse/core";
import { DatePicker } from "#/components/date-picker";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Mic, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@songverse/ui/components/badge";
import { SyncControl } from "#/components/sync-control";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { apiClient } from "#/lib/api-client";
import { deviceStorage, useKeepSet } from "#/lib/offline-data";
import { setMode, useMode } from "#/lib/mode";
import { clearSetProgress, resumeItemOf, setProgressOf, useSetProgress } from "#/lib/set-progress";
import { formatSetDate, setOwnerLabel, setlistTitle } from "#/lib/setlists";
import { AddSongs } from "./-add-songs";
import { SetSongList } from "./-set-song-list";
import { ShareCard } from "./-share-card";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { OfflinePinButton } from "#/components/offline-pin-button";

export const Route = createFileRoute("/_protected/sets/$setlistId")({
  // Null when the set doesn't exist or isn't visible to this user (the API
  // doesn't tell the two apart).
  // Offline, the copy kept on the device (issue #50).
  loader: ({ params }) =>
    onlineOrKept(
      () =>
        apiClient.getSetlist(params.setlistId).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }),
      () => keptSetDetail(deviceStorage(), params.setlistId),
    ),
  component: SetRoute,
});

function SetRoute() {
  const { t } = useTranslation();
  const loaded = Route.useLoaderData();
  const { offline } = Route.useRouteContext();
  useKeepSet(loaded?.id);
  if (!loaded) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold">{t("sets.notFoundTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("sets.notFoundDescription")}</p>
        <Button variant="outline" render={<Link to="/sets" />}>{t("sets.backToSets")}</Button>
      </div>
    );
  }
  return <SetOrLive loaded={offline ? { ...loaded, canEdit: false } : loaded} />;
}

/** In Live, a set opens straight into Live (issue #153): at the song last played there, else its first. */
function SetOrLive({ loaded }: { loaded: SetlistDetail }) {
  const { mode } = useMode();
  const navigate = useNavigate();
  const live = mode === "live" && loaded.items.length > 0;
  useEffect(() => {
    // Read here, from the device: straight after hydration the hook's value may not have caught up yet.
    const itemId = resumeItemOf(setProgressOf(loaded.id), loaded.items.map((item) => item.id));
    if (live && itemId) void navigate({ to: "/sets/$setlistId/live/$itemId", params: { setlistId: loaded.id, itemId }, replace: true });
  }, [live, loaded, navigate]);
  if (live) return null;
  return <SetPage loaded={loaded} />;
}

function SetPage({ loaded }: { loaded: SetlistDetail }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { session, teams } = Route.useRouteContext();
  const [set, setSet] = useState<SetlistDetail>(loaded);
  const [error, setError] = useState<string | null>(null);
  // Where it got to in Live (issue #153): Live picks up there.
  const progress = useSetProgress(set.id);
  const resumeAt = resumeItemOf(progress, set.items.map((item) => item.id));
  const resuming = !!progress && resumeAt !== set.items[0]?.id;

  // Re-sync after navigating to another set or a router.invalidate().
  useEffect(() => setSet(loaded), [loaded]);

  /** Every item mutation returns the updated set. */
  async function apply(change: Promise<SetlistDetail>, rollback?: SetlistDetail) {
    setError(null);
    try {
      setSet(await change);
    } catch (err) {
      if (rollback) setSet(rollback);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function reorder(items: SetlistItem[]) {
    const previous = set;
    setSet({ ...set, items });
    void apply(
      apiClient.reorderSetlistItems(
        set.id,
        items.map((item) => item.id),
      ),
      previous,
    );
  }

  const subtitle = [set.name && set.eventDate ? formatSetDate(set.eventDate, i18n.language, "long") : null, setOwnerLabel(set, t)]
    .filter(Boolean)
    .join(" · ");

  const ownership = {
    currentUserId: session.userId,
    onRequest: (itemId: string) => void apply(apiClient.requestSongOwnership(set.id, itemId)),
    onDecide: (requestId: string, accept: boolean) =>
      void apply(
        (accept ? apiClient.acceptOwnershipRequest(requestId) : apiClient.declineOwnershipRequest(requestId)).then(() =>
          apiClient.getSetlist(set.id),
        ),
      ),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {setlistTitle(set, t, i18n.language)}
            {set.isGuest ? <Badge variant="muted">{t("sets.guestBadge")}</Badge> : null}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OfflinePinButton kind="SET" targetId={set.id} />
          {/* Sync play (issue #13). */}
          <SyncControl setId={set.id} />
          {progress ? (
            <Button variant="outline" onClick={() => clearSetProgress(set.id)} data-testid="set-progress-clear">
              <RotateCcw />
              {t("sets.fromTheTop")}
            </Button>
          ) : null}
          {resumeAt ? (
            <Button onClick={() => setMode("live")} render={<Link to="/sets/$setlistId/live/$itemId" params={{ setlistId: set.id, itemId: resumeAt }} />} data-testid="set-live">
              <Mic />
              {resuming ? t("live.resume") : t("live.start")}
            </Button>
          ) : null}
          {set.isGuest ? <LeaveSetButton setlistId={set.id} /> : null}
        </div>
      </div>

      {set.isGuest ? (
        <p className="text-sm text-muted-foreground">
          {set.teamName ? t("sets.guestReadOnlyTeam", { team: set.teamName }) : t("sets.guestReadOnly", { name: set.ownerName ?? "" })}
        </p>
      ) : !set.canEdit ? (
        <p className="text-sm text-muted-foreground">{t("sets.readOnly")}</p>
      ) : null}

      {/* With room (issue #177): the set's songs, and beside them adding songs, sharing and its details. */}
      <div className="grid grid-cols-1 items-start gap-6 @6xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("sets.songs")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {set.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("sets.emptySet")}</p>
          ) : (
            <SetSongList
              setlistId={set.id}
              items={set.items}
              progress={progress}
              canEdit={set.canEdit}
              ownership={ownership}
              onReorder={reorder}
              onChangeItem={(itemId, change) => void apply(apiClient.updateSetlistItem(set.id, itemId, change))}
              onRemoveItem={(itemId) => void apply(apiClient.removeSetlistItem(set.id, itemId))}
            />
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      {set.canEdit ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("sets.addSongs")}</CardTitle>
            </CardHeader>
            <CardContent>
              <AddSongs set={set} onAdded={setSet} />
            </CardContent>
          </Card>
          <ShareCard setlistId={set.id} />
          <DetailsCard
            set={set}
            teams={teams}
            onSaved={async (updated) => {
              setSet(updated);
              // The sidebar lists sets by title.
              await router.invalidate();
            }}
          />
        </div>
      ) : null}
      </div>
    </div>
  );
}

function LeaveSetButton({ setlistId }: { setlistId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    setPending(true);
    setError(null);
    try {
      await apiClient.leaveSetlist(setlistId);
      // Leave the page first: refreshing it in place would reload a set that's no longer ours.
      await navigate({ to: "/sets" });
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        {t("sets.leaveSet")}
      </Button>
      <Dialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sets.confirmLeave")}</DialogTitle>
            <DialogDescription>{t("sets.confirmLeaveDescription")}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              {t("sets.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void leave()} disabled={pending}>
              {pending ? t("sets.leaving") : t("sets.leaveSet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Moves the set to a team the user admins, or makes it their personal set - after a confirm step. */
function OwnerField({
  set,
  teams,
  onMoved,
}: {
  set: SetlistDetail;
  teams: TeamSummary[];
  onMoved: (set: SetlistDetail) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adminTeams = teams.filter((team) => team.currentUserRole === "ADMIN");
  // A team set viewed by a global admin who isn't one of that team's admins.
  const options =
    set.teamId && !adminTeams.some((team) => team.id === set.teamId)
      ? [...adminTeams, { id: set.teamId, name: set.teamName ?? set.teamId }]
      : adminTeams;
  const targetTeam = options.find((team) => team.id === target);

  async function move() {
    setPending(true);
    setError(null);
    try {
      await onMoved(await apiClient.updateSetlist(set.id, { teamId: target || null }));
      setTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="set-owner">{t("sets.ownerLabel")}</Label>
      <NativeSelect id="set-owner" value={set.teamId ?? ""} onChange={(event) => setTarget(event.target.value)} className="w-full">
        <option value="">{t("sets.ownerPersonal")}</option>
        {options.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </NativeSelect>
      <Dialog open={target !== null} onOpenChange={(open) => !pending && !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sets.ownerChangeTitle")}</DialogTitle>
            <DialogDescription>
              {targetTeam ? t("sets.ownerToTeam", { team: targetTeam.name }) : t("sets.ownerToPersonal")}
            </DialogDescription>
          </DialogHeader>
          {targetTeam && !set.teamId ? <p className="text-sm text-muted-foreground">{t("sets.ownerToTeamShared")}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              {t("sets.cancel")}
            </Button>
            <Button onClick={() => void move()} disabled={pending}>
              {pending ? t("sets.moving") : t("sets.move")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailsCard({
  set,
  teams,
  onSaved,
}: {
  set: SetlistDetail;
  teams: TeamSummary[];
  onSaved: (set: SetlistDetail) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const [name, setName] = useState(set.name ?? "");
  const [eventDate, setEventDate] = useState(set.eventDate ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setName(set.name ?? "");
    setEventDate(set.eventDate ?? "");
  }, [set.id, set.name, set.eventDate]);

  const dirty = name.trim() !== (set.name ?? "") || eventDate !== (set.eventDate ?? "");

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      await onSaved(await apiClient.updateSetlist(set.id, { name: name.trim() || null, eventDate: eventDate || null }));
      setMessage({ kind: "ok", text: t("sets.saved") });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    try {
      await apiClient.deleteSetlist(set.id);
      await router.invalidate();
      await navigate({ to: "/sets" });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      setPending(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("sets.details")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="set-date">{t("sets.dateLabel")}</Label>
              <DatePicker id="set-date" value={eventDate} clearable onChange={setEventDate} testId="set-date" />
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
            </div>
          </div>
          <OwnerField set={set} teams={teams} onMoved={onSaved} />
          {message ? (
            <p className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p>
          ) : null}
          <div className="flex items-center justify-between">
            <Button type="submit" disabled={pending || !dirty}>
              {pending ? t("sets.saving") : t("sets.save")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
              {t("sets.deleteSet")}
            </Button>
          </div>
        </form>
      </CardContent>

      <Dialog open={confirmingDelete} onOpenChange={(open) => !pending && setConfirmingDelete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("sets.confirmDelete")}</DialogTitle>
            <DialogDescription>{t("sets.confirmDeleteDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)} disabled={pending}>
              {t("sets.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={pending}>
              {pending ? t("sets.deleting") : t("sets.deleteSet")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
