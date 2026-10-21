import { SCREEN_TEMPLATES, type ScreenThemeSummary, type SetItemTemplate, type SetlistItemScreenTemplate } from "@oneverse/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { apiClient } from "#/lib/api-client";

/** A template as the select keeps it: "b:<id>" a built-in one, "s:<id>" a saved one, "" the screen's own. */
function valueOf(template: SetlistItemScreenTemplate | null): string {
  if (!template) return "";
  return "builtIn" in template ? `b:${template.builtIn}` : `s:${template.id}`;
}
function templateOf(value: string): SetlistItemScreenTemplate | null {
  if (value.startsWith("b:")) return { builtIn: value.slice(2) };
  if (value.startsWith("s:")) return { id: value.slice(2) };
  return null;
}

/** An item's template as a request names it. */
export function templateRef(template: SetItemTemplate | null | undefined): SetlistItemScreenTemplate | null {
  if (template?.builtIn) return { builtIn: template.builtIn };
  if (template?.id) return { id: template.id };
  return null;
}

/** A passage's template's name: a saved one's, or a built-in one's in the reader's language. */
export function templateName(template: SetItemTemplate, t: (key: string) => string): string {
  return template.name ?? t(`screens.templates.${template.builtIn}.name`);
}

/**
 * Which template the screens show a passage with (issue #310): those for
 * scripture first - the built-in ones and the reader's own or their teams' -
 * then the others, or the screen's own. Each says how many verses it puts
 * on a slide.
 */
export function PassageTemplateSelect({ id, value, onChange }: { id: string; value: SetlistItemScreenTemplate | null; onChange: (template: SetlistItemScreenTemplate | null) => void }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<ScreenThemeSummary[] | null>(null);
  useEffect(() => {
    void apiClient
      .listScreenThemes()
      .catch(() => [])
      .then(setSaved);
  }, []);

  const options = [
    ...SCREEN_TEMPLATES.map((one) => ({ value: `b:${one.id}`, name: t(`screens.templates.${one.id}.name`), tags: one.template.tags as string[], verses: one.template.versesPerSlide })),
    ...(saved ?? []).map((one) => ({ value: `s:${one.id}`, name: one.teamName ? `${one.name} (${one.teamName})` : one.name, tags: one.template.tags as string[], verses: one.template.versesPerSlide })),
  ];
  const scripture = options.filter((one) => one.tags.includes("scripture"));
  const others = options.filter((one) => !one.tags.includes("scripture"));
  const picked = options.find((one) => one.value === valueOf(value));
  const label = (one: (typeof options)[number]) => `${one.name} - ${t("biblePage.versesPerSlide", { count: one.verses })}`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t("biblePage.template")}</Label>
      <NativeSelect id={id} value={valueOf(value)} onChange={(event) => onChange(templateOf(event.target.value))} data-testid="passage-template">
        <option value="">{t("biblePage.templateScreen")}</option>
        <optgroup label={t("biblePage.templateScripture")}>
          {scripture.map((one) => (
            <option key={one.value} value={one.value}>
              {label(one)}
            </option>
          ))}
        </optgroup>
        {others.length ? (
          <optgroup label={t("biblePage.templateOther")}>
            {others.map((one) => (
              <option key={one.value} value={one.value}>
                {label(one)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {/* One kept on the item that's no longer offered (deleted, or a team left): still named. */}
        {value && !picked && saved ? <option value={valueOf(value)}>{t("biblePage.templateGone")}</option> : null}
      </NativeSelect>
      <p className="text-xs text-muted-foreground">{t("biblePage.templateHint")}</p>
    </div>
  );
}
