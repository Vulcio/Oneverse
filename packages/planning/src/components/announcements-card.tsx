import { announcementText, type Announcement, type AnnouncementAudience, type AnnouncementText } from "@oneverse/core";
import { Megaphone, Pencil, Plus, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@oneverse/ui/components/badge";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Empty } from "@oneverse/ui/components/empty";
import { FieldError } from "@oneverse/ui/components/field";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { Textarea } from "@oneverse/ui/components/textarea";

type Language = "en" | "fr";
type Texts = Partial<Record<Language, AnnouncementText>>;

/** What an announcement is saved with: its words, and who it's for (where the card offers a choice). */
export interface AnnouncementDraft {
  texts: Partial<Record<Language, AnnouncementText | null>>;
  audience?: AnnouncementAudience;
  organizationId?: string | null;
  teamIds?: string[];
  withSubgroups?: boolean;
}

/** A team it can go to; one under another (an organisation's group) names it. */
export interface AnnouncementTeam {
  id: string;
  name: string;
  parentId?: string | null;
}

/** Pages of the app an announcement can lead to, by their name in the reader's language. */
const PAGES = [
  ["roles", "/dashboard#roles"],
  ["settings", "/dashboard#settings"],
  ["notifications", "/dashboard#notifications"],
  ["calendar", "/calendar"],
  ["sets", "/sets"],
  ["library", "/library"],
  ["teams", "/teams"],
  ["people", "/people"],
] as const;
const WHATS_NEW: Record<Language, string> = { en: "https://docs.oneverse.top/whats-new/", fr: "https://docs.oneverse.top/fr/whats-new/" };

/** How the card reaches the API: Admin's calls, or an organisation's. */
export interface AnnouncementsActions {
  list: () => Promise<Announcement[]>;
  create: (draft: AnnouncementDraft) => Promise<Announcement>;
  update: (id: string, draft: AnnouncementDraft) => Promise<Announcement>;
  send: (id: string) => Promise<Announcement>;
  remove: (id: string) => Promise<void>;
}

/**
 * Announcements (issue #536): drafts and sent ones, newest first, each with
 * who it went to (or would go to now); written in each of `languages`, seen
 * as the bell will show it, then sent - or fixed after, for everyone, or
 * taken back. Admin > Announcements gives every language and an audience
 * (`audiences`, `organizations`); an organisation's page its admins' one.
 */
export function AnnouncementsCard({
  actions,
  languages,
  audiences,
  audienceLabel,
  organizations = [],
  teams = [],
  title,
  description,
}: {
  actions: AnnouncementsActions;
  languages: readonly Language[];
  /** Who it can go to; left out, the page's own: its organisation's or its team's members (the API decides). */
  audiences?: readonly AnnouncementAudience[];
  /** Each audience's name, when the page words them its own way ("All its members"). */
  audienceLabel?: (audience: AnnouncementAudience) => string;
  organizations?: { id: string; name: string }[];
  /** The teams TEAMS offers. */
  teams?: AnnouncementTeam[];
  title: string;
  description: string;
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => actions.list().then(setItems, (err: unknown) => setError(err instanceof Error ? err.message : String(err))), [actions]);
  useEffect(() => void reload(), [reload]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const nameOf = audienceLabel ?? ((audience: AnnouncementAudience) => t(`announcements.audiences.${audience}`));
  // Who a sent or drafted one is for, in a few words.
  const reach = (item: Announcement) =>
    item.audience === "TEAMS" && item.teams.length > 0
      ? item.teams.map((team) => team.name ?? "?").join(", ") + (item.withSubgroups ? ` (+ ${t("announcements.withSubgroups").toLowerCase()})` : "")
      : item.audience === "ORGANIZATION" && item.organizationName && !audienceLabel
        ? item.organizationName
        : nameOf(item.audience);
  const date = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  return (
    <Card data-testid="announcements">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-sm">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {editing ? null : (
            <Button size="sm" onClick={() => setEditing("new")} data-testid="announcement-new">
              <Plus />
              {t("announcements.new")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <FieldError>{error}</FieldError> : null}
        {editing ? (
          <AnnouncementEditor
            key={editing === "new" ? "new" : editing.id}
            announcement={editing === "new" ? null : editing}
            languages={languages}
            audiences={audiences}
            audienceLabel={nameOf}
            organizations={organizations}
            teams={teams}
            busy={busy === "save"}
            onCancel={() => setEditing(null)}
            onSave={(draft) =>
              run("save", async () => {
                await (editing === "new" ? actions.create(draft) : actions.update(editing.id, draft));
                setEditing(null);
              })
            }
          />
        ) : null}
        {items === null ? null : items.length === 0 ? (
          <Empty className="py-4">{t("announcements.empty")}</Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border" data-testid="announcement-list">
            {items.map((item) => {
              const text = announcementText(item.texts, i18n.language);
              return (
                <li key={item.id} className="flex flex-col gap-2 p-3" data-testid="announcement" data-sent={!!item.sentAt}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Megaphone className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-sm font-medium break-words">{text?.title}</span>
                    {item.release ? <Badge variant="outline">{t("announcements.release", { version: item.release })}</Badge> : null}
                    {item.sentAt ? null : <Badge variant="muted">{t("announcements.draft")}</Badge>}
                  </div>
                  {text?.body ? <p className="text-xs text-muted-foreground">{text.body}</p> : null}
                  <p className="text-xs text-muted-foreground" data-testid="announcement-reach">
                    {audiences ? `${reach(item)} · ` : null}
                    {item.sentAt ? t("announcements.sentOn", { date: date(item.sentAt), count: item.recipients }) : t("announcements.wouldReach", { count: item.recipients })}
                    {item.createdBy ? ` · ${t("announcements.by", { name: item.createdBy.displayName })}` : null}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setEditing(item)} data-testid="announcement-edit">
                      <Pencil />
                      {t("announcements.edit")}
                    </Button>
                    {item.sentAt ? null : <SendButton count={item.recipients} busy={busy === `send-${item.id}`} onSend={() => run(`send-${item.id}`, () => actions.send(item.id))} />}
                    <ConfirmButton
                      label={item.sentAt ? t("announcements.takeBack") : t("announcements.delete")}
                      confirmLabel={item.sentAt ? t("announcements.confirmTakeBack") : t("announcements.confirmDelete")}
                      busyLabel={t("announcements.deleting")}
                      cancelLabel={t("announcements.cancel")}
                      busy={busy === `delete-${item.id}`}
                      onConfirm={() => run(`delete-${item.id}`, () => actions.remove(item.id))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Send, then say to how many - sending can't be undone, only taken back. */
function SendButton({ count, busy, onSend }: { count: number; busy: boolean; onSend: () => void }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button size="sm" disabled={busy || count === 0} onClick={() => setAsking(true)} data-testid="announcement-send">
        <Send />
        {t("announcements.send")}
      </Button>
    );
  }
  return (
    <span className="flex gap-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setAsking(false);
          onSend();
        }}
        data-testid="announcement-send-confirm"
      >
        <Send />
        {busy ? t("announcements.sending") : t("announcements.sendTo", { count })}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setAsking(false)}>
        {t("announcements.cancel")}
      </Button>
    </span>
  );
}

const blank: AnnouncementText = { title: "", body: "", url: "" };

/** Its words in each language, who it's for, and how the bell will show it. */
function AnnouncementEditor({
  announcement,
  languages,
  audiences,
  audienceLabel,
  organizations,
  teams,
  busy,
  onCancel,
  onSave,
}: {
  announcement: Announcement | null;
  languages: readonly Language[];
  audiences?: readonly AnnouncementAudience[];
  audienceLabel: (audience: AnnouncementAudience) => string;
  organizations: { id: string; name: string }[];
  teams: AnnouncementTeam[];
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: AnnouncementDraft) => void;
}) {
  const { t, i18n } = useTranslation();
  const sent = !!announcement?.sentAt;
  // The languages offered, and any it was written in besides.
  const shown = [...new Set([...languages, ...(Object.keys(announcement?.texts ?? {}) as Language[])])];
  const [texts, setTexts] = useState<Texts>(() => Object.fromEntries(shown.map((language) => [language, { ...blank, ...announcement?.texts[language] }])));
  const [audience, setAudience] = useState<AnnouncementAudience>(announcement?.audience ?? audiences?.[0] ?? "EVERYONE");
  const [teamIds, setTeamIds] = useState<string[]>(announcement?.teams.map((team) => team.id) ?? []);
  const [withSubgroups, setWithSubgroups] = useState(announcement?.withSubgroups ?? false);
  const [filter, setFilter] = useState("");
  const [organizationId, setOrganizationId] = useState(announcement?.organizationId ?? organizations[0]?.id ?? "");
  const change = (language: Language, field: keyof AnnouncementText, value: string) => setTexts((all) => ({ ...all, [language]: { ...blank, ...all[language], [field]: value } }));
  // A language left blank isn't one it's written in.
  const written = Object.fromEntries(shown.map((language) => [language, texts[language]?.title.trim() ? { title: texts[language]!.title, body: texts[language]!.body, url: texts[language]!.url || null } : null])) as AnnouncementDraft["texts"];
  const preview = announcementText(Object.fromEntries(Object.entries(written).filter(([, text]) => !!text)) as Texts, i18n.language);

  return (
    <form
      className="flex flex-col gap-4 rounded-md border p-3"
      data-testid="announcement-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          texts: written,
          ...(audiences && !sent
            ? { audience, organizationId: audience === "ORGANIZATION" ? organizationId : null, teamIds: audience === "TEAMS" ? teamIds : [], withSubgroups: audience === "TEAMS" && withSubgroups }
            : {}),
        });
      }}
    >
      {shown.map((language) => (
        <fieldset key={language} className="flex flex-col gap-2" data-language={language}>
          {shown.length > 1 ? <legend className="mb-1 text-xs font-medium text-muted-foreground uppercase">{t(`announcements.language.${language}`)}</legend> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`announcement-title-${language}`}>{t("announcements.titleLabel")}</Label>
            <Input id={`announcement-title-${language}`} maxLength={120} value={texts[language]?.title ?? ""} onChange={(event) => change(language, "title", event.target.value)} data-testid={`announcement-title-${language}`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`announcement-body-${language}`}>{t("announcements.bodyLabel")}</Label>
            <Textarea id={`announcement-body-${language}`} maxLength={500} rows={2} value={texts[language]?.body ?? ""} onChange={(event) => change(language, "body", event.target.value)} data-testid={`announcement-body-${language}`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`announcement-url-${language}`}>{t("announcements.urlLabel")}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`announcement-url-${language}`}
                className="min-w-48 flex-1"
                maxLength={500}
                value={texts[language]?.url ?? ""}
                placeholder="https://"
                onChange={(event) => change(language, "url", event.target.value)}
                data-testid={`announcement-url-${language}`}
              />
              {/* A page of the app, by its name: Skills, Settings… (issue #536). */}
              <NativeSelect
                aria-label={t("announcements.pageInApp")}
                value=""
                onChange={(event) => event.target.value && change(language, "url", event.target.value)}
                data-testid={`announcement-page-${language}`}
              >
                <option value="">{t("announcements.pageInApp")}</option>
                {PAGES.map(([key, path]) => (
                  <option key={key} value={path}>
                    {t(`announcements.pages.${key}`)}
                  </option>
                ))}
                <option value={WHATS_NEW[language]}>{t("announcements.pages.whatsNew")}</option>
              </NativeSelect>
            </div>
          </div>
        </fieldset>
      ))}
      {shown.length > 1 ? <p className="text-xs text-muted-foreground">{t("announcements.languageHint")}</p> : <p className="text-xs text-muted-foreground">{t("announcements.urlHint")}</p>}
      {audiences && !sent ? (
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="announcement-audience">{t("announcements.audience")}</Label>
            <NativeSelect id="announcement-audience" value={audience} onChange={(event) => setAudience(event.target.value as AnnouncementAudience)} data-testid="announcement-audience">
              {audiences.map((one) => (
                <option key={one} value={one} disabled={(one === "ORGANIZATION" && organizations.length === 0) || (one === "TEAMS" && teams.length === 0)}>
                  {audienceLabel(one)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {audience === "ORGANIZATION" && organizations.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="announcement-organization">{t("announcements.organization")}</Label>
              <NativeSelect id="announcement-organization" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} data-testid="announcement-organization">
                {organizations.map((one) => (
                  <option key={one.id} value={one.id}>
                    {one.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          {audience === "TEAMS" ? (
            <TeamPicker teams={teams} chosen={teamIds} onChange={setTeamIds} filter={filter} onFilter={setFilter} withSubgroups={withSubgroups} onSubgroups={setWithSubgroups} />
          ) : null}
        </div>
      ) : null}
      {preview ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("announcements.preview")}</span>
          <div className="flex gap-2 rounded-md bg-primary/5 px-3 py-2" data-testid="announcement-preview">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{preview.title}</span>
              {preview.body ? <span className="block text-xs text-muted-foreground">{preview.body}</span> : null}
            </span>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !preview || (!!audiences && !sent && audience === "TEAMS" && teamIds.length === 0)} data-testid="announcement-save">
          {busy ? t("announcements.saving") : sent ? t("announcements.saveSent") : t("announcements.save")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("announcements.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** The teams it goes to, found by name; the groups under them too, where there are any. */
function TeamPicker({
  teams,
  chosen,
  onChange,
  filter,
  onFilter,
  withSubgroups,
  onSubgroups,
}: {
  teams: AnnouncementTeam[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  filter: string;
  onFilter: (text: string) => void;
  withSubgroups: boolean;
  onSubgroups: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const parentName = (team: AnnouncementTeam) => teams.find((one) => one.id === team.parentId)?.name;
  const shown = teams.filter((team) => team.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const hasSubgroups = teams.some((team) => team.parentId);
  return (
    <div className="flex w-full flex-col gap-1.5" data-testid="announcement-teams">
      <Label htmlFor="announcement-team-filter">{t("announcements.teams")}</Label>
      {teams.length > 8 ? <Input id="announcement-team-filter" value={filter} placeholder={t("announcements.filterTeams")} onChange={(event) => onFilter(event.target.value)} /> : null}
      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
        {shown.map((team) => (
          <li key={team.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={chosen.includes(team.id)}
                onChange={(event) => onChange(event.target.checked ? [...chosen, team.id] : chosen.filter((id) => id !== team.id))}
                data-testid="announcement-team"
                data-team={team.name}
              />
              <span>
                {team.name}
                {parentName(team) ? <span className="text-xs text-muted-foreground"> · {parentName(team)}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {chosen.length === 0 ? <p className="text-xs text-muted-foreground">{t("announcements.noTeams")}</p> : null}
      {hasSubgroups ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={withSubgroups} onChange={(event) => onSubgroups(event.target.checked)} data-testid="announcement-subgroups" />
          {t("announcements.withSubgroups")}
        </label>
      ) : null}
    </div>
  );
}
