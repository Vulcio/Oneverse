import { INSTRUMENTS, TECH_ROLES, type CustomInstrument, type TechRoleValue, type UserProfile } from "@oneverse/core";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AvatarPicker } from "@oneverse/app/components/account-cards";
import { useInstrumentLabel } from "@oneverse/planning/instruments";
import { Button } from "@oneverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@oneverse/ui/components/dialog";
import { apiClient } from "#/lib/api-client";
import { ChipGroup, toggled } from "#/components/role-chips";

// Asked once per page load at most: a soft navigation doesn't ask again.
let askedThisLoad = false;

/** Where it never interrupts: playing, presenting or operating a set. */
const QUIET = /\/(live|operate|songs)\/|\/operate$/;

/**
 * "What do you play or do?" (issue #109): after signing up, and again on
 * joining a team, while someone hasn't said - instruments and tech roles to
 * tick, and a photo. Skip asks again in a while (the API says when, as
 * `askProfile`); it never shows while playing or presenting a set.
 */
export function ProfilePrompt() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [custom, setCustom] = useState<CustomInstrument[]>([]);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [techRoles, setTechRoles] = useState<TechRoleValue[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instrumentLabel = useInstrumentLabel(custom);

  useEffect(() => {
    if (askedThisLoad || QUIET.test(pathname) || typeof navigator === "undefined" || !navigator.onLine) return;
    askedThisLoad = true;
    Promise.all([apiClient.getMe(), apiClient.listCustomInstruments()])
      .then(([me, instrumentsAdded]) => {
        if (!me.askProfile) return;
        setProfile(me);
        setCustom(instrumentsAdded);
        setOpen(true);
      })
      .catch(() => {
        // Not asked this time.
      });
  }, [pathname]);

  async function skip() {
    setOpen(false);
    await apiClient.skipProfilePrompt().catch(() => undefined);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.updateMe({ instruments, techRoles });
      setOpen(false);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void skip();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="profile-prompt">
        <DialogHeader>
          <DialogTitle>{t("profilePrompt.title")}</DialogTitle>
          <DialogDescription>{t("profilePrompt.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <ChipGroup
            label={t("roles.instrumentsLabel")}
            options={[...INSTRUMENTS, ...custom.map((instrument) => instrument.id)]}
            selected={instruments}
            labelFor={instrumentLabel}
            onToggle={(instrument) => setInstruments((current) => toggled(current, instrument))}
            disabled={busy}
          />
          <ChipGroup
            label={t("roles.techRolesLabel")}
            options={TECH_ROLES}
            selected={techRoles}
            labelFor={(role) => t(`roles.techRole.${role}`)}
            onToggle={(role) => setTechRoles((current) => toggled(current, role))}
            disabled={busy}
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("profilePrompt.photo")}</legend>
            <AvatarPicker api={apiClient} profile={profile} onChanged={() => void apiClient.getMe().then(setProfile)} />
          </fieldset>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void skip()} data-testid="profile-prompt-skip">
            {t("profilePrompt.skip")}
          </Button>
          <Button type="button" disabled={busy || instruments.length + techRoles.length === 0} onClick={() => void save()} data-testid="profile-prompt-save">
            {t("profilePrompt.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
