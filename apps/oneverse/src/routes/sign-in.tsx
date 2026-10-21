import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SIGNUP_PASS_KINDS, type SignupPassKind } from "@oneverse/core";
import { AuthCard } from "@oneverse/app/components/auth-card";
import { AuthPage } from "@oneverse/app/components/auth-page";
import { LocaleProvider } from "@oneverse/app/components/locale-provider";
import { SourceCodeLink } from "@oneverse/app/components/source-code-link";
import { loadLocale } from "@oneverse/app/i18n";
import { getSession, getVisitorLocale } from "@oneverse/app/server-auth";
import { signInContinuation } from "@oneverse/app/sign-in-continuation";
import { OneverseBrand } from "#/components/brand";
import { apiClient } from "#/lib/api-client";

/** What brought them here, said above the card: an invitation, an invite link, a set's link. */
const PROMPTS: Record<SignupPassKind, string> = {
  signup: "auth.invitePrompt",
  team: "auth.joinTeamPrompt",
  organization: "organizations.joinPrompt",
  set: "sets.joinSignInPrompt",
};

function passOf(value: unknown): { kind: SignupPassKind; token: string } | undefined {
  if (typeof value !== "string") return undefined;
  const at = value.indexOf(":");
  const kind = value.slice(0, at) as SignupPassKind;
  return at > 0 && SIGNUP_PASS_KINDS.includes(kind) ? { kind, token: value.slice(at + 1) } : undefined;
}

/**
 * Signing in to every app (issue #303). An app's sign-in (the OAuth
 * provider's query) goes back to the provider once signed in, which sends
 * them on to the app; already signed in, straight away. An invitation's
 * `pass` lets them sign up (issue #198), then goes `return`.
 */
export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: async ({ search }) => {
    const continueTo = signInContinuation(search);
    const pass = passOf(search.pass);
    const session = await getSession();
    if (session) throw redirect({ href: continueTo, reloadDocument: true });
    const [{ hasGoogleAuth, signupInviteOnly }, locale] = await Promise.all([apiClient.getAuthPublicConfig(), getVisitorLocale()]);
    const email = typeof search.email === "string" ? search.email : undefined;
    return { continueTo, pass, email, hasGoogleAuth, signupInviteOnly, locale: await loadLocale(locale) };
  },
  component: SignInPage,
});

function SignInPage() {
  const { locale } = Route.useRouteContext();
  return (
    <LocaleProvider locale={locale}>
      <SignInContent />
    </LocaleProvider>
  );
}

function SignInContent() {
  const { t } = useTranslation();
  const { continueTo, pass, email, hasGoogleAuth, signupInviteOnly } = Route.useRouteContext();
  return (
    <AuthPage brand={<OneverseBrand />}>
      {pass ? (
        <p className="max-w-sm text-center text-sm text-muted-foreground" data-testid="sign-in-prompt">
          {t(PROMPTS[pass.kind], { email: email ?? "" })}
        </p>
      ) : null}
      <AuthCard redirectTo={continueTo} hasGoogleAuth={hasGoogleAuth} signupInviteOnly={signupInviteOnly} invitePass={pass} email={email} />
      <SourceCodeLink />
    </AuthPage>
  );
}
