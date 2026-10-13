import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Music2 } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { LocaleProvider } from "#/components/locale-provider";
import { useAuthErrorText } from "#/components/auth-card";
import { getSession, getVisitorLocale } from "#/lib/server-auth";
import { loadLocale } from "#/lib/i18n";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  beforeLoad: async () => ({ locale: await loadLocale((await getSession())?.locale ?? (await getVisitorLocale())) }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Music2 className="size-6" />
          Songverse
        </div>
        <ResetPasswordCard />
      </main>
    </LocaleProvider>
  );
}

function ResetPasswordCard() {
  const { t } = useTranslation();
  const errorText = useAuthErrorText();
  const { token } = Route.useSearch();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.invalidLinkTitle")}</CardTitle>
          <CardDescription>{t("auth.invalidLinkDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" render={<Link to="/" />}>{t("auth.backToSignIn")}</Button>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.passwordUpdatedTitle")}</CardTitle>
          <CardDescription>{t("auth.passwordUpdatedDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" render={<Link to="/" />}>{t("auth.signIn")}</Button>
        </CardContent>
      </Card>
    );
  }

  async function submit(formEl: HTMLFormElement) {
    setError(null);
    const form = new FormData(formEl);
    const newPassword = String(form.get("password"));
    const confirmPassword = String(form.get("confirmPassword"));
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }

    setLoading(true);
    const result = await authClient.resetPassword({ newPassword, token });
    setLoading(false);

    if (result.error) {
      setError(errorText(result.error, t("auth.resetLinkInvalid")));
      return;
    }
    setDone(true);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("auth.newPasswordTitle")}</CardTitle>
        <CardDescription>{t("auth.newPasswordDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(event.currentTarget);
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("auth.newPassword")}</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? t("auth.saving") : t("auth.resetPassword")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
