import type { ApiClient, UserProfile } from "@oneverse/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import type { ThemeChoice } from "../theme";
import { LanguageCard, ProfileCard } from "./account-cards";
import { SettingsShell, useSettingsSections, type SettingsSectionKey } from "./settings-shell";

export const SETTINGS_SECTIONS: readonly SettingsSectionKey[] = ["account", "notifications", "songverse", "plan"];

/** A route's `$section` as a section, else Account. */
export function settingsSection(value: string): SettingsSectionKey {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value) ? (value as SettingsSectionKey) : "account";
}

/**
 * One's Settings (issue #540), the same page in every app: the account
 * (profile, language and appearance, sign-in, and summaries of the rest)
 * and notifications in every app, then each app's own - those this app
 * has (`apps`) shown here, the others opening in their app. Each app gives
 * what's its own: how one signs in from it, its planning parts, its
 * settings.
 */
export function SettingsPage({
  api,
  profile,
  section,
  apps,
  signIn,
  notifications,
  summaries,
  before,
  applyTheme,
}: {
  api: ApiClient;
  profile: UserProfile;
  section: SettingsSectionKey;
  /** This app's own sections. */
  apps: Partial<Record<"songverse" | "plan", ReactNode>>;
  /** Email, password and passkeys: Oneverse's, a link to them elsewhere. */
  signIn: ReactNode;
  notifications: ReactNode;
  /** Notifications' and availability's, on Account. */
  summaries?: ReactNode;
  /** Above Account: Oneverse's where an organisation's approval stands (issue #533). */
  before?: ReactNode;
  applyTheme?: (choice: ThemeChoice) => void;
}) {
  const items = useSettingsSections(api, Object.keys(apps) as SettingsSectionKey[]);
  return (
    <SettingsShell items={items} current={section}>
      {section === "account" ? (
        <>
          {before}
          <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-2" data-testid="settings-account">
            <div className="flex flex-col gap-6">
              <ProfileCard api={api} profile={profile} />
              <LanguageCard api={api} locale={profile.locale} theme={profile.theme} applyTheme={applyTheme} />
            </div>
            <div className="flex flex-col gap-6">
              {signIn}
              {summaries}
            </div>
          </div>
        </>
      ) : section === "notifications" ? (
        notifications
      ) : (
        (apps[section] ?? <Elsewhere item={items.find((item) => item.key === section)} />)
      )}
    </SettingsShell>
  );
}

/** Another app's settings, asked for here: where they are. */
function Elsewhere({ item }: { item?: { key: SettingsSectionKey; href: string; external: boolean } }) {
  const { t } = useTranslation();
  if (!item) return null;
  const app = t(`settings.sections.${item.key}`);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("settings.elsewhere", { app })}</CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="outline" render={<a href={item.href} />}>
          {t("settings.openApp", { app })}
        </Button>
      </CardContent>
    </Card>
  );
}
