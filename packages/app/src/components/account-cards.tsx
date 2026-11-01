import { SUPPORTED_LOCALES, type ApiClient, type LocaleValue, type UserProfile } from "@oneverse/core";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
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
import { authClient } from "../auth-client";
import { oneverseUrl } from "../public-env";

// The account's own cards (issue #242): one's name and picture, email,
// passkeys, language - each with its app's API client. Email and passkeys
// need BetterAuth's own session, so they're Oneverse's (issue #303); the
// apps show OneverseAccountCard instead.

// Only guards what the browser has to decode for cropping; what's uploaded
// is the cropped result, at most 512x512.
const MAX_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024;

const LOCALE_NAMES: Record<LocaleValue, string> = { en: "English", fr: "Français" };

export function ProfileCard({ api, profile }: { api: ApiClient; profile: UserProfile }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function run(action: () => Promise<unknown>, successText?: string) {
    setPending(true);
    setMessage(null);
    try {
      await action();
      // Also reloads the session, so the sidebar picks up the new name/picture.
      await router.invalidate();
      if (successText) setMessage({ kind: "ok", text: successText });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPending(false);
    }
  }

  const trimmedName = displayName.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("account.profile")}</CardTitle>
        <CardDescription>{t("account.profileDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AvatarPicker api={api} profile={profile} />

        <form
          className="flex flex-col gap-2 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.updateMe({ displayName: trimmedName }), t("account.saved"));
          }}
        >
          <Label htmlFor="display-name">{t("account.displayNameLabel")}</Label>
          <div className="flex gap-2">
            <Input id="display-name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
            <Button type="submit" disabled={pending || trimmedName === "" || trimmedName === profile.displayName}>
              {pending ? t("account.saving") : t("account.save")}
            </Button>
          </div>
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
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
        <CardTitle className="text-sm">{t("account.oneverseTitle")}</CardTitle>
        <CardDescription>
          {email} · {t("account.oneverseDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" render={<a href={`${oneverseUrl()}/account`} />}>
          {t("account.openOneverse")}
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
      callbackURL: `${window.location.origin}/account`,
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
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

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

export function LanguageCard({ api, locale, weekStartsOn }: { api: ApiClient; locale: string; weekStartsOn: 0 | 1 | 6 | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function save(change: { locale?: LocaleValue; weekStartsOn?: 0 | 1 | 6 | null }) {
    setSaving(true);
    try {
      await api.updateMe(change);
      await router.invalidate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("dashboard.language")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <Label htmlFor="locale">{t("dashboard.languageDescription")}</Label>
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
        {/* Calendars' first day of the week (issue #235): Automatic follows the language. */}
        <Label htmlFor="week-start" className="mt-3">
          {t("dashboard.weekStart")}
        </Label>
        <NativeSelect
          id="week-start"
          value={weekStartsOn === null ? "auto" : String(weekStartsOn)}
          disabled={saving}
          onChange={(e) => void save({ weekStartsOn: e.target.value === "auto" ? null : (Number(e.target.value) as 0 | 1 | 6) })}
          className="w-full max-w-xs"
          data-testid="week-start"
        >
          <option value="auto">{t("dashboard.weekStartAuto")}</option>
          <option value="1">{t("dashboard.weekStartMonday")}</option>
          <option value="0">{t("dashboard.weekStartSunday")}</option>
          <option value="6">{t("dashboard.weekStartSaturday")}</option>
        </NativeSelect>
      </CardContent>
    </Card>
  );
}
