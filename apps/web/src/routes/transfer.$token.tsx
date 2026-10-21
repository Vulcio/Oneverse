import type { TransferPreview } from "@oneverse/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { SongverseBrand } from "#/components/brand";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { apiClient } from "#/lib/api-client";
import { formatBytes } from "#/lib/format-bytes";
import { getSession } from "@oneverse/app/server-auth";
import { signInFirst } from "@oneverse/app/join";
import { loadLocale } from "@oneverse/app/i18n";

export const Route = createFileRoute("/transfer/$token")({
  beforeLoad: async ({ params }) => {
    const session = await getSession();
    // Signed in first, at Oneverse (issue #303), then back here.
    if (!session) throw signInFirst(`/transfer/${params.token}`);
    const base = { locale: await loadLocale(session.locale), email: session.email };
    try {
      return { ...base, preview: await apiClient.getTransfer(params.token), error: null };
    } catch (error) {
      return { ...base, preview: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
  component: TransferPage,
});

// Outside the _protected layout, so it has to supply its own i18n instance.
function TransferPage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <TransferContent />
    </LocaleProvider>
  );
}

function TransferContent() {
  const { t } = useTranslation();
  const { token } = Route.useParams();
  const { email, preview, error } = Route.useRouteContext();

  return (
    <AuthPage brand={<SongverseBrand />}>
      {preview ? (
        <ClaimCard token={token} email={email} preview={preview} />
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t("transfer.unavailableTitle")}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link to="/dashboard" />}>{t("transfer.goToDashboard")}</Button>
          </CardContent>
        </Card>
      )}
    </AuthPage>
  );
}

function ClaimCard({ token, email, preview }: { token: string; email: string; preview: TransferPreview }) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setPending(true);
    setError(null);
    try {
      await apiClient.claimTransfer(token);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  const items = [
    t("transfer.songs", { count: preview.songCount }),
    t("transfer.arrangements", { count: preview.arrangementCount }),
    t("transfer.songbooks", { count: preview.songbookCount }),
    t("transfer.tags", { count: preview.tagCount }),
    t("transfer.sets", { count: preview.setCount }),
    t("transfer.files", { size: formatBytes(preview.storageBytes) }),
  ];

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("transfer.title")}</CardTitle>
        <CardDescription>{t("transfer.description", { name: preview.fromDisplayName })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {done ? (
          <>
            <p className="text-sm">{t("transfer.accepted")}</p>
            <Button render={<Link to="/library" />}>{t("transfer.goToLibrary")}</Button>
          </>
        ) : (
          <>
            <ul className="list-disc pl-5 text-sm">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t("transfer.expires", { date: new Date(preview.expiresAt).toLocaleDateString(i18n.language) })}{" "}
              {t("transfer.acceptInto", { email })}
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button onClick={() => void accept()} disabled={pending}>
              {pending ? t("transfer.accepting") : t("transfer.accept")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
