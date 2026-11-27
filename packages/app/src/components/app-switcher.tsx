import type { AppKey, AppLink } from "@oneverse/core";
import { useRouterState } from "@tanstack/react-router";
import { CalendarDays, Check, House, LayoutGrid, Monitor, Music, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuLinkItem, DropdownMenuTrigger } from "@oneverse/ui/components/dropdown-menu";
import { Spinner } from "@oneverse/ui/components/spinner";
import { createDeviceStore } from "@oneverse/ui/lib/device-store";
import { cn } from "@oneverse/ui/lib/utils";
import { appHref, loadApps } from "../apps";

/** Each app's icon and colour (issue #552): the hub's tiles and the switcher's. */
export const APP_LOOKS: Record<AppKey, { icon: LucideIcon; tint: string }> = {
  oneverse: { icon: House, tint: "bg-primary/10 text-primary" },
  plan: { icon: CalendarDays, tint: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
  songverse: { icon: Music, tint: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  screen: { icon: Monitor, tint: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
};

/** An app's name, as its tile and the switcher show it. */
export function useAppName(): (app: AppKey) => string {
  const { t } = useTranslation();
  return useCallback((app: AppKey) => ({ oneverse: "Oneverse", plan: "Plan", songverse: "Songverse", screen: t("hub.screen") })[app], [t]);
}

/** The last list this device was given, so the menu has it before the API answers (and offline). */
const rememberedApps = createDeviceStore<AppLink[] | null>("oneverse.apps", {
  fallback: null,
  parse: (raw) => (raw ? (JSON.parse(raw) as AppLink[]) : null),
  format: (value) => (value ? JSON.stringify(value) : null),
});

/** The apps they can open (issue #552), null while asked. */
export function useApps(api: { listMyApps(): Promise<AppLink[]> }): AppLink[] | null {
  const [apps, setApps] = useState<AppLink[] | null>(null);
  useEffect(() => {
    let live = true;
    loadApps(api)
      .then((found) => {
        rememberedApps.set(found);
        if (live) setApps(found);
      })
      .catch(() => live && setApps(rememberedApps.get() ?? []));
    return () => {
      live = false;
    };
  }, [api]);
  return apps;
}

/**
 * The app switcher (issue #552), in every app's header: a grid opening the
 * apps one can open, this one marked; each opens at the same place where it
 * has one (a team, a date, a set), else at its home. The button is drawn
 * with the rest of the header, on the server too; the list comes after, the
 * device's last one meanwhile. Nothing to switch to, no button.
 */
export function AppSwitcher({ current, api, className }: { current: AppKey; api: { listMyApps(): Promise<AppLink[]> }; className?: string }) {
  const { t } = useTranslation();
  const name = useAppName();
  const fetched = useApps(api);
  const remembered = rememberedApps.use();
  const apps = fetched ?? remembered;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Hidden only once the API said there's nowhere else to go.
  if (fetched && fetched.filter((one) => one.app !== current).length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("hub.switchApp")} title={t("hub.switchApp")} className={className} data-testid="app-switcher" />}>
        <LayoutGrid />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52" data-testid="app-switcher-menu">
        <DropdownMenuLabel>{t("hub.apps")}</DropdownMenuLabel>
        {apps === null ? (
          <DropdownMenuItem disabled className="py-2" data-testid="app-switcher-loading">
            <Spinner label={t("common.loading")} />
          </DropdownMenuItem>
        ) : null}
        {(apps ?? []).map((link) => {
          const { icon: Icon, tint } = APP_LOOKS[link.app];
          const here = link.app === current;
          const content = (
            <>
              <span className={cn("flex size-7 items-center justify-center rounded-md [&_svg]:size-4", tint)}>
                <Icon />
              </span>
              <span className="flex-1">{name(link.app)}</span>
              {here ? <Check className="size-4 text-muted-foreground" /> : null}
            </>
          );
          // This one: marked, nowhere to go.
          return here ? (
            <DropdownMenuItem key={link.app} disabled aria-current="page" className="gap-3 py-2 font-semibold data-disabled:opacity-100" data-testid={`app-switcher-${link.app}`}>
              {content}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuLinkItem key={link.app} href={appHref(link, pathname)} className="gap-3 py-2" data-testid={`app-switcher-${link.app}`}>
              {content}
            </DropdownMenuLinkItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
