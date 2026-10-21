import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SnapshotDiff } from "#/components/song-editor/history-tab";
import { isOpenSuggestion, suggestionVariant } from "#/components/song-editor/my-suggestions-card";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";

export const Route = createFileRoute("/_protected/review/suggestions/$suggestionId")({
  loader: async ({ context, params }) => ({ session: context.session, suggestion: await apiClient.getSuggestion(params.suggestionId) }),
  component: ReviewSuggestion,
});

/**
 * A suggested change to a catalogue song (issue #74), for a reviewer: what
 * it changes, from the song as it was when it was made; what changed since
 * in the same place, which stops it; accept or decline, with a note.
 */
function ReviewSuggestion() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { session, suggestion } = Route.useLoaderData();
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const own = suggestion.proposer.id === session.userId && !session.isGlobalAdmin;
  const canAct = isOpenSuggestion(suggestion) && !own;

  async function act(kind: "accept" | "decline") {
    if (kind === "decline" && !notes.trim()) {
      setError(t("suggestions.declineNeedsNote"));
      return;
    }
    setPending(kind);
    setError(null);
    try {
      if (kind === "accept") await apiClient.acceptSuggestion(suggestion.id, notes.trim() || undefined);
      else await apiClient.declineSuggestion(suggestion.id, notes.trim());
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="self-start" render={<Link to="/review" />}>
          <ArrowLeft />
          {t("review.back")}
        </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">
            <Link to="/library/$songVersionId" params={{ songVersionId: suggestion.song.id }} className="hover:underline">
              {suggestion.song.title}
            </Link>
          </h1>
          <p className="text-sm text-muted-foreground">
            {[t("suggestions.by", { name: suggestion.proposer.displayName }), new Date(suggestion.createdAt).toLocaleDateString(i18n.language)].join(" · ")}
          </p>
        </div>
        <Badge variant={suggestionVariant(suggestion.state)}>{t(`suggestions.state${suggestion.state}`)}</Badge>
      </div>

      {suggestion.description ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("suggestions.theirMessage")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{suggestion.description}</CardContent>
        </Card>
      ) : null}

      <Card data-testid="suggestion-changes">
        <CardHeader>
          <CardTitle>{t("suggestions.whatChanges")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {suggestion.conflicts.length > 0 ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert" data-testid="suggestion-conflicts">
              {t("suggestions.conflicts", { parts: suggestion.conflicts.map((part) => partLabel(part, t)).join(", ") })}
            </p>
          ) : null}
          <SnapshotDiff before={suggestion.base} after={suggestion.proposed} showLabel={t("suggestions.showSong")} />
        </CardContent>
      </Card>

      {suggestion.reviewNotes ? (
        <p className="text-sm">
          <span className="font-medium">{t("suggestions.reviewerNote")} </span>
          {suggestion.reviewNotes}
        </p>
      ) : null}

      {canAct ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Label htmlFor="suggestion-notes">{t("suggestions.noteLabel")}</Label>
            <Textarea id="suggestion-notes" className="min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void act("accept")} disabled={pending !== null || suggestion.conflicts.length > 0}>
                {pending === "accept" ? t("suggestions.accepting") : t("suggestions.accept")}
              </Button>
              <Button variant="outline" onClick={() => void act("decline")} disabled={pending !== null}>
                {pending === "decline" ? t("suggestions.declining") : t("suggestions.decline")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : own && isOpenSuggestion(suggestion) ? (
        <p className="text-sm text-muted-foreground">{t("suggestions.ownHint")}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "chart", "details.title", "defaults.key", "credits" as the song page names them. */
function partLabel(part: string, t: (key: string) => string): string {
  if (part === "chart") return t("history.headings.chart");
  if (part === "credits") return t("history.headings.credits");
  const field = part.slice(part.indexOf(".") + 1);
  if (field === "durationSeconds") return t("songEditor.fields.duration");
  if (field === "copyrightYear" || field === "publisher") return t(`history.fields.${field}`);
  return t(`songEditor.fields.${field}`);
}
