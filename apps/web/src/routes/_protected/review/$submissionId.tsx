import { renderChart, type SongVersionDetail } from "@oneverse/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MatchList, stateVariant } from "#/components/song-editor/publish-card";
import { SongChart } from "#/components/song-chart";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/review/$submissionId")({
  loader: async ({ context, params }) => {
    const submission = await apiClient.getSubmission(params.submissionId);
    // Reviewers can open a song only while its submission is open.
    const song: SongVersionDetail | null = await apiClient.getSongVersion(submission.song.id).catch(() => null);
    return { session: context.session, submission, song };
  },
  component: ReviewSubmission,
});

type Pending = "start" | "approve" | "merge" | "changes" | "reject";

function ReviewSubmission() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { session, submission, song } = Route.useLoaderData();
  const [notes, setNotes] = useState("");
  const [trustLabel, setTrustLabel] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isOpen = ["SUBMITTED", "UNDER_REVIEW"].includes(submission.state);
  const ownSubmission = submission.submitter.id === session.userId && !session.isGlobalAdmin;
  const canAct = isOpen && !ownSubmission;

  async function act(kind: Pending, action: () => Promise<unknown>, needsNotes = false) {
    if (needsNotes && !notes.trim()) {
      setError(t("review.notesRequired"));
      return;
    }
    setPending(kind);
    setError(null);
    try {
      await action();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  const owner = submission.song.ownerScope === "TEAM" ? submission.song.teamName : t("review.personal");

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="self-start" render={<Link to="/review" />}>
          <ArrowLeft />
          {t("review.back")}
        </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">
            {submission.song.title}
            {submission.song.versionName ? ` (${submission.song.versionName})` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[
              submission.song.artists.join(", "),
              owner,
              t("review.submittedBy", { name: submission.submitter.displayName }),
              new Date(submission.createdAt).toLocaleDateString(i18n.language),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Badge variant={stateVariant(submission.state)}>{t(`publish.state${submission.state}`)}</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          {submission.submitterMessage || submission.duplicateReason ? (
            <Card>
              <CardContent className="flex flex-col gap-3 text-sm">
                {submission.submitterMessage ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{t("review.message")}</p>
                    <p className="whitespace-pre-wrap">{submission.submitterMessage}</p>
                  </div>
                ) : null}
                {submission.duplicateReason ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{t("review.duplicateReason")}</p>
                    <p className="whitespace-pre-wrap">{submission.duplicateReason}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t("review.matches")}</CardTitle>
            </CardHeader>
            <CardContent>
              {submission.matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("review.noMatches")}</p>
              ) : (
                <MatchList
                  matches={submission.matches}
                  action={
                    canAct
                      ? (match) => (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!pending}
                            onClick={() => void act("merge", () => apiClient.mergeSubmission(submission.id, { targetId: match.id, notes: notes.trim() || undefined }))}
                          >
                            {pending === "merge" ? t("review.merging") : t("review.merge")}
                          </Button>
                        )
                      : undefined
                  }
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>{t("review.song")}</CardTitle>
              {song ? (
                <Button variant="outline" size="sm" render={<Link to="/library/$songVersionId" params={{ songVersionId: song.id }} />}>
                    {t("review.openSong")}
                  </Button>
              ) : null}
            </CardHeader>
            <CardContent className="min-w-0">
              {song ? (
                <SongChart chart={renderChart(song.documentJson)} emptyText={t("review.noContent")} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("review.noContent")}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {submission.reviewer || submission.reviewNotes || submission.publishedVersion ? (
            <Card>
              <CardContent className="flex flex-col gap-2 text-sm">
                {submission.reviewer ? <p>{t("review.reviewedBy", { name: submission.reviewer.displayName })}</p> : null}
                {submission.reviewNotes ? <p className="whitespace-pre-wrap text-muted-foreground">{submission.reviewNotes}</p> : null}
                {submission.publishedVersion ? (
                  <p>
                    {t("review.publishedAs")}{" "}
                    <Link to="/library/$songVersionId" params={{ songVersionId: submission.publishedVersion.id }} className="font-medium hover:text-primary">
                      {submission.publishedVersion.title}
                    </Link>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {ownSubmission && isOpen ? <p className="text-sm text-muted-foreground">{t("review.ownSubmission")}</p> : null}

          {canAct ? (
            <Card>
              <CardContent className="flex flex-col gap-4">
                {submission.state === "SUBMITTED" ? (
                  <Button variant="outline" disabled={!!pending} onClick={() => void act("start", () => apiClient.startReview(submission.id))}>
                    {t("review.startReview")}
                  </Button>
                ) : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="review-trust-label">{t("review.trustLabel")}</Label>
                  <Input id="review-trust-label" value={trustLabel} onChange={(e) => setTrustLabel(e.target.value)} />
                  <p className="text-xs text-muted-foreground">{t("review.trustLabelHint")}</p>
                  <Button
                    disabled={!!pending}
                    onClick={() => void act("approve", () => apiClient.approveSubmission(submission.id, { notes: notes.trim() || undefined, trustLabel: trustLabel.trim() || undefined }))}
                  >
                    {pending === "approve" ? t("review.approving") : t("review.approve")}
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="review-notes">{t("review.notesLabel")}</Label>
                  <Textarea id="review-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!!pending}
                      onClick={() => void act("changes", () => apiClient.requestSubmissionChanges(submission.id, notes), true)}
                    >
                      {pending === "changes" ? t("review.working") : t("review.requestChanges")}
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!!pending}
                      onClick={() => void act("reject", () => apiClient.rejectSubmission(submission.id, notes), true)}
                    >
                      {pending === "reject" ? t("review.working") : t("review.reject")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
