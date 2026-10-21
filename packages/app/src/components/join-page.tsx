import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import type { JoinPageContext } from "../join";
import { AuthPage } from "./auth-page";
import { LocaleProvider } from "./locale-provider";

const FAILED = { team: "auth.joinTeamFailed", organization: "organizations.joinFailed" } as const;

/**
 * A team's or an organisation's invite link (issue #242, the same in both
 * apps), when joining didn't work: why, with the way home (`home`:
 * Songverse's dashboard, Planiverse's calendar). Signed out, the link went
 * to sign in or up first (openInviteLink).
 */
export function JoinPage({ kind, brand, context, home }: { kind: "team" | "organization"; brand: ReactNode; context: JoinPageContext; home: { href: string; label: string } }) {
  return (
    <LocaleProvider locale={context.locale}>
      <JoinContent kind={kind} brand={brand} context={context} home={home} />
    </LocaleProvider>
  );
}

function JoinContent({ kind, brand, context, home }: { kind: "team" | "organization"; brand: ReactNode; context: JoinPageContext; home: { href: string; label: string } }) {
  const { t } = useTranslation();
  return (
    <AuthPage brand={brand}>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t(FAILED[kind])}</CardTitle>
          <CardDescription>{context.error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<a href={home.href} />}>{t(home.label)}</Button>
        </CardContent>
      </Card>
    </AuthPage>
  );
}
