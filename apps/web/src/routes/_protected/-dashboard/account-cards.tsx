import {
  type CapoDisplayModeValue,
  type ChordNotationValue,
  type ChordDiagramsValue,
  TUNINGS,
  type LiveViewValue,
  type StorageUsage,
  type UserProfile,
} from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { formatBytes } from "#/lib/format-bytes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";


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
            <option value="GRID">{t("dashboard.liveViewGrid")}</option>
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
