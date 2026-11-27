import { SUPPORTED_LOCALES, joinedName, type AccountThemeValue, type ApiClient, type LocaleValue, type UserProfile } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@oneverse/ui/components/avatar";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ImageCropDialog } from "@oneverse/ui/components/image-crop-dialog";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { sizedAvatarUrl } from "@oneverse/ui/lib/avatar-url";
import { initials } from "@oneverse/ui/lib/initials";
import { cn } from "@oneverse/ui/lib/utils";
import { authClient } from "../auth-client";
import { setThemeChoice, type ThemeChoice } from "../theme";
import { PasswordInput } from "./password-input";
import { oneverseUrl } from "../public-env";
import { FieldError } from "@oneverse/ui/components/field";
import { Skeleton } from "@oneverse/ui/components/skeleton";

// The account's own cards (issue #242): one's name and picture, email,
// passkeys, language - each with its app's API client. Email and passkeys
// need BetterAuth's own session, so they're Oneverse's (issue #303); the
// apps show OneverseAccountCard instead.

// Only guards what the browser has to decode for cropping; what's uploaded
// is the cropped result, at most 512x512.
const MAX_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024;

const LOCALE_NAMES: Record<LocaleValue, string> = { en: "English", fr: "Français" };

/** One's name in two parts and picture (issue #540): others see the two joined. */
export function ProfileCard({ api, profile }: { api: ApiClient; profile: UserProfile }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const joined = joinedName(firstName, lastName);
  const changed = firstName.trim() !== profile.firstName || lastName.trim() !== profile.lastName;

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      await api.updateMe({ firstName: firstName.trim(), lastName: lastName.trim() });
      // Also reloads the session, so the sidebar picks up the new name.
      await router.invalidate();
      setMessage({ kind: "ok", text: t("account.saved") });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card data-testid="profile-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("account.profile")}</CardTitle>
        <CardDescription>{t("settings.profileDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AvatarPicker api={api} profile={profile} />

        <form
          className="flex flex-col gap-3 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="first-name">{t("settings.firstName")}</Label>
              <Input id="first-name" value={firstName} maxLength={60} autoComplete="given-name" onChange={(event) => setFirstName(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="last-name">{t("settings.lastName")}</Label>
              <Input id="last-name" value={lastName} maxLength={60} autoComplete="family-name" onChange={(event) => setLastName(event.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="joined-name">
            {joined ? t("settings.othersSee", { name: joined }) : t("settings.nameRequired")}
          </p>
          <Button type="submit" className="self-start" disabled={pending || !joined || !changed} data-testid="save-name">
            {pending ? t("account.saving") : t("account.save")}
          </Button>
        </form>

        {message ? (
          <p className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * One's picture (issue #109 asks for it too): upload, cropped round, or
 * remove. Reloads the session after, so the sidebar shows the new one.
 */
export function AvatarPicker({ api, profile, onChanged }: { api: ApiClient; profile: Pick<UserProfile, "avatarUrl" | "displayName">; onChanged?: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await api.removeAvatar();
      await router.invalidate();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function onFileChosen(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      setError(t("account.avatarTooLarge"));
      return;
    }
    setError(null);
    setCropping(file);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          {profile.avatarUrl ? <AvatarImage src={sizedAvatarUrl(profile.avatarUrl, 64)} alt="" /> : null}
          <AvatarFallback className="text-lg">{initials(profile.displayName)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
              {t("account.uploadAvatar")}
            </Button>
            {profile.avatarUrl ? (
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => void remove()}>
                {t("account.removeAvatar")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{t("account.avatarHint")}</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="avatar-input"
            onChange={(event) => {
              onFileChosen(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
      {cropping ? (
        <ImageCropDialog
          file={cropping}
          maxSize={512}
          shape="round"
          title={t("account.cropTitle")}
          description={t("account.cropDescription")}
          saveLabel={t("account.saveAvatar")}
          testId="avatar-cropper"
          onCancel={() => setCropping(null)}
          onConfirm={async (cropped) => {
            await api.uploadAvatar(cropped, "avatar.webp");
            setCropping(null);
            await router.invalidate();
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * In an app that signs in through Oneverse (issue #303): what's managed
 * there - email, password, passkeys - since only Oneverse has its session.
 */
export function OneverseAccountCard({ email }: { email: string }) {
  const { t } = useTranslation();
  return (
    <Card data-testid="oneverse-account">
      <CardHeader>
        <CardTitle className="text-sm">{t("settings.signIn")}</CardTitle>
        <CardDescription>
          {email} · {t("settings.signInElsewhere")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" render={<a href={`${oneverseUrl()}/settings/account`} />}>
          {t("settings.manageSignIn")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function EmailCard({ email }: { email: string }) {
  const { t } = useTranslation();
  const [newEmail, setNewEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeEmail() {
    setPending(true);
    setError(null);
    const result = await authClient.changeEmail({
      newEmail: newEmail.trim(),
      // BetterAuth resolves a relative URL against the API's origin, not this app's.
      callbackURL: `${window.location.origin}/settings/account`,
    });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? String(result.error.status));
      return;
    }
    setSent(true);
    setNewEmail("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("account.emailTitle")}</CardTitle>
        <CardDescription>{t("account.emailDescription", { email })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void changeEmail();
          }}
        >
          <Label htmlFor="new-email">{t("account.newEmailLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="new-email"
              type="email"
              required
              value={newEmail}
              autoComplete="email"
              onChange={(event) => setNewEmail(event.target.value)}
            />
            <Button type="submit" disabled={pending || newEmail.trim() === ""}>
              {t("account.changeEmail")}
            </Button>
          </div>
        </form>
        {sent ? <p className="text-sm text-muted-foreground">{t("account.changeEmailSent", { email })}</p> : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}

export function PasskeysCard() {
  const { t } = useTranslation();
  const { data: passkeys, isPending } = authClient.useListPasskeys();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addPasskey() {
    setError(null);
    setAdding(true);
    const result = await authClient.passkey.addPasskey({ name: name.trim() || undefined });
    setAdding(false);
    if (result?.error) {
      setError(result.error.message ?? t("account.passkeyAddFailed"));
      return;
    }
    setName("");
  }

  async function removePasskey(id: string) {
    setError(null);
    setRemovingId(id);
    const result = await authClient.passkey.deletePasskey({ id });
    setRemovingId(null);
    if (result?.error) {
      setError(result.error.message ?? t("account.passkeyRemoveFailed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("account.passkeys")}</CardTitle>
        <CardDescription>{t("account.passkeysDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isPending ? (
          <div className="flex flex-col gap-2" role="status" aria-label={t("common.loading")}>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : passkeys && passkeys.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{passkey.name || t("account.unnamedPasskey")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("account.addedOn", { date: new Date(passkey.createdAt).toLocaleDateString() })}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void removePasskey(passkey.id)} disabled={removingId === passkey.id}>
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("account.noPasskeysYet")}</p>
        )}

        <div className="flex flex-col gap-2 border-t pt-4">
          <Label htmlFor="passkey-name">{t("account.passkeyNameLabel")}</Label>
          <div className="flex gap-2">
            <Input
              id="passkey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("account.passkeyNamePlaceholder")}
            />
            <Button onClick={() => void addPasskey()} disabled={adding}>
              {adding ? t("account.addingPasskey") : t("account.addPasskey")}
            </Button>
          </div>
        </div>

        {error ? <FieldError>{error}</FieldError> : null}
      </CardContent>
    </Card>
  );
}

const THEMES: { value: ThemeChoice; label: "settings.light" | "settings.dark" | "settings.auto" }[] = [
  { value: "light", label: "settings.light" },
  { value: "dark", label: "settings.dark" },
  { value: "device", label: "settings.auto" },
];

/**
 * Language and appearance (issue #540): the language of every app, email
 * and notification, and light or dark in every app - kept on the account,
 * Auto following each device. `applyTheme` is how this app shows a choice
 * at once (Songverse keeps its own, with its modes).
 */
export function LanguageCard({ api, locale, theme, applyTheme = setThemeChoice }: { api: ApiClient; locale: string; theme: AccountThemeValue | null; applyTheme?: (choice: ThemeChoice) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // Never chosen on the account (null): this device's own stays, shown as Auto until one is picked.
  const [shown, setShown] = useState<ThemeChoice>(theme === "light" || theme === "dark" ? theme : "device");

  async function save(change: { locale?: LocaleValue; theme?: AccountThemeValue | null }) {
    setSaving(true);
    try {
      await api.updateMe(change);
      await router.invalidate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="language-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("settings.languageAppearance")}</CardTitle>
        <CardDescription>{t("settings.languageAppearanceDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <Label htmlFor="locale">{t("settings.language")}</Label>
        <NativeSelect
          id="locale"
          value={locale}
          disabled={saving}
          onChange={(e) => void save({ locale: e.target.value as LocaleValue })}
          className="w-full max-w-xs"
        >
          {SUPPORTED_LOCALES.map((option) => (
            <option key={option} value={option}>
              {LOCALE_NAMES[option]}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t("settings.languageHint")}</p>
        <span className="mt-3 text-sm font-medium" id="appearance-label">
          {t("settings.appearance")}
        </span>
        <div role="radiogroup" aria-labelledby="appearance-label" className="inline-flex self-start rounded-lg border bg-muted p-0.5" data-testid="account-theme">
          {THEMES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={shown === value}
              disabled={saving}
              data-testid={`account-theme-${value}`}
              onClick={() => {
                setShown(value);
                applyTheme(value);
                void save({ theme: value === "device" ? "auto" : value });
              }}
              className={cn(
                "h-8 rounded-md px-4 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                shown === value && "bg-background font-medium text-foreground shadow-sm",
              )}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.appearanceHint")}</p>
      </CardContent>
    </Card>
  );
}

/** Calendars' first day of the week (issue #235), in Plan's settings (issue #540): Automatic follows the language. */
export function WeekStartCard({ api, weekStartsOn, description }: { api: ApiClient; weekStartsOn: 0 | 1 | 6 | null; description?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function save(next: 0 | 1 | 6 | null) {
    setSaving(true);
    try {
      await api.updateMe({ weekStartsOn: next });
      await router.invalidate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("settings.calendar")}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <Label htmlFor="week-start">{t("dashboard.weekStart")}</Label>
        <NativeSelect
          id="week-start"
          value={weekStartsOn === null ? "auto" : String(weekStartsOn)}
          disabled={saving}
          onChange={(e) => void save(e.target.value === "auto" ? null : (Number(e.target.value) as 0 | 1 | 6))}
          className="w-full max-w-xs"
          data-testid="week-start"
        >
          <option value="auto">{t("dashboard.weekStartAuto")}</option>
          <option value="1">{t("dashboard.weekStartMonday")}</option>
          <option value="0">{t("dashboard.weekStartSunday")}</option>
          <option value="6">{t("dashboard.weekStartSaturday")}</option>
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t("settings.weekStartHint")}</p>
      </CardContent>
    </Card>
  );
}

/**
 * The password (issue #540), changed with the current one; other devices
 * are signed out. Someone who signs in without one (a passkey, Google) is
 * told so.
 */
export function PasswordCard() {
  const { t } = useTranslation();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    void authClient.listAccounts().then(
      (result) => setHasPassword(!!result.data?.some((account) => account.providerId === "credential")),
      () => setHasPassword(true),
    );
  }, []);

  async function change() {
    setPending(true);
    setMessage(null);
    const result = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setPending(false);
    if (result.error) {
      setMessage({ kind: "error", text: result.error.message ?? String(result.error.status) });
      return;
    }
    setCurrent("");
    setNext("");
    setMessage({ kind: "ok", text: t("settings.passwordChanged") });
  }

  return (
    <Card data-testid="password-card">
      <CardHeader>
        <CardTitle className="text-sm">{t("settings.password")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {hasPassword === false ? (
          <p className="text-sm text-muted-foreground">{t("settings.noPassword")}</p>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void change();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-password">{t("settings.currentPassword")}</Label>
              <PasswordInput id="current-password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">{t("settings.newPassword")}</Label>
              <PasswordInput id="new-password" autoComplete="new-password" required minLength={8} value={next} onChange={(event) => setNext(event.target.value)} />
            </div>
            <Button type="submit" className="self-start" disabled={pending || !current || next.length < 8} data-testid="change-password">
              {t("settings.changePassword")}
            </Button>
          </form>
        )}
        {message ? <p className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p> : null}
      </CardContent>
    </Card>
  );
}

/** One's choice of light or dark kept on the account (issue #540), shown on this device: Auto follows it. */
export function useAccountTheme(theme: AccountThemeValue | null, applyTheme: (choice: ThemeChoice) => void = setThemeChoice) {
  useEffect(() => {
    // Never chosen on the account: each device keeps the one it had.
    if (theme) applyTheme(theme === "auto" ? "device" : theme);
  }, [theme]);
}
