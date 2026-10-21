import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import type { JoinPageContext } from "../join";
import { AuthCard } from "./auth-card";
import { AuthPage } from "./auth-page";
import { LocaleProvider } from "./locale-provider";

const WORDS = {
  team: { failed: "auth.joinTeamFailed", prompt: "auth.joinTeamPrompt", path: "/join/" },
  organization: { failed: "organizations.joinFailed", prompt: "organizations.joinPrompt", path: "/join-organization/" },
} as const;

/**
 * A team's or an organisation's invite link (issue #242, the same in both
 * apps): sign in or up first - the link lets them sign up even by
 * invitation only (issue #198) - or why joining didn't work, with the way
 * home (`home`: Songverse's dashboard, Planiverse's calendar).
 */
export function JoinPage({ kind, token, brand, context, home }: { kind: "team" | "organization"; token: string; brand: ReactNode; context: JoinPageContext; home: { href: string; label: string } }) {
  return (
    <LocaleProvider locale={context.locale}>
      <JoinContent kind={kind} token={token} brand={brand} context={context} home={home} />
    </LocaleProvider>
  );
}

function JoinContent({ kind, token, brand, context, home }: { kind: "team" | "organization"; token: string; brand: ReactNode; context: JoinPageContext; home: { href: string; label: string } }) {
  const { t } = useTranslation();
  const words = WORDS[kind];
  return (
    <AuthPage brand={brand}>
      {context.error ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{t(words.failed)}</CardTitle>
            <CardDescription>{context.error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<a href={home.href} />}>{t(home.label)}</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="max-w-sm text-center text-sm text-muted-foreground">{t(words.prompt)}</p>
          <AuthCard redirectTo={`${words.path}${token}`} hasGoogleAuth={context.hasGoogleAuth} signupInviteOnly={context.signupInviteOnly} invitePass={{ kind, token }} />
        </>
      )}
    </AuthPage>
  );
}
