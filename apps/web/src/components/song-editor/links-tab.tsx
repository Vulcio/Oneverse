import { type AttachmentAudience, type MusicBrainzWorkMatch, type LinkSearchServices, type SongLink, type SongVersionDetail, type StreamingLinkType, type TeamSummary } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MusicBrainzMatchPanel } from "#/components/musicbrainz-match-panel";
import { StreamingLinkRow } from "#/components/streaming-link-row";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { FieldError } from "@oneverse/ui/components/field";
import { AudienceSelect } from "./attachment-parts";

const STREAMING: { type: StreamingLinkType; label: string }[] = [
  { type: "SPOTIFY", label: "Spotify" },
  { type: "APPLE_MUSIC", label: "Apple Music" },
  { type: "DEEZER", label: "Deezer" },
  { type: "YOUTUBE", label: "YouTube" },
];

export function LinksTab({
  version,
  workMatch,
}: {
  version: SongVersionDetail;
  workMatch: MusicBrainzWorkMatch | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  // Which services the links can be searched at (issue #169), by the song's title and first artist.
  const [searchable, setSearchable] = useState<LinkSearchServices | null>(null);
  useEffect(() => {
    if (!version.canManage) return;
    let live = true;
    apiClient.linkSearchServices().then(
      (services) => live && setSearchable(services),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [version.canManage]);
  const artist = version.contributors.find((contributor) => contributor.roles.includes("PERFORMER") && contributor.source)?.source ?? undefined;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("songEditor.links.streaming")}</CardTitle>
          <CardDescription>{t("songEditor.links.streamingDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {STREAMING.map(({ type, label }) => {
            const current = version.identifiers.find((identifier) => identifier.type === type);
            if (!version.canManage) {
              return (
                <p key={type} className="text-sm">
                  <span className="font-medium">{label}: </span>
                  {current?.sourceUrl ? (
                    <a href={current.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {current.sourceUrl}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </p>
              );
            }
            return (
              <StreamingLinkRow
                key={type}
                id={`link-${type}`}
                label={label}
                current={current}
                onSave={async (url) => {
                  await apiClient.setStreamingLink(version.id, type, url);
                  await router.invalidate();
                }}
                onRemove={async () => {
                  await apiClient.removeStreamingLink(version.id, type);
                  await router.invalidate();
                }}
                onSearch={searchable?.[type] ? () => apiClient.searchLinks(type, version.title, artist) : undefined}
              />
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("songEditor.links.work")}</CardTitle>
          <CardDescription>{t("songEditor.links.workDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {version.canManage ? (
            <MusicBrainzMatchPanel
              kind="work"
              initialQuery={version.title}
              current={workMatch}
              onSearch={(title) => apiClient.searchMusicBrainzWorks(title)}
              onLink={async (mbid) => {
                await apiClient.linkWorkMusicBrainz(version.workId, mbid);
                await router.invalidate();
              }}
              onUnlink={async () => {
                await apiClient.unlinkWorkMusicBrainz(version.workId);
                await router.invalidate();
              }}
            />
          ) : workMatch ? (
            <a href={workMatch.sourceUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
              {workMatch.title}
              {workMatch.iswc ? ` · ISWC ${workMatch.iswc}` : ""}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">{t("songEditor.links.noWork")}</p>
          )}
        </CardContent>
      </Card>
      <ReferenceRecordings songVersionId={version.id} canEdit={version.canManage} canShare={version.canManage && version.ownerScope !== "GLOBAL"} />
    </div>
  );
}

/** "1:30", "1:02:03". */
function clockTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const SERVICE_NAMES: Record<SongLink["service"], string> = { YOUTUBE: "YouTube", SPOTIFY: "Spotify", APPLE_MUSIC: "Apple Music", DEEZER: "Deezer", OTHER: "" };

/**
 * A song's reference recordings (issue #346): several, labelled, from an
 * optional start; anyone who sees the song adds their own and chooses who
 * sees it, as with files.
 */
function ReferenceRecordings({ songVersionId, canEdit, canShare }: { songVersionId: string; canEdit: boolean; canShare: boolean }) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<SongLink[] | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [audience, setAudience] = useState<AttachmentAudience>({ visibility: "PRIVATE" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([apiClient.listSongLinks(songVersionId), apiClient.listTeams().catch(() => [])]).then(
      ([found, mine]) => {
        if (!live) return;
        setLinks(found);
        setTeams(mine);
      },
      () => live && setLinks([]),
    );
    return () => {
      live = false;
    };
  }, [songVersionId]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const link = await apiClient.addSongLink(songVersionId, {
        url,
        label,
        startSeconds: start.trim() ? Number(start) : undefined,
        visibility: audience.visibility,
        teamId: audience.visibility === "TEAM" ? audience.teamId : undefined,
      });
      setLinks((current) => [...(current ?? []), link]);
      setUrl("");
      setLabel("");
      setStart("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("songEditor.links.referenceFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="lg:col-span-2" data-testid="reference-recordings">
      <CardHeader>
        <CardTitle>{t("songEditor.links.references")}</CardTitle>
        <CardDescription>{t("songEditor.links.referencesDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {links && links.length === 0 ? <p className="text-sm text-muted-foreground">{t("songEditor.links.noReferences")}</p> : null}
        {links && links.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <a href={link.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                  {link.label}
                </a>
                <span className="text-sm text-muted-foreground">
                  {[SERVICE_NAMES[link.service], link.startSeconds ? t("songEditor.links.startsAt", { time: clockTime(link.startSeconds) }) : null].filter(Boolean).join(" · ")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {link.visibility === "PRIVATE"
                    ? link.mine
                      ? t("fileVisibility.private")
                      : t("fileVisibility.privateOf", { name: link.addedBy?.displayName ?? "" })
                    : link.visibility === "TEAM"
                      ? t("fileVisibility.team", { team: teams.find((team) => team.id === link.visibleToTeamId)?.name ?? "…" })
                      : link.visibility === "SHARED"
                        ? t("fileVisibility.shared")
                        : t("fileVisibility.song")}
                </span>
                {link.canChange ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label={t("songEditor.links.removeReference", { label: link.label })}
                    onClick={() =>
                      void apiClient.removeSongLink(songVersionId, link.id).then(
                        () => setLinks((current) => (current ?? []).filter((one) => one.id !== link.id)),
                        (err: Error) => setError(err.message),
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {/* Not a form: the song editor around it is one. Enter in a field adds it. */}
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem]"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            if (url.trim() && label.trim() && !busy) void add();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reference-url">{t("songEditor.links.referenceUrl")}</Label>
            <Input id="reference-url" value={url} placeholder={t("songEditor.links.referenceUrlPlaceholder")} onChange={(event) => setUrl(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reference-label">{t("songEditor.links.referenceLabel")}</Label>
            <Input id="reference-label" maxLength={80} value={label} placeholder={t("songEditor.links.referenceLabelPlaceholder")} onChange={(event) => setLabel(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reference-start">{t("songEditor.links.referenceStart")}</Label>
            <Input id="reference-start" type="number" min={0} max={36000} value={start} onChange={(event) => setStart(event.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
            <AudienceSelect value={audience} teams={teams} canShowToSong={canEdit} canShowToShared={canShare} label={t("fileVisibility.label")} onChange={setAudience} />
            <Button type="button" size="sm" disabled={busy || !url.trim() || !label.trim()} onClick={() => void add()}>
              {t("songEditor.links.addReference")}
            </Button>
          </div>
          {error ? <FieldError className="sm:col-span-3">{error}</FieldError> : null}
        </div>
      </CardContent>
    </Card>
  );
}
