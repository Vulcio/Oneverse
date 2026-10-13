import type { CatalogueMatch, SongPublication, Submission } from "@songverse/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmButton } from "#/components/confirm-button";
import { Badge } from "@songverse/ui/components/badge";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { Label } from "@songverse/ui/components/label";
import { Textarea } from "@songverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Where a personal or team song stands with the global catalogue, and the
 * way in: submit it for review (or, for a global admin, publish it now),
 * withdraw it, resubmit after changes, or open the global copy.
 */
export function PublishCard({ songVersionId }: { songVersionId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [publication, setPublication] = useState<SongPublication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resubmitMessage, setResubmitMessage] = useState("");

  async function load() {
    try {
      setPublication(await apiClient.getSongPublication(songVersionId));
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => {
    void load();
  }, [songVersionId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!publication) return error ? <p className="text-sm text-destructive">{error}</p> : null;
  const { submission, published } = publication;
  const open = submission && ["SUBMITTED", "UNDER_REVIEW", "NEEDS_CHANGES"].includes(submission.state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("publish.title")}</CardTitle>
        {!published && !open ? <CardDescription>{t("publish.description")}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {published ? (
          <>
            <p className="text-sm">{t("publish.published")}</p>
            <Button variant="outline" size="sm" className="self-start" render={<Link to="/library/$songVersionId" params={{ songVersionId: published.id }} />}>
                {t("publish.openGlobal")}
              </Button>
          </>
        ) : null}

        {submission && !published ? <SubmissionStatus submission={submission} /> : null}

        {open && submission.state === "NEEDS_CHANGES" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="publish-resubmit">{t("publish.resubmitLabel")}</Label>
            <Textarea id="publish-resubmit" className="min-h-16" value={resubmitMessage} onChange={(e) => setResubmitMessage(e.target.value)} />
            <Button
              size="sm"
              className="self-start"
              disabled={busy}
              onClick={() => void run(() => apiClient.resubmitSubmission(submission.id, { message: resubmitMessage }))}
            >
              {busy ? t("publish.resubmitting") : t("publish.resubmit")}
            </Button>
          </div>
        ) : null}

        {open ? (
          <div className="self-start">
            <ConfirmButton
              label={t("publish.withdraw")}
              confirmLabel={t("publish.confirmWithdraw")}
              busyLabel={t("publish.withdrawing")}
              cancelLabel={t("publish.cancel")}
              busy={busy}
              onConfirm={() => run(() => apiClient.withdrawSubmission(submission.id))}
            />
          </div>
        ) : null}

        {publication.canSubmit ? (
          <Button size="sm" className="self-start" onClick={() => setDialogOpen(true)}>
            {t("publish.submit")}
          </Button>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>

      <SubmitDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        matches={publication.matches}
        canPublishDirectly={publication.canPublishDirectly}
        onSubmit={async (data, direct) => {
          setDialogOpen(false);
          if (direct) {
            // The song itself is now in the catalogue (issue #73): the page shows it as such.
            await apiClient.publishSong(songVersionId, { duplicateReason: data.duplicateReason });
            await router.invalidate();
            return;
          }
          await apiClient.submitSong(songVersionId, data);
          await load();
        }}
      />
    </Card>
  );
}

export function stateVariant(state: Submission["state"]) {
  if (state === "REJECTED") return "destructive" as const;
  if (state === "NEEDS_CHANGES") return "warning" as const;
  if (state === "WITHDRAWN") return "muted" as const;
  return "default" as const;
}

function SubmissionStatus({ submission }: { submission: Submission }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <Badge variant={stateVariant(submission.state)} className="self-start">
        {t(`publish.state${submission.state}`)}
      </Badge>
      {submission.reviewNotes && ["NEEDS_CHANGES", "REJECTED"].includes(submission.state) ? (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          <p className="text-xs font-medium text-muted-foreground">{t("publish.reviewerNotes")}</p>
          <p className="whitespace-pre-wrap">{submission.reviewNotes}</p>
        </div>
      ) : null}
    </div>
  );
}

export function MatchList({ matches, action }: { matches: CatalogueMatch[]; action?: (match: CatalogueMatch) => React.ReactNode }) {
  const { t } = useTranslation();
  const reasons = { titleAndArtist: t("publish.reasonTitleAndArtist"), title: t("publish.reasonTitle"), ccli: t("publish.reasonCcli") };
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {matches.map((match) => (
        <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="min-w-0">
            <Link to="/library/$songVersionId" params={{ songVersionId: match.id }} className="text-sm font-medium hover:text-primary" target="_blank">
              {match.title}
              {match.versionName ? ` (${match.versionName})` : ""}
            </Link>
            <p className="text-xs text-muted-foreground">
              {[match.artists.join(", "), reasons[match.reason]].filter(Boolean).join(" · ")}
            </p>
          </div>
          {action ? action(match) : null}
        </li>
      ))}
    </ul>
  );
}

function SubmitDialog({
  open,
  onOpenChange,
  matches,
  canPublishDirectly,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: CatalogueMatch[];
  canPublishDirectly: boolean;
  onSubmit: (data: { message?: string; duplicateReason?: string }, direct: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"submit" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(direct: boolean) {
    if (matches.length > 0 && !reason.trim()) {
      setError(t("publish.duplicateReasonRequired"));
      return;
    }
    setPending(direct ? "publish" : "submit");
    setError(null);
    try {
      await onSubmit({ message: message.trim() || undefined, duplicateReason: reason.trim() || undefined }, direct);
      setMessage("");
      setReason("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("publish.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("publish.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {matches.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t("publish.matchesTitle")}</p>
              <MatchList matches={matches} />
              <Label htmlFor="publish-reason">{t("publish.duplicateReasonLabel")}</Label>
              <Textarea id="publish-reason" className="min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="publish-message">{t("publish.messageLabel")}</Label>
            <Textarea id="publish-message" className="min-h-16" value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          {canPublishDirectly ? <p className="text-xs text-muted-foreground">{t("publish.publishNowHint")}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!pending}>
            {t("publish.cancel")}
          </Button>
          {canPublishDirectly ? (
            <Button variant="outline" onClick={() => void go(true)} disabled={!!pending}>
              {pending === "publish" ? t("publish.publishing") : t("publish.publishNow")}
            </Button>
          ) : null}
          <Button onClick={() => void go(false)} disabled={!!pending}>
            {pending === "submit" ? t("publish.submitting") : t("publish.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
