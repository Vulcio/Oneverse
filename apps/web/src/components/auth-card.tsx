import type { SignupPassRequest } from "@songverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { getApiUrl } from "#/lib/public-env";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { Separator } from "@songverse/ui/components/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@songverse/ui/components/tabs";

type View = "auth" | "forgot-password" | "forgot-password-sent" | "signup-check-email";

interface AuthCardProps {
  redirectTo?: string;
  /** Whether Google sign-in is configured (Admin > Auth, or env vars) - resolved by the root route, see __root.tsx. */
  hasGoogleAuth: boolean;
  /** Only invited people can create an account (issue #198). */
  signupInviteOnly?: boolean;
  /** The invitation this page came with (an invitation's link, a team's invite link, a set's share link): it lets them sign up. */
  invitePass?: SignupPassRequest;
  /** Filled in, and the sign-up tab open: an invitation's page. */
  email?: string;
}

// BetterAuth builds verification/reset-password/OAuth callback links
// server-side, resolving a relative callbackURL against its own baseURL -
// the API's origin, now that auth lives there rather than in this app. So
// what we hand it here has to be an absolute URL pointing back at *this*
// app, or a signed-out browser ends up sent to the API's origin instead of
// the web app after clicking the link.
function toAbsoluteUrl(path: string) {
  return `${window.location.origin}${path}`;
}

// BetterAuth's errors carry a code; the known ones are translated, others
// show the server's own message.
const KNOWN_ERRORS = [
  "INVALID_EMAIL_OR_PASSWORD",
  "INVALID_EMAIL",
  "USER_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  "PASSWORD_TOO_SHORT",
  "INVALID_TOKEN",
  "SIGNUP_INVITE_ONLY",
] as const;

export function useAuthErrorText() {
  const { t } = useTranslation();
  return (error: { code?: string; message?: string }, fallback: string) => {
    const known = KNOWN_ERRORS.find((code) => code === error.code);
    return known ? t(`auth.errors.${known}`) : (error.message ?? fallback);
  };
}

export function AuthCard({ redirectTo = "/library", hasGoogleAuth, signupInviteOnly = false, invitePass, email: invitedEmail }: AuthCardProps) {
  const { t } = useTranslation();
  const errorText = useAuthErrorText();
  const [view, setView] = useState<View>("auth");
  const [error, setError] = useState<string | null>(null);
  // Invited (issue #198): the API keeps the invitation in a cookie, for the account made next - by email or Google.
  const [invited, setInvited] = useState(false);
  useEffect(() => {
    if (!invitePass) return;
    void fetch(`${getApiUrl().replace(/\/$/, "")}/auth/invite-pass`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(invitePass),
    })
      .then((response) => setInvited(response.ok))
      .catch(() => setInvited(false));
  }, [invitePass?.kind, invitePass?.token]);
  const canSignUp = !signupInviteOnly || invited || !!invitedEmail;
  // Back from Google without an account made: by invitation only, most likely.
  useEffect(() => {
    const failed = new URLSearchParams(window.location.search).get("error");
    if (failed) setError(signupInviteOnly ? t("auth.errors.SIGNUP_INVITE_ONLY") : t("auth.somethingWentWrong"));
  }, []);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  function resetMessages() {
    setError(null);
    setInfo(null);
    setUnverifiedEmail(null);
  }

  async function submit(mode: "signin" | "signup", formEl: HTMLFormElement) {
    resetMessages();
    setLoading(true);

    const form = new FormData(formEl);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const name = String(form.get("name") ?? "");

    const result =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name, callbackURL: toAbsoluteUrl(redirectTo) })
        : await authClient.signIn.email({ email, password, callbackURL: toAbsoluteUrl(redirectTo) });

    setLoading(false);

    if (result.error) {
      if (result.error.code === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(email);
        setError(t("auth.verifyFirst"));
        return;
      }
      setError(errorText(result.error, t("auth.somethingWentWrong")));
      return;
    }

    if (mode === "signup" && !result.data.token) {
      // requireEmailVerification is on, so sign-up never creates a session
      // directly - the account exists but needs the emailed link clicked.
      setView("signup-check-email");
      return;
    }
    window.location.href = redirectTo;
  }

  async function resendVerification() {
    if (!unverifiedEmail) return;
    resetMessages();
    setLoading(true);
    const result = await authClient.sendVerificationEmail({
      email: unverifiedEmail,
      callbackURL: toAbsoluteUrl(redirectTo),
    });
    setLoading(false);
    if (result.error) {
      setError(errorText(result.error, t("auth.somethingWentWrong")));
      return;
    }
    setInfo(t("auth.verificationSent"));
  }

  async function requestReset(formEl: HTMLFormElement) {
    resetMessages();
    setLoading(true);
    const form = new FormData(formEl);
    const email = String(form.get("email"));
    const result = await authClient.requestPasswordReset({ email, redirectTo: toAbsoluteUrl("/reset-password") });
    setLoading(false);
    if (result.error) {
      setError(errorText(result.error, t("auth.somethingWentWrong")));
      return;
    }
    setView("forgot-password-sent");
  }

  async function signInWithGoogle() {
    resetMessages();
    await authClient.signIn.social({ provider: "google", callbackURL: toAbsoluteUrl(redirectTo), errorCallbackURL: toAbsoluteUrl(window.location.pathname) });
  }

  async function signInWithPasskey() {
    resetMessages();
    setLoading(true);
    const result = await authClient.signIn.passkey();
    setLoading(false);
    if (result?.error) {
      setError(errorText(result.error, t("auth.passkeyFailed")));
      return;
    }
    window.location.href = redirectTo;
  }

  if (view === "forgot-password" || view === "forgot-password-sent") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.resetTitle")}</CardTitle>
          <CardDescription>
            {view === "forgot-password-sent" ? t("auth.resetSentDescription") : t("auth.resetDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view === "forgot-password-sent" ? (
            <Button variant="outline" className="w-full" onClick={() => setView("auth")}>
              {t("auth.backToSignIn")}
            </Button>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void requestReset(event.currentTarget);
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="forgot-email">{t("auth.email")}</Label>
                <Input id="forgot-email" name="email" type="email" required autoComplete="email" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={loading}>
                {loading ? t("auth.sending") : t("auth.sendResetLink")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setView("auth")}>
                {t("auth.backToSignIn")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    );
  }

  if (view === "signup-check-email") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("auth.checkEmailTitle")}</CardTitle>
          <CardDescription>{t("auth.checkEmailDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={() => setView("auth")}>
            {t("auth.backToSignIn")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("auth.welcome")}</CardTitle>
        <CardDescription>{t("auth.welcomeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Tabs defaultValue={invitedEmail ? "signup" : "signin"} onValueChange={resetMessages}>
          <TabsList className="w-full">
            <TabsTrigger value="signin">{t("auth.signIn")}</TabsTrigger>
            <TabsTrigger value="signup">{t("auth.signUp")}</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="mt-4">
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit("signin", event.currentTarget);
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="signin-email">{t("auth.email")}</Label>
                <Input id="signin-email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="signin-password">{t("auth.password")}</Label>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-primary hover:underline"
                    onClick={() => {
                      resetMessages();
                      setView("forgot-password");
                    }}
                  >
                    {t("auth.forgotPassword")}
                  </button>
                </div>
                <Input id="signin-password" name="password" type="password" required autoComplete="current-password" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              {info && <p className="text-sm text-muted-foreground">{info}</p>}
              {unverifiedEmail && (
                <Button type="button" variant="outline" size="sm" onClick={() => void resendVerification()} disabled={loading}>
                  {t("auth.resendVerification")}
                </Button>
              )}
              <Button type="submit" disabled={loading}>
                {loading ? t("auth.signingIn") : t("auth.signIn")}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup" className="mt-4">
            {!canSignUp ? (
              <p className="text-sm text-muted-foreground" data-testid="signup-invite-only">
                {t("auth.inviteOnly")}
              </p>
            ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit("signup", event.currentTarget);
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-name">{t("auth.displayName")}</Label>
                <Input id="signup-name" name="name" required autoComplete="name" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-email">{t("auth.email")}</Label>
                <Input id="signup-email" name="email" type="email" required autoComplete="email" defaultValue={invitedEmail} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="signup-password">{t("auth.password")}</Label>
                <Input
                  id="signup-password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={loading}>
                {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
              </Button>
            </form>
            )}
          </TabsContent>
        </Tabs>

        {hasGoogleAuth ? (
          <>
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">{t("auth.or")}</span>
              <Separator className="flex-1" />
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void signInWithGoogle()}>
              {t("auth.continueWithGoogle")}
            </Button>
          </>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void signInWithPasskey()}
          disabled={loading}
        >
          <KeyRound />
          {t("auth.signInWithPasskey")}
        </Button>
      </CardContent>
    </Card>
  );
}
