import {
  composeBuiltInTemplate,
  composeScreenTheme,
  filterScreenTemplates,
  SCREEN_BACKGROUND_THEMES,
  SCREEN_CONTENT_THEMES,
  SCREEN_EFFECTS,
  SCREEN_TEMPLATES,
  screenBuiltInPart,
  type ScreenPartKind,
  type ScreenPartSummary,
  type ScreenTemplateTag,
  type ScreenThemeSummary,
  type ScreenWidgetDefault,
} from "@oneverse/core";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { Copy, Palette, Pencil, Plus, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@oneverse/ui/components/tabs";
import { partDocument, ScreenThemeEditor, TagPicker, type ThemeDraft } from "#/components/screen-theme-editor";
import { ScreenThemePreview } from "#/components/screen-theme-preview";
import { apiClient } from "#/lib/api-client";

const VIEWS = ["templates", "content", "background", "effects"] as const;
type View = (typeof VIEWS)[number];

/** What each kind of part is previewed with, besides itself (issue #281). */
const PREVIEW_WITH: Record<ScreenPartKind, { content: string; background: string; effects: string | null }> = {
  content: { content: "classic", background: "classic", effects: null },
  background: { content: "classic", background: "classic", effects: "pulse" },
  effects: { content: "classic", background: "concert", effects: null },
};

/** A part on its own, as a screen would show it with the built-in parts around it. */
function partPreview(kind: ScreenPartKind, document: unknown) {
  const around = PREVIEW_WITH[kind];
  return composeScreenTheme({
    content: kind === "content" ? document : screenBuiltInPart("content", around.content),
    background: kind === "background" ? document : screenBuiltInPart("background", around.background),
    effects: kind === "effects" ? document : around.effects ? screenBuiltInPart("effects", around.effects) : null,
  });
}

/**
 * Screens > Templates (issues #194, #281): templates - built-in and saved,
 * filtered by their tags - and their parts, each kind on its own: content
 * themes (the words), background themes and effects. Built-in ones are
 * customized into one's own; saved ones are changed (theirs, or a team's
 * they're an admin of) or deleted.
 */
export function TemplatesTab({ themes, parts, widgetDefaults }: { themes: ScreenThemeSummary[]; parts: ScreenPartSummary[]; widgetDefaults: ScreenWidgetDefault[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { teams } = useRouteContext({ from: "/_protected" });
  const [view, setView] = useState<View>("templates");
  const [tags, setTags] = useState<ScreenTemplateTag[]>([]);
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const changed = () => router.invalidate();

  const builtIns = filterScreenTemplates(
    SCREEN_TEMPLATES.map((one) => ({ ...one, tags: one.template.tags })),
    tags,
  );
  const saved = filterScreenTemplates(
    themes.map((one) => ({ ...one, tags: one.template.tags })),
    tags,
  );
  const newTemplate = (from: (typeof SCREEN_TEMPLATES)[number] | null): ThemeDraft => ({
    kind: "template",
    name: from ? t(`screens.templates.${from.id}.name`) : t("screens.newTemplateName"),
    tags: from?.template.tags ?? [],
    versesPerSlide: from?.template.versesPerSlide ?? 1,
    grid: from?.template.grid ?? null,
    masks: from?.template.masks ?? [],
    refs: from
      ? { content: { builtIn: from.content }, background: { builtIn: from.background }, effects: from.effects ? { builtIn: from.effects } : null }
      : { content: { builtIn: "classic" }, background: { builtIn: "classic" }, effects: null },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-5" />
          {t("screens.themesTitle")}
        </CardTitle>
        <CardDescription>{t("screens.themesDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList data-testid="templates-views">
            {VIEWS.map((one) => (
              <TabsTrigger key={one} value={one} data-testid={`templates-view-${one}`}>
                {t(`screens.views.${one}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="templates" className="flex flex-col gap-6 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" onClick={() => setDraft(newTemplate(null))} data-testid="new-theme">
                <Plus />
                {t("screens.newTemplate")}
              </Button>
              <TagPicker value={tags} onChange={setTags} testId="templates-tags" />
            </div>
            {saved.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">{t("screens.savedThemes")}</h3>
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="saved-themes">
                  {saved.map((theme) => (
                    <li key={theme.id} className="flex flex-col gap-2" data-testid={`saved-theme-${theme.name}`}>
                      <ScreenThemePreview theme={theme.theme} assets={theme.assets} />
                      <Tags tags={theme.template.tags} />
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium">{theme.name}</p>
                        <TeamMark team={theme.teamName} />
                        {theme.canEdit ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setDraft({ kind: "template", id: theme.id, name: theme.name, ownerTeamId: theme.ownerTeamId, tags: theme.template.tags, versesPerSlide: theme.template.versesPerSlide, grid: theme.template.grid, masks: theme.template.masks, refs: theme.parts })
                              }
                              data-testid="edit-theme"
                            >
                              <Pencil />
                              {t("screens.editTheme")}
                            </Button>
                            <ConfirmButton
                              label={t("screens.deleteTheme")}
                              confirmLabel={t("screens.confirmDeleteTheme")}
                              busyLabel={t("screens.deletingTheme")}
                              cancelLabel={t("admin.cancel")}
                              busy={false}
                              onConfirm={async () => {
                                await apiClient.deleteScreenTheme(theme.id);
                                await changed();
                              }}
                            />
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">{t("screens.builtIn")}</h3>
              {builtIns.length === 0 && saved.length === 0 ? <p className="text-sm text-muted-foreground">{t("screens.noTemplatesTagged")}</p> : null}
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="builtin-themes">
                {builtIns.map((template) => (
                  <li key={template.id} className="flex flex-col gap-2" data-testid={`builtin-theme-${template.id}`}>
                    <ScreenThemePreview theme={composeBuiltInTemplate(template.id)!} />
                    <Tags tags={template.tags} />
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{t(`screens.templates.${template.id}.name`)}</p>
                        <p className="text-xs text-muted-foreground">{t(`screens.templates.${template.id}.description`)}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setDraft(newTemplate(template))} data-testid="customize-theme">
                        {t("screens.customize")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </TabsContent>
          {(["content", "background", "effects"] as const).map((kind) => (
            <TabsContent key={kind} value={kind} className="pt-4">
              <PartsList kind={kind} parts={parts.filter((one) => one.kind === kind)} onOpen={setDraft} onChanged={changed} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
      {draft ? (
        <ScreenThemeEditor
          key={`${draft.kind}:${draft.id ?? "new"}`}
          draft={draft}
          teams={teams}
          parts={parts}
          widgetDefaults={widgetDefaults}
          onClose={() => setDraft(null)}
          onSaved={async (saved) => {
            // A part saved from a template stays in the template's editor; anything else closes it.
            if (draft.kind !== "template" || !("kind" in saved)) setDraft(null);
            await changed();
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * A kind of part (issue #281): the user's and their teams', each previewed
 * with built-in parts around it, to change or delete (not while a template
 * uses it); the built-in ones, to customize into one's own.
 */
function PartsList({ kind, parts, onOpen, onChanged }: { kind: ScreenPartKind; parts: ScreenPartSummary[]; onOpen: (draft: ThemeDraft) => void; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const builtIns = kind === "content" ? SCREEN_CONTENT_THEMES : kind === "background" ? SCREEN_BACKGROUND_THEMES : SCREEN_EFFECTS;
  return (
    <div className="flex flex-col gap-6" data-testid={`parts-${kind}`}>
      <p className="text-sm text-muted-foreground">{t(`screens.parts.about.${kind}`)}</p>
      <div>
        <Button type="button" size="sm" onClick={() => onOpen({ kind, name: t(`screens.parts.newName.${kind}`), document: partDocument(kind, { builtIn: kind === "effects" ? "pulse" : "classic" }, []) })} data-testid={`new-part-${kind}`}>
          <Plus />
          {t(`screens.parts.new.${kind}`)}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {parts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t("screens.parts.saved")}</h3>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {parts.map((part) => (
              <li key={part.id} className="flex flex-col gap-2" data-testid={`saved-part-${part.name}`}>
                <ScreenThemePreview theme={partPreview(kind, part.document)} assets={part.assets} />
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{part.name}</p>
                    <p className="text-xs text-muted-foreground">{t("screens.parts.usedBy", { count: part.templates })}</p>
                  </div>
                  <TeamMark team={part.teamName} />
                  {part.canEdit ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onOpen({ kind, id: part.id, name: part.name, ownerTeamId: part.ownerTeamId, document: part.document, assets: part.assets })} data-testid="edit-part">
                        <Pencil />
                        {t("screens.parts.edit")}
                      </Button>
                      <ConfirmButton
                        label={t("screens.deleteTheme")}
                        confirmLabel={t("screens.confirmDeleteTheme")}
                        busyLabel={t("screens.deletingTheme")}
                        cancelLabel={t("admin.cancel")}
                        busy={false}
                        onConfirm={async () => {
                          setError(null);
                          try {
                            await apiClient.deleteScreenPart(part.id);
                            await onChanged();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      />
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t("screens.builtIn")}</h3>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {builtIns.map((one) => (
            <li key={one.id} className="flex flex-col gap-2" data-testid={`builtin-part-${one.id}`}>
              <ScreenThemePreview theme={partPreview(kind, one.part)} />
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{t(`screens.parts.builtIn.${kind}.${one.id}`)}</p>
                <Button size="sm" variant="outline" onClick={() => onOpen({ kind, name: t("screens.parts.copyOf", { name: t(`screens.parts.builtIn.${kind}.${one.id}`) }), document: one.part })} data-testid="customize-part">
                  <Copy />
                  {t("screens.customize")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tags({ tags }: { tags: readonly ScreenTemplateTag[] }) {
  const { t } = useTranslation();
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid="template-tags">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {t(`screens.tags.${tag}`)}
        </span>
      ))}
    </div>
  );
}

function TeamMark({ team }: { team: string | null }) {
  const { t } = useTranslation();
  if (!team) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <Users className="size-3.5" aria-hidden />
      {t("screens.teamTheme", { team })}
    </span>
  );
}
