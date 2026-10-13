import { slugify, type LanguageCode, type SongbookCatalogImportResult } from "@songverse/core";
import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { LanguageSelect } from "#/components/language-select";
import { Button } from "@songverse/ui/components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@songverse/ui/components/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { Textarea } from "@songverse/ui/components/textarea";
import { downloadBlob } from "#/lib/download";
import { CatalogEntriesTable } from "./-catalog-entries-table";
import { CatalogImportDialog } from "./-catalog-import-dialog";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { ConfirmButton } from "#/components/confirm-button";
import { SectionsEditor } from "#/components/sections-editor";

export const Route = createFileRoute("/_protected/songbook-catalogs/$catalogId")({
  // `q` pre-fills the entries search, e.g. from another entry's "Original song" link.
  validateSearch: (search: Record<string, unknown>): { q?: string } => (typeof search.q === "string" && search.q ? { q: search.q } : {}),
  loader: async ({ context, params }) => {
    const catalog = await apiClient.getSongbookCatalog(params.catalogId).catch(() => null);
    if (!catalog) throw redirect({ to: "/songbook-catalogs" });
    return { session: context.session, teams: context.teams, catalog };
  },
  component: SongbookCatalogRoute,
});

// Keyed by catalogue, so following a link to another one (an entry's
// "Original song") starts its form, search and table afresh.
function SongbookCatalogRoute() {
  const { catalog } = Route.useLoaderData();
  return <SongbookCatalogDetail key={catalog.id} />;
}

type Ownership = "personal" | "global" | `team:${string}`;

function SongbookCatalogDetail() {
  const { t, i18n } = useTranslation();
  const { q } = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();
  const { session, teams, catalog } = Route.useLoaderData();
  const canEdit = session.isGlobalAdmin;

  const [importOwnership, setImportOwnership] = useState<Ownership>("personal");
  const [startingImport, setStartingImport] = useState(false);
  const [startImportError, setStartImportError] = useState<string | null>(null);

  const [name, setName] = useState(catalog.name);
  const [abbreviation, setAbbreviation] = useState(catalog.abbreviation ?? "");
  const [publisher, setPublisher] = useState(catalog.publisher ?? "");
  const [isbn, setIsbn] = useState(catalog.isbn ?? "");
  const [description, setDescription] = useState(catalog.description ?? "");
  const [officialUrl, setOfficialUrl] = useState(catalog.officialUrl ?? "");
  const [language, setLanguage] = useState(catalog.language ?? "");
  const [licensed, setLicensed] = useState(catalog.licensed);
  const [sections, setSections] = useState(catalog.sections ?? []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.updateSongbookCatalog(catalog.id, {
        name,
        abbreviation: abbreviation.trim() || undefined,
        publisher: publisher.trim() || undefined,
        isbn: isbn.trim() || undefined,
        description: description.trim() || undefined,
        officialUrl: officialUrl.trim() || undefined,
        language: (language.trim() || undefined) as LanguageCode | undefined,
        licensed,
      });
      await router.invalidate();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await apiClient.deleteSongbookCatalog(catalog.id);
      window.location.href = "/songbook-catalogs";
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  async function startImport() {
    setStartingImport(true);
    setStartImportError(null);
    try {
      const songbook = await apiClient.importSongbookFromCatalog({
        catalogId: catalog.id,
        teamId: importOwnership.startsWith("team:") ? importOwnership.slice(5) : undefined,
        global: importOwnership === "global",
      });
      await navigate({ to: "/songbooks/$songbookId", params: { songbookId: songbook.id } });
    } catch (err) {
      setStartImportError(err instanceof Error ? err.message : String(err));
      setStartingImport(false);
    }
  }

  async function exportAs(format: "csv" | "json") {
    setExportError(null);
    try {
      const blob = await apiClient.exportSongbookCatalog(catalog.id, format);
      downloadBlob(blob, `${slugify(catalog.abbreviation || catalog.name) || "catalog"}.${format}`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onImported(result: SongbookCatalogImportResult) {
    setImportMessage(t("songbookCatalog.imported", { created: result.created, updated: result.updated, deleted: result.deleted }));
    await router.invalidate();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{catalog.name}</h1>
          {catalog.description ? <p className="text-sm text-muted-foreground">{catalog.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <Download />
                {t("songbookCatalog.exportLabel")}
              </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void exportAs("csv")}>{t("songbookCatalog.exportCsv")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportAs("json")}>{t("songbookCatalog.exportJson")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canEdit ? (
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload />
              {t("songbookCatalog.importFile")}
            </Button>
          ) : null}
        </div>
      </div>
      {importMessage ? (
        <p className="text-sm text-muted-foreground" role="status">
          {importMessage}
        </p>
      ) : null}
      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}
      {canEdit ? (
        <CatalogImportDialog catalogId={catalog.id} open={importOpen} onOpenChange={setImportOpen} onImported={onImported} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {t("songbookCatalog.entries")} ({catalog.entries.length.toLocaleString(i18n.language)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CatalogEntriesTable catalogId={catalog.id} entries={catalog.entries} canEdit={canEdit} initialSearch={q ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("songbookCatalog.importIntoSongverse")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("songbookCatalog.importDescription")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              value={importOwnership}
              onChange={(e) => setImportOwnership(e.target.value as Ownership)}
            >
              <option value="personal">{t("songbooks.personal")}</option>
              {teams.map((team) => (
                <option key={team.id} value={`team:${team.id}`}>
                  {team.name}
                </option>
              ))}
              {session.isGlobalAdmin ? <option value="global">{t("songbooks.global")}</option> : null}
            </NativeSelect>
            <Button onClick={() => void startImport()} disabled={startingImport}>
              {startingImport ? t("songbookCatalog.startingImport") : t("songbookCatalog.startImport")}
            </Button>
          </div>
          {startImportError ? <p className="text-sm text-destructive">{startImportError}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("songbookCatalog.details")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-name">{t("songbookCatalog.name")}</Label>
            <Input id="catalog-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-abbreviation">{t("songbookCatalog.abbreviation")}</Label>
            <Input
              id="catalog-abbreviation"
              value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-publisher">{t("songbookCatalog.publisher")}</Label>
            <Input
              id="catalog-publisher"
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-isbn">{t("songbookCatalog.isbn")}</Label>
            <Input id="catalog-isbn" value={isbn} onChange={(e) => setIsbn(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-description">{t("songbookCatalog.descriptionLabel")}</Label>
            <Textarea
              id="catalog-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-official-url">{t("songbookCatalog.officialUrl")}</Label>
            <Input
              id="catalog-official-url"
              value={officialUrl}
              onChange={(e) => setOfficialUrl(e.target.value)}
              disabled={!canEdit}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-language">{t("songbookCatalog.language")}</Label>
            <LanguageSelect
              id="catalog-language"
              value={language}
              onChange={setLanguage}
              disabled={!canEdit}
              allowEmpty
              emptyLabel={t("common.noLanguage")}
            />
          </div>
          {canEdit ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={licensed} onChange={(e) => setLicensed(e.target.checked)} />
              {t("songbookCatalog.licensed")}
            </label>
          ) : catalog.licensed ? (
            <p className="text-sm font-medium text-primary">{t("songbookCatalog.licensed")}</p>
          ) : null}

          {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
          {canEdit ? (
            <div className="flex items-center justify-between">
              <Button onClick={() => void save()} disabled={saving || !name.trim()}>
                {saving ? t("songbookCatalog.saving") : t("songbookCatalog.save")}
              </Button>
              <ConfirmButton
                label={t("songbookCatalog.deleteCatalog")}
                confirmLabel={t("songbookCatalog.confirmDelete")}
                busyLabel={t("songbookCatalog.deleting")}
                cancelLabel={t("songbookCatalog.cancel")}
                busy={deleting}
                onConfirm={remove}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* The printed volumes, copied into songbooks imported from it (issue #55). */}
      <SectionsEditor
        sections={sections}
        canEdit={canEdit}
        description={t("songbookCatalog.sectionsHint")}
        onSave={async (next) => {
          await apiClient.updateSongbookCatalog(catalog.id, { sections: next });
          setSections(next);
        }}
      />
    </div>
  );
}
