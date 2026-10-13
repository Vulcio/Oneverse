import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { stateVariant } from "#/components/song-editor/publish-card";
import { suggestionVariant } from "#/components/song-editor/my-suggestions-card";
import { Badge } from "@songverse/ui/components/badge";
import { Card, CardContent } from "@songverse/ui/components/card";
import { Tabs, TabsList, TabsTrigger } from "@songverse/ui/components/tabs";
import { apiClient } from "#/lib/api-client";

type ReviewTab = "open" | "closed";

export const Route = createFileRoute("/_protected/review/")({
  validateSearch: (search: Record<string, unknown>): { tab?: ReviewTab } => ({
    tab: search.tab === "closed" ? "closed" : undefined,
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab ?? "open" }),
  loader: async ({ deps }) => {
    const [submissions, suggestions] = await Promise.all([apiClient.listSubmissions(deps.tab), apiClient.listSuggestions(deps.tab)]);
    return { submissions, suggestions };
  },
  component: ReviewQueue,
});

function ReviewQueue() {
  const { t, i18n } = useTranslation();
  const { submissions, suggestions } = Route.useLoaderData();
  const tab = Route.useSearch().tab ?? "open";
  const navigate = Route.useNavigate();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("review.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("review.description")}</p>
      </div>
      <Tabs value={tab} onValueChange={(value) => void navigate({ search: { tab: value === "closed" ? "closed" : undefined } })}>
        <TabsList>
          <TabsTrigger value="open">{t("review.open")}</TabsTrigger>
          <TabsTrigger value="closed">{t("review.closed")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tab === "open" ? t("review.empty") : t("review.emptyClosed")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {submissions.map((submission) => (
                <li key={submission.id}>
                  <Link
                    to="/review/$submissionId"
                    params={{ submissionId: submission.id }}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:text-primary"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {submission.song.title}
                        {submission.song.versionName ? ` (${submission.song.versionName})` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          submission.song.artists.join(", "),
                          t("review.submittedBy", { name: submission.submitter.displayName }),
                          new Date(submission.createdAt).toLocaleDateString(i18n.language),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      {submission.matches.length > 0 ? <Badge variant="warning">{submission.matches.length}</Badge> : null}
                      <Badge variant={stateVariant(submission.state)}>{t(`publish.state${submission.state}`)}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Suggested changes to catalogue songs (issue #74). */}
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("suggestions.queueTitle")}</h2>
        <Card>
          <CardContent>
            {suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tab === "open" ? t("suggestions.queueEmpty") : t("suggestions.queueEmptyClosed")}</p>
            ) : (
              <ul className="flex flex-col divide-y" data-testid="suggestion-queue">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.id}>
                    <Link
                      to="/review/suggestions/$suggestionId"
                      params={{ suggestionId: suggestion.id }}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:text-primary"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">
                          {suggestion.song.title}
                          {suggestion.song.versionName ? ` (${suggestion.song.versionName})` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            t("history.changed", { what: suggestion.changes.map((change) => t(`history.changes.${change}`)).join(t("history.and")) }),
                            t("suggestions.by", { name: suggestion.proposer.displayName }),
                            new Date(suggestion.createdAt).toLocaleDateString(i18n.language),
                          ].join(" · ")}
                        </p>
                      </div>
                      <Badge variant={suggestionVariant(suggestion.state)}>{t(`suggestions.state${suggestion.state}`)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
