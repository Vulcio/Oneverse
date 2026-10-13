import {
  SUPPORTED_LOCALES,
  type CapoDisplayModeValue,
  type ChordNotationValue,
  type ChordDiagramsValue,
  TUNINGS,
  type LiveViewValue,
  type LocaleValue,
  type StorageUsage,
  type UserProfile,
} from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Trash2 } from "lucide-react";
import { apiClient } from "#/lib/api-client";
import { authClient } from "@songverse/app/auth-client";
import { formatBytes } from "#/lib/format-bytes";
import { ImageCropDialog } from "#/components/image-crop-dialog";
import { sizedAvatarUrl } from "#/lib/avatar-url";
import { Avatar, AvatarFallback, AvatarImage } from "@songverse/ui/components/avatar";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { initials } from "#/lib/initials";
import { NativeSelect } from "@songverse/ui/components/native-select";

// Only guards what the browser has to decode for cropping; what's uploaded
// is the cropped result, at most 512x512.
const MAX_AVATAR_SOURCE_BYTES = 25 * 1024 * 1024;

const LOCALE_NAMES: Record<LocaleValue, string> = { en: "English", fr: "Français" };

export function ProfileCard({ profile }: { profile: UserProfile }) {
  const { t } = useTranslation();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);

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

  function onFileChosen(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      setMessage({ kind: "error", text: t("account.avatarTooLarge") });
      return;
    }
    setMessage(null);
    setCropping(file);
  }

  const trimmedName = displayName.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("account.profile")}</CardTitle>
        <CardDescription>{t("account.profileDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => void run(() => apiClient.removeAvatar())}>
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

        <form
          className="flex flex-col gap-2 border-t pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => apiClient.updateMe({ displayName: trimmedName }), t("account.saved"));
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
              await apiClient.uploadAvatar(cropped, "avatar.webp");
              setCropping(null);
              // Also reloads the session, so the sidebar picks up the new picture.
              await router.invalidate();
            }}
          />
        ) : null}
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
      callbackURL: `${window.location.origin}/dashboard`,
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

export function StorageCard({ storage }: { storage: StorageUsage }) {
  const { t } = useTranslation();
  const used = formatBytes(storage.usedBytes);
  const percent = storage.limitBytes ? Math.min(100, (storage.usedBytes / storage.limitBytes) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("account.storageTitle")}</CardTitle>
        <CardDescription>{t("account.storageDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {storage.limitBytes === null ? (
          <p className="text-sm">{t("account.storageUnlimited", { used })}</p>
        ) : (
          <>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
            >
              <div className={percent >= 90 ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm">{t("account.storageUsage", { used, limit: formatBytes(storage.limitBytes) })}</p>
          </>
        )}
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

export function LanguageCard({ locale, weekStartsOn }: { locale: string; weekStartsOn: 0 | 1 | 6 | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function save(change: { locale?: LocaleValue; weekStartsOn?: 0 | 1 | 6 | null }) {
    setSaving(true);
    try {
      await apiClient.updateMe(change);
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

/** How every chart reads for this user: chord names, chords with a capo, chord diagrams (issue #207), and how songs read in Live (issue #155). */
export function ChartDisplayCard({ profile }: { profile: Pick<UserProfile, "chordNotation" | "capoDisplayMode" | "liveView" | "chordDiagrams" | "chordColors" | "leftHanded" | "guitarTuning" | "ukuleleTuning" | "pianoSmooth" | "pianoHands" | "pianoNoteNames"> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(change: { chordNotation?: ChordNotationValue; capoDisplayMode?: CapoDisplayModeValue; liveView?: LiveViewValue; chordDiagrams?: ChordDiagramsValue; chordColors?: boolean; leftHanded?: boolean; guitarTuning?: string; ukuleleTuning?: string; pianoSmooth?: boolean; pianoHands?: string; pianoNoteNames?: string }) {
    setSaving(true);
    setError(null);
    try {
      await apiClient.updateMe(change);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("dashboard.chartDisplay")}</CardTitle>
        <CardDescription>{t("dashboard.chartDisplayDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chord-notation">{t("dashboard.chordNotation")}</Label>
          <NativeSelect
            id="chord-notation"
            value={profile.chordNotation}
            disabled={saving}
            onChange={(e) => void save({ chordNotation: e.target.value as ChordNotationValue })}
            className="w-full max-w-xs"
          >
            <option value="LETTERS">{t("dashboard.notationLetters")}</option>
            <option value="SOLFEGE">{t("dashboard.notationSolfege")}</option>
            <option value="NASHVILLE">{t("dashboard.notationNashville")}</option>
            <option value="ROMAN">{t("dashboard.notationRoman")}</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{t("dashboard.notationHint")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chord-colors">{t("dashboard.chordColors")}</Label>
          <NativeSelect
            id="chord-colors"
            value={profile.chordColors ? "ON" : "OFF"}
            disabled={saving}
            onChange={(e) => void save({ chordColors: e.target.value === "ON" })}
            className="w-full max-w-xs"
          >
            <option value="OFF">{t("dashboard.colorsOff")}</option>
            <option value="ON">{t("dashboard.colorsOn")}</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{t("dashboard.chordColorsHint")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="capo-display">{t("dashboard.capoDisplay")}</Label>
          <NativeSelect
            id="capo-display"
            value={profile.capoDisplayMode}
            disabled={saving}
            onChange={(e) => void save({ capoDisplayMode: e.target.value as CapoDisplayModeValue })}
            className="w-full max-w-xs"
          >
            <option value="SOUNDING">{t("dashboard.capoSounding")}</option>
            <option value="FINGERED">{t("dashboard.capoShapes")}</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chord-diagrams">{t("dashboard.chordDiagrams")}</Label>
          <NativeSelect
            id="chord-diagrams"
            value={profile.chordDiagrams}
            disabled={saving}
            onChange={(e) => void save({ chordDiagrams: e.target.value as ChordDiagramsValue })}
            className="w-full max-w-xs"
          >
            <option value="OFF">{t("dashboard.diagramsOff")}</option>
            <option value="GUITAR">{t("dashboard.diagramsGuitar")}</option>
            <option value="UKULELE">{t("dashboard.diagramsUkulele")}</option>
            <option value="PIANO">{t("dashboard.diagramsPiano")}</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{t("dashboard.chordDiagramsHint")}</p>
        </div>
        {profile.chordDiagrams === "PIANO" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="piano-voicing">{t("dashboard.pianoVoicing")}</Label>
              <NativeSelect
                id="piano-voicing"
                value={profile.pianoSmooth ? "SMOOTH" : "ROOT"}
                disabled={saving}
                onChange={(e) => void save({ pianoSmooth: e.target.value === "SMOOTH" })}
                className="w-full max-w-xs"
              >
                <option value="SMOOTH">{t("dashboard.pianoSmooth")}</option>
                <option value="ROOT">{t("dashboard.pianoRoot")}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="piano-hands">{t("dashboard.pianoHands")}</Label>
              <NativeSelect id="piano-hands" value={profile.pianoHands} disabled={saving} onChange={(e) => void save({ pianoHands: e.target.value })} className="w-full max-w-xs">
                <option value="both">{t("dashboard.pianoBoth")}</option>
                <option value="right">{t("dashboard.pianoRight")}</option>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="piano-names">{t("dashboard.pianoNoteNames")}</Label>
              <NativeSelect
                id="piano-names"
                value={profile.pianoNoteNames}
                disabled={saving}
                onChange={(e) => void save({ pianoNoteNames: e.target.value })}
                className="w-full max-w-xs"
              >
                <option value="card">{t("dashboard.pianoNamesCard")}</option>
                <option value="all">{t("dashboard.pianoNamesAll")}</option>
                <option value="none">{t("dashboard.pianoNamesNone")}</option>
              </NativeSelect>
            </div>
          </>
        ) : null}
        {profile.chordDiagrams === "GUITAR" || profile.chordDiagrams === "UKULELE" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="instrument-tuning">{t(profile.chordDiagrams === "UKULELE" ? "dashboard.ukuleleTuning" : "dashboard.guitarTuning")}</Label>
              <NativeSelect
                id="instrument-tuning"
                value={profile.chordDiagrams === "UKULELE" ? profile.ukuleleTuning : profile.guitarTuning}
                disabled={saving}
                onChange={(e) => void save(profile.chordDiagrams === "UKULELE" ? { ukuleleTuning: e.target.value } : { guitarTuning: e.target.value })}
                className="w-full max-w-xs"
              >
                {TUNINGS[profile.chordDiagrams === "UKULELE" ? "ukulele" : "guitar"].map((tuning) => (
                  <option key={tuning.id} value={tuning.id}>
                    {tuning.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="left-handed">{t("dashboard.leftHanded")}</Label>
              <NativeSelect
                id="left-handed"
                value={profile.leftHanded ? "YES" : "NO"}
                disabled={saving}
                onChange={(e) => void save({ leftHanded: e.target.value === "YES" })}
                className="w-full max-w-xs"
              >
                <option value="NO">{t("dashboard.leftHandedNo")}</option>
                <option value="YES">{t("dashboard.leftHandedYes")}</option>
              </NativeSelect>
            </div>
          </>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="live-view">{t("dashboard.liveView")}</Label>
          <NativeSelect
            id="live-view"
            value={profile.liveView}
            disabled={saving}
            onChange={(e) => void save({ liveView: e.target.value as LiveViewValue })}
            className="w-full max-w-xs"
          >
            <option value="CHART">{t("dashboard.liveViewChart")}</option>
            <option value="PDF">{t("dashboard.liveViewPdf")}</option>
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{t("dashboard.liveViewHint")}</p>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
