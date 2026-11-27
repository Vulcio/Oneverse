import type { AppKey } from "@oneverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { loadApps } from "../apps";

/** A section of Settings (issue #540): the account's and notifications, in every app, then each app's. */
export type SettingsSectionKey = "account" | "notifications" | "songverse" | "plan";

const APP_SECTIONS: { key: SettingsSectionKey; app: AppKey }[] = [
  { key: "songverse", app: "songverse" },
  { key: "plan", app: "plan" },
];

type Item = { key: SettingsSectionKey; group: "every" | "apps"; href: string; external: boolean };

/**
 * The sections an app's Settings lists (issue #540): Account and
 * Notifications, then the settings of each app they can open - this app's
 * shown here (`here`), another's opening in that app.
 */
export function useSettingsSections(api: { listMyApps(): Promise<{ app: AppKey; url: string }[]> }, here: readonly SettingsSectionKey[]): Item[] {
  const [apps, setApps] = useState<{ app: AppKey; url: string }[] | null>(null);
  useEffect(() => {
    void loadApps(api).then(setApps, () => setApps([]));
  }, [api]);
  const items: Item[] = [
    { key: "account", group: "every", href: "/settings/account", external: false },
    { key: "notifications", group: "every", href: "/settings/notifications", external: false },
  ];
  for (const { key, app } of APP_SECTIONS) {
    const link = apps?.find((one) => one.app === app);
    if (here.includes(key)) items.push({ key, group: "apps", href: `/settings/${key}`, external: false });
    else if (link) items.push({ key, group: "apps", href: `${link.url}/settings/${key}`, external: true });
  }
  return items;
}

/**
 * Settings' frame (issue #540): its sections down the side on a wide screen,
 * a Select at the top on a phone, and the open section beside them.
 */
export function SettingsShell({ items, current, children }: { items: Item[]; current: SettingsSectionKey; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = (["every", "apps"] as const).map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter((group) => group.items.length > 0);
  const label = (group: "every" | "apps") => (group === "every" ? t("settings.everyApp") : t("settings.appSettings"));

  const go = (key: string) => {
    const item = items.find((one) => one.key === key);
    if (!item) return;
    if (item.external) window.location.href = item.href;
    else void navigate({ to: item.href });
  };

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8" data-testid="settings">
      <div className="flex flex-col gap-3 md:w-56 md:shrink-0">
        <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
        {/* A phone: one Select, grouped like the side. */}
        <NativeSelect className="w-full md:hidden" aria-label={t("settings.sectionPicker")} value={current} onChange={(event) => go(event.target.value)} data-testid="settings-picker">
          {groups.map(({ group, items: shown }) => (
            <optgroup key={group} label={label(group)}>
              {shown.map((item) => (
                <option key={item.key} value={item.key}>
                  {t(`settings.sections.${item.key}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
        <nav aria-label={t("settings.title")} className="hidden flex-col gap-0.5 md:flex">
          {groups.map(({ group, items: shown }) => (
            <div key={group} className="flex flex-col gap-0.5">
              <span className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label(group)}</span>
              {shown.map((item) => {
                const className = cn(
                  "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                  item.key === current && "bg-primary font-medium text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                );
                const text = t(`settings.sections.${item.key}`);
                return item.external ? (
                  <a key={item.key} href={item.href} className={className} title={t("settings.opensIn", { app: text })} data-testid={`settings-tab-${item.key}`}>
                    {text}
                    <ExternalLink className="size-3.5 opacity-60" aria-hidden />
                  </a>
                ) : (
                  <Link key={item.key} to={item.href} className={className} aria-current={item.key === current ? "page" : undefined} data-testid={`settings-tab-${item.key}`}>
                    {text}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}
