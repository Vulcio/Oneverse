import {
  formatDuration,
  getLanguageDisplayName,
  resolveTranslation,
  METADATA_PROVIDER_NAMES,
  type LocaleValue,
  type MetadataMatch,
  type MetadataProviderKey,
  type SongInfoField,
  type SongInfoProposal,
  type SongInfoValue,
  type SongMatch,
  type SongVersionSongbookMembership,
  type Tag,
} from "@oneverse/core";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Copy, ExternalLink, Library, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSelect } from "#/components/language-select";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@oneverse/ui/components/collapsible";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";
import { cn } from "@oneverse/ui/lib/utils";
import { ChipInput, type ChipSuggestion } from "./chip-input";
import { CAPO_OPTIONS, TIME_SIGNATURE_OPTIONS, type CreditField, type FormError, type SongForm, type TextField } from "./song-form";
import { KeySelect } from "#/components/key-select";
import { NativeSelect } from "@oneverse/ui/components/native-select";


export type FieldErrors = Partial<Record<TextField | "artists", FormError>>;

export function Field({
  id,
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="text-destructive" aria-hidden> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Roles as the autocomplete shows them: "Artist · Composer". */
function useRoleLabels() {
  const { t } = useTranslation();
  return (roles: string[]) => roles.map((role) => t(`songEditor.creditRoles.${role}`, { defaultValue: role })).join(" · ");
}

/** Autocomplete from names already credited on songs you can see. */
export function useCreditSuggest() {
  const roleLabels = useRoleLabels();
  return async (query: string): Promise<ChipSuggestion[]> => {
    const found = await apiClient.searchCredits(query);
    return found.map((credit) => ({ value: credit.name, label: credit.name, detail: roleLabels(credit.roles) }));
  };
}

export function CreditInput({
  field,
  form,
  onChange,
  error,
  required,
  hint,
}: {
  field: CreditField;
  form: SongForm;
  onChange: (values: string[]) => void;
  error?: string | null;
  required?: boolean;
  hint?: string;
}) {
  const { t } = useTranslation();
  const suggest = useCreditSuggest();
  const id = `song-${field}`;
  return (
    <Field id={id} label={t(`songEditor.fields.${field}`)} error={error} hint={hint} required={required}>
      <ChipInput
        id={id}
        values={form[field]}
        onChange={onChange}
        suggest={suggest}
        avatar
        invalid={!!error}
        describedBy={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        placeholder={t(`songEditor.placeholders.${field}`)}
        removeLabel={(name) => t("songEditor.removeName", { name })}
      />
    </Field>
  );
}

export function BasicInfoCard({
  form,
  setField,
  errors,
  titleMatches,
}: {
  form: SongForm;
  setField: <K extends keyof SongForm>(field: K, value: SongForm[K]) => void;
  errors: FieldErrors;
  titleMatches?: ReactNode;
}) {
  const { t } = useTranslation();
  const error = (field: TextField | "artists") => (errors[field] ? t(`songEditor.errors.${errors[field]}`) : null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("songEditor.basicInfo")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field id="song-title" label={t("songEditor.fields.title")} error={error("title")} required>
          <Input
            id="song-title"
            value={form.title}
            onChange={(event) => setField("title", event.target.value)}
            placeholder={t("songEditor.placeholders.title")}
            aria-invalid={!!errors.title || undefined}
            aria-describedby={errors.title ? "song-title-error" : undefined}
            autoComplete="off"
          />
        </Field>
        {titleMatches}
        <CreditInput
          field="artists"
          form={form}
          onChange={(values) => setField("artists", values)}
          error={error("artists")}
          hint={t("songEditor.artistsHint")}
          required
        />
      </CardContent>
    </Card>
  );
}

/** Where a match came from: "MusicBrainz · Apple Music". */
const sourceNames = (match: MetadataMatch) => match.sources.map((source) => METADATA_PROVIDER_NAMES[source.provider]).join(" · ");
const matchKey = (match: MetadataMatch) => match.sources.map((source) => `${source.provider}:${source.id}`).join(",");

function MatchSummary({ match }: { match: MetadataMatch }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-3 text-sm">
      {match.thumbnailUrl ? (
        <img src={match.thumbnailUrl} alt="" className="size-10 shrink-0 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
      ) : null}
      <div className="min-w-0">
        <p className="truncate font-medium">{match.title}</p>
        <p className="truncate text-muted-foreground">
          {[match.artist ?? t("songEditor.unknownArtist"), match.album, match.releaseDate?.slice(0, 4)].filter(Boolean).join(" · ")}
        </p>
        {match.composers?.length ? (
          <p className="truncate text-xs text-muted-foreground">{t("songEditor.writtenBy", { names: match.composers.join(", ") })}</p>
        ) : null}
        <p className="truncate text-xs text-muted-foreground" data-testid="match-sources">
          {sourceNames(match)}
        </p>
      </div>
    </div>
  );
}

/** A field's value as the review shows it: "3:45", "Joel Houston, Matt Crocker". */
function shownValue(field: SongInfoField, value: SongInfoValue): string | null {
  if (value === null || value === false) return null;
  if (Array.isArray(value)) return value.join(", ");
  if (field === "duration" && typeof value === "number") return formatDuration(value);
  return String(value);
}

/**
 * The review step (issue #352): what a chosen match would fill in, field by
 * field - what the song doesn't have ticked, what it has only replaced if
 * ticked. Nothing is used until "Use selected" or "Use all".
 */
export function SongInfoReview({
  match,
  proposals,
  onApply,
  onCancel,
}: {
  match: MetadataMatch;
  proposals: SongInfoProposal[];
  onApply: (fields: Set<SongInfoField>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(() => new Set(proposals.filter((p) => p.fillsEmpty).map((p) => p.field)));
  const label = (field: SongInfoField) => (field === "artwork" ? t("songEditor.artwork") : field === "writers" ? t("songEditor.fields.writers") : t(`songEditor.fields.${field}`));
  const toggle = (field: SongInfoField, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(field);
      else next.delete(field);
      return next;
    });
  return (
    <section className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-3" aria-labelledby="song-info-review-title" data-testid="song-info-review">
      <div className="flex flex-col gap-1">
        <h3 id="song-info-review-title" className="text-sm font-semibold">
          {t("songEditor.infoReview")}
        </h3>
        <MatchSummary match={match} />
      </div>
      {proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("songEditor.infoNothingNew")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("songEditor.infoReviewDescription")}</p>
          <ul className="flex flex-col divide-y rounded-md border bg-background">
            {proposals.map((proposal) => {
              const id = `song-info-${proposal.field}`;
              const now = proposal.field === "artwork" ? (proposal.current ? t("songEditor.infoOwnImage") : null) : shownValue(proposal.field, proposal.current);
              return (
                <li key={proposal.field} className="flex items-start gap-3 p-2.5" data-field={proposal.field}>
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    checked={chosen.has(proposal.field)}
                    onChange={(event) => toggle(proposal.field, event.target.checked)}
                  />
                  <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                    <span className="text-xs font-medium text-muted-foreground">{label(proposal.field)}</span>
                    {proposal.field === "artwork" && match.thumbnailUrl ? (
                      <img src={match.thumbnailUrl} alt="" className="size-12 rounded object-cover" loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="break-words">{shownValue(proposal.field, proposal.proposed)}</span>
                    )}
                    <span className={cn("text-xs", now ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                      {t("songEditor.infoNow", { value: now ?? t("songEditor.infoEmpty") })}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{t("songEditor.infoLinksToo")}</p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => onApply(chosen)}>
          {proposals.length === 0 ? t("songEditor.useThis") : t("songEditor.useSelected")}
        </Button>
        {proposals.length > 0 ? (
          <Button type="button" size="sm" variant="outline" onClick={() => onApply(new Set(proposals.map((p) => p.field)))}>
            {t("songEditor.useAll")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("songEditor.cancel")}
        </Button>
      </div>
    </section>
  );
}

/**
 * "Auto detect": look the song up on the metadata providers (issue #22)
 * and choose a match; its review (issue #352, `review`) says what it fills
 * in. The link itself is saved with the song, and brings its streaming
 * links and, if ticked, its artwork. Adding a song, the search runs by
 * itself once the name has stopped changing (`autoSearch`).
 */
export function AutoDetectCard({
  title,
  artist,
  shown,
  staged,
  onChoose,
  review,
  note,
  autoSearch = false,
}: {
  title: string;
  artist: string | undefined;
  /** The match the song is (or will be) linked to. */
  shown: MetadataMatch | null;
  /** Whether that differs from what's saved. */
  staged: boolean;
  onChoose: (match: MetadataMatch | null) => void;
  /** The chosen match's review, while it's open. */
  review?: ReactNode;
  /** Said under it without hiding the matches: a lookup that failed. */
  note?: ReactNode;
  autoSearch?: boolean;
}) {
  const { t } = useTranslation();
  const [results, setResults] = useState<MetadataMatch[] | null>(null);
  const [unavailable, setUnavailable] = useState<MetadataProviderKey[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [changing, setChanging] = useState(false);
  const [found, setFound] = useState(false);
  // What was last searched for: typing on doesn't search the same again.
  const searched = useRef<string | null>(null);

  async function search(automatic = false) {
    searched.current = `${title.trim().toLowerCase()}|${(artist ?? "").trim().toLowerCase()}`;
    setSearching(true);
    setError(false);
    try {
      const response = await apiClient.searchMetadata(title, artist);
      setResults(response.matches);
      setUnavailable(response.unavailable);
      setFound(automatic);
    } catch {
      // Searched by itself: nothing to say, the button is still there.
      if (!automatic) setError(true);
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!autoSearch || shown || title.trim().length < 3) return;
    const key = `${title.trim().toLowerCase()}|${(artist ?? "").trim().toLowerCase()}`;
    if (searched.current === key) return;
    const timer = setTimeout(() => void search(true), 1200);
    return () => clearTimeout(timer);
  }, [autoSearch, shown, title, artist]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {t("songEditor.autoDetect")}
        </CardTitle>
        <CardDescription>{t("songEditor.autoDetectDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {shown && !changing ? (
          <div className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center">
            <MatchSummary match={shown} />
            <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
              {shown.sources.map((source) => (
                <Button key={source.provider} variant="ghost" size="sm" render={<a href={source.url} target="_blank" rel="noreferrer" />}>
                    <ExternalLink />
                    {METADATA_PROVIDER_NAMES[source.provider]}
                  </Button>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)}>
                {t("songEditor.change")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChoose(null)}>
                {t("songEditor.remove")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void search()} disabled={searching || !title.trim()}>
              {searching ? t("songEditor.searching") : t("songEditor.findSongInfo")}
            </Button>
            {!title.trim() ? <span className="text-xs text-muted-foreground">{t("songEditor.enterTitleFirst")}</span> : null}
            {changing ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(false)}>
                {t("songEditor.cancel")}
              </Button>
            ) : null}
          </div>
        )}
        {staged ? <p className="text-xs text-muted-foreground">{t("songEditor.linkSavedWithSong")}</p> : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {t("songEditor.searchFailed")}
          </p>
        ) : null}
        {results && (!shown || changing) && unavailable.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("songEditor.providersUnavailable", { names: unavailable.map((key) => METADATA_PROVIDER_NAMES[key]).join(", ") })}
          </p>
        ) : null}
        {review}
        {note}
        {results && found && !review && (!shown || changing) && results.length > 0 ? (
          <p className="text-xs text-muted-foreground">{t("songEditor.autoFoundHint")}</p>
        ) : null}
        {results && !review && (!shown || changing) ? (
          results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("songEditor.noOnlineMatches")}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="metadata-matches">
              {results.slice(0, 8).map((match) => (
                <li key={matchKey(match)} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <MatchSummary match={match} />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onChoose(match);
                      setChanging(false);
                    }}
                  >
                    {t("songEditor.useThis")}
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

type MatchVersion = SongMatch["versions"][number];

function versionLabel(version: MatchVersion) {
  return version.versionName ? `${version.title} — ${version.versionName}` : version.title;
}

/**
 * "Match found in your library": songs you can see with the title being
 * added - open one, start from one, or link this one to it as a
 * translation or adaptation (a song of its own, linked to its original).
 */
export function LibraryMatchPanel({
  matches,
  busy,
  onUseAsBase,
  onNewVersion,
  onDismiss,
}: {
  matches: SongMatch[];
  busy: boolean;
  onUseAsBase: (version: MatchVersion) => void;
  onNewVersion: (version: MatchVersion) => void;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  const scope = (version: MatchVersion) =>
    version.ownerScope === "GLOBAL" ? t("songEditor.scopeGlobal") : version.ownerScope === "TEAM" ? version.teamName : t("songEditor.scopePersonal");

  return (
    <section
      aria-labelledby="library-match-title"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
      data-testid="library-match"
    >
      <div className="flex items-start gap-2">
        <Library className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="library-match-title" className="text-sm font-semibold">
            {t("songEditor.matchFound")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("songEditor.matchFoundDescription")}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {t("songEditor.notTheSame")}
        </Button>
      </div>
      {matches.map((match) => {
        const first = match.versions[0]!;
        return (
          <div key={match.workId} className="flex flex-col gap-3 rounded-md border bg-background p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{versionLabel(first)}</p>
                <p className="text-sm text-muted-foreground">
                  {[first.artists.join(", "), first.key ? t("songEditor.summary.key", { key: first.key }) : null, scope(first)].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {match.versions.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded === match.workId}
                    onClick={() => setExpanded(expanded === match.workId ? null : match.workId)}
                  >
                    {t("songEditor.viewVersions", { count: match.versions.length })}
                    <ChevronDown className={cn("transition-transform", expanded === match.workId && "rotate-180")} />
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" render={<Link to="/library/$songVersionId" params={{ songVersionId: first.id }} />}>
                    {t("songEditor.openExisting")}
                  </Button>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onUseAsBase(first)}>
                  {t("songEditor.useAsBase")}
                </Button>
              </div>
            </div>
            {expanded === match.workId ? (
              <ul className="flex flex-col divide-y rounded-md border text-sm">
                {match.versions.map((version) => (
                  <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="font-medium">{versionLabel(version)}</span>{" "}
                      <span className="text-muted-foreground">
                        · {[getLanguageDisplayName(version.language, i18n.language), version.key, scope(version)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Button variant="ghost" size="sm" render={<Link to="/library/$songVersionId" params={{ songVersionId: version.id }} />}>
                          {t("songEditor.open")}
                        </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onUseAsBase(version)}>
                        {t("songEditor.useAsBase")}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="text-sm">{t("songEditor.addNewVersionInstead")}</span>
              <Button type="button" size="sm" disabled={busy} onClick={() => onNewVersion(first)}>
                {t("songEditor.createNewVersion")}
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Short versions of what's filled in, for the collapsed "More details". */
function useSummary(form: SongForm, tagLabel: (id: string) => string): string[] {
  const { t, i18n } = useTranslation();
  const credit = (field: CreditField) => (form[field].length > 0 ? `${t(`songEditor.fields.${field}`)}: ${form[field].join(", ")}` : null);
  return [
    credit("composers"),
    credit("lyricists"),
    credit("writers"),
    form.album.trim() || null,
    form.year.trim() || null,
    form.key ? t("songEditor.summary.key", { key: form.key }) : null,
    form.tempo.trim() ? t("songEditor.summary.tempo", { tempo: form.tempo.trim() }) : null,
    form.timeSignature || null,
    form.capo ? t("songEditor.summary.capo", { capo: form.capo }) : null,
    form.duration.trim() || null,
    form.language ? getLanguageDisplayName(form.language, i18n.language) : null,
    form.ccli.trim() ? `CCLI ${form.ccli.trim()}` : null,
    form.isrc.trim() ? `ISRC ${form.isrc.trim()}` : null,
    form.copyright.trim() || null,
    form.reference.trim() || null,
    ...form.tagIds.map(tagLabel),
    form.notes.trim() ? t("songEditor.summary.notes") : null,
  ].filter((chip): chip is string => !!chip);
}

export function MoreDetailsCard({
  form,
  setField,
  errors,
  tags,
  open,
  onOpenChange,
}: {
  form: SongForm;
  setField: <K extends keyof SongForm>(field: K, value: SongForm[K]) => void;
  errors: FieldErrors;
  tags: Tag[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as LocaleValue;
  const tagLabel = (id: string) => {
    const tag = tags.find((candidate) => candidate.id === id);
    return tag ? resolveTranslation(tag.label, tag.translations, locale) : id;
  };
  const summary = useSummary(form, tagLabel);
  const error = (field: TextField) => (errors[field] ? t(`songEditor.errors.${errors[field]}`) : null);
  const text = (field: TextField, extra: { placeholder?: string; inputMode?: "numeric"; hint?: string } = {}) => (
    <Field id={`song-${field}`} label={t(`songEditor.fields.${field}`)} error={error(field)} hint={extra.hint}>
      <Input
        id={`song-${field}`}
        value={form[field]}
        onChange={(event) => setField(field, event.target.value)}
        placeholder={extra.placeholder}
        inputMode={extra.inputMode}
        aria-invalid={!!errors[field] || undefined}
        aria-describedby={errors[field] ? `song-${field}-error` : extra.hint ? `song-${field}-hint` : undefined}
      />
    </Field>
  );
  const credit = (field: CreditField) => <CreditInput field={field} form={form} onChange={(values) => setField(field, values)} />;
  const hasErrors = (["year", "tempo", "duration", "isrc"] as const).some((field) => errors[field]);

  return (
    <Card>
      <Collapsible open={open || hasErrors} onOpenChange={onOpenChange}>
        <CardHeader>
          <CollapsibleTrigger render={<button type="button" className="-m-2 flex min-w-0 items-center justify-between gap-2 rounded-md p-2 text-left hover:bg-muted/50" />}>
              <span>
                <CardTitle>{t("songEditor.moreDetails")}</CardTitle>
                <CardDescription className="mt-1">{t("songEditor.moreDetailsDescription")}</CardDescription>
              </span>
              <ChevronDown className={cn("size-4 shrink-0 transition-transform", (open || hasErrors) && "rotate-180")} aria-hidden />
            </CollapsibleTrigger>
          {!(open || hasErrors) ? (
            summary.length > 0 ? (
              <ul className="mt-2 flex min-w-0 flex-wrap gap-1.5" aria-label={t("songEditor.moreDetails")} data-testid="details-summary">
                {summary.map((chip, index) => (
                  <li key={`${chip}-${index}`} className="max-w-full truncate rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs">
                    {chip}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{t("songEditor.nothingYet")}</p>
            )
          ) : null}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {credit("composers")}
              {credit("lyricists")}
              {text("album", { placeholder: t("songEditor.placeholders.album") })}
              {text("year", { inputMode: "numeric", placeholder: "2006" })}
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field id="song-key" label={t("songEditor.fields.key")}>
                <KeySelect id="song-key" value={form.key} onChange={(value) => setField("key", value)} className="w-full" />
              </Field>
              {text("tempo", { inputMode: "numeric", placeholder: "72" })}
              <Field id="song-timeSignature" label={t("songEditor.fields.timeSignature")}>
                <NativeSelect
                  id="song-timeSignature"
                  value={form.timeSignature}
                  onChange={(event) => setField("timeSignature", event.target.value)}
                  className="w-full"
                >
                  <option value="">{t("songEditor.none")}</option>
                  {form.timeSignature && !TIME_SIGNATURE_OPTIONS.includes(form.timeSignature) ? (
                    <option value={form.timeSignature}>{form.timeSignature}</option>
                  ) : null}
                  {TIME_SIGNATURE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="song-capo" label={t("songEditor.fields.capo")}>
                <NativeSelect id="song-capo" value={form.capo} onChange={(event) => setField("capo", event.target.value)} className="w-full">
                  <option value="">{t("songEditor.noCapo")}</option>
                  {CAPO_OPTIONS.map((fret) => (
                    <option key={fret} value={fret}>
                      {t("songEditor.fret", { fret })}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {text("duration", { placeholder: "3:45" })}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {text("copyright", { placeholder: "© 2006 Publisher" })}
              <Field id="song-language" label={t("songEditor.fields.language")}>
                <LanguageSelect id="song-language" value={form.language} onChange={(language) => setField("language", language)} />
              </Field>
              {text("ccli", { inputMode: "numeric", placeholder: "4768151" })}
              {text("isrc", { placeholder: "USRC17607839" })}
              {text("alternateTitle", { placeholder: t("songEditor.placeholders.alternateTitle") })}
              {text("sortTitle", { placeholder: t("songEditor.placeholders.sortTitle") })}
              {text("reference", { placeholder: t("songEditor.placeholders.reference") })}
            </div>
            <Field id="song-tags" label={t("songEditor.fields.tags")} hint={t("songEditor.tagsHint")}>
              <ChipInput
                id="song-tags"
                values={form.tagIds}
                onChange={(values) => setField("tagIds", values)}
                labelFor={tagLabel}
                allowCustom={false}
                suggest={(query) => {
                  const q = query.toLowerCase();
                  return tags
                    .map((tag) => ({ value: tag.id, label: resolveTranslation(tag.label, tag.translations, locale) }))
                    .filter((tag) => !q || tag.label.toLowerCase().includes(q))
                    .sort((a, b) => a.label.localeCompare(b.label));
                }}
                placeholder={t("songEditor.placeholders.tags")}
                noMatches={t("songEditor.noMatchingTag")}
                describedBy="song-tags-hint"
                removeLabel={(name) => t("songEditor.removeName", { name })}
              />
            </Field>
            <fieldset className="flex flex-col gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{t("songEditor.otherCredits")}</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(["writers", "arrangers", "translators", "adaptors"] as const).map((field) => (
                  <div key={field}>{credit(field)}</div>
                ))}
              </div>
            </fieldset>
            <Field id="song-notes" label={t("songEditor.fields.notes")}>
              <Textarea id="song-notes" value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={3} />
            </Field>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function SongbooksCard({ memberships, title }: { memberships: SongVersionSongbookMembership[]; title: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  // "Amazing Grace — JEM 855 · JEM3": everything someone without the app needs (issue #55).
  async function copy(membership: SongVersionSongbookMembership) {
    await navigator.clipboard.writeText(`${title} — ${membership.reference}`);
    setCopied(membership.songbookId);
    setTimeout(() => setCopied((current) => (current === membership.songbookId ? null : current)), 2000);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("songEditor.songbooks")}</CardTitle>
      </CardHeader>
      <CardContent>
        {memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("songEditor.inNoSongbook")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {memberships.map((membership) => (
              <li key={membership.songbookId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0" data-testid="songbook-membership">
                <Link to="/songbooks/$songbookId" params={{ songbookId: membership.songbookId }} className="text-sm hover:text-primary">
                  {membership.songbookName}
                </Link>
                {membership.entryCode ? (
                  <span className="flex items-center gap-2">
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium" data-testid="songbook-reference">
                      {membership.reference}
                    </span>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void copy(membership)}>
                      {copied === membership.songbookId ? <Check /> : <Copy />}
                      {copied === membership.songbookId ? t("songEditor.referenceCopied") : t("songEditor.copyReference")}
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
