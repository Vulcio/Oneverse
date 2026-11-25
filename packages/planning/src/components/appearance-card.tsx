import { ENTITY_COLORS, entityColor, type ApiClient, type EntityColor } from "@oneverse/core";
import { Check } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ENTITY_COLOR_CLASSES, EntityAvatar } from "@oneverse/ui/components/entity-avatar";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { cn } from "@oneverse/ui/lib/utils";
import { FieldError } from "@oneverse/ui/components/field";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";

const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/**
 * A team's or a songbook's colour and picture (issue #161), for who manages
 * it. The colour is saved by `onColor` (the team's or the songbook's own
 * update); the picture goes straight to the API, which crops it square.
 * Shared (issue #550): a team's on its page in every app, a songbook's in Songverse.
 */
export function AppearanceCard({
  api,
  owner,
  id,
  name,
  color,
  avatarUrl,
  onColor,
  onChanged,
  description,
  onDescription,
}: {
  api: Pick<ApiClient, "uploadPicture" | "removePicture">;
  owner: "teams" | "songbooks";
  id: string;
  name: string;
  color: string | null;
  avatarUrl: string | null;
  onColor: (color: EntityColor | null) => Promise<unknown>;
  onChanged: () => Promise<unknown>;
  /** A team's description too (issue #550), with how it's saved. */
  description?: string | null;
  onDescription?: (description: string | null) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(description ?? "");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const derived = entityColor(null, name);

  return (
    <Card data-testid="appearance">
      <CardHeader>
        <CardTitle className="text-sm">{t("appearance.title")}</CardTitle>
        <CardDescription>{t("appearance.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <EntityAvatar name={name} color={color} avatarUrl={avatarUrl} size={56} />
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              data-testid="appearance-picture-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > MAX_PICTURE_BYTES) {
                  setError(t("appearance.pictureTooLarge"));
                  return;
                }
                void run(() => api.uploadPicture(owner, id, file, file.name));
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              {avatarUrl ? t("appearance.changePicture") : t("appearance.addPicture")}
            </Button>
            {avatarUrl ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => api.removePicture(owner, id))}>
                {t("appearance.removePicture")}
              </Button>
            ) : null}
          </div>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("appearance.color")}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("appearance.color")}>
            <button
              type="button"
              role="radio"
              aria-checked={color === null}
              aria-label={t("appearance.colorFromName")}
              title={t("appearance.colorFromName")}
              disabled={busy}
              onClick={() => void run(() => onColor(null))}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                color === null && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
            >
              <span className={cn("size-4 rounded", ENTITY_COLOR_CLASSES[derived])} />
              {t("appearance.colorFromName")}
            </button>
            {ENTITY_COLORS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={color === key}
                aria-label={t(`appearance.colors.${key}`)}
                title={t(`appearance.colors.${key}`)}
                disabled={busy}
                onClick={() => void run(() => onColor(key))}
                data-testid={`appearance-color-${key}`}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ENTITY_COLOR_CLASSES[key],
                  color === key && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                )}
              >
                {color === key ? <Check className="size-4" /> : null}
              </button>
            ))}
          </div>
        </fieldset>
        {onDescription ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => onDescription(text.trim() || null));
            }}
          >
            <Label htmlFor="appearance-description">{t("teams.descriptionLabel")}</Label>
            <Textarea id="appearance-description" value={text} maxLength={500} rows={2} onChange={(e) => setText(e.target.value)} data-testid="appearance-description" />
            <Button type="submit" variant="outline" size="sm" className="self-start" disabled={busy || text.trim() === (description ?? "")} data-testid="appearance-description-save">
              {t("teams.saveName")}
            </Button>
          </form>
        ) : null}
        {error ? (
          <FieldError>
            {error}
          </FieldError>
        ) : null}
      </CardContent>
    </Card>
  );
}
