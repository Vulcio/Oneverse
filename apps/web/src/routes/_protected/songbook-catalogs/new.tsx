import type { LanguageCode } from "@oneverse/core";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "#/lib/api-client";
import { LanguageSelect } from "#/components/language-select";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { Textarea } from "@oneverse/ui/components/textarea";

export const Route = createFileRoute("/_protected/songbook-catalogs/new")({
  beforeLoad: ({ context }) => {
    if (!context.session.isGlobalAdmin) {
      throw redirect({ to: "/songbook-catalogs" });
    }
  },
  component: NewSongbookCatalog,
});

function NewSongbookCatalog() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [publisher, setPublisher] = useState("");
  const [isbn, setIsbn] = useState("");
  const [description, setDescription] = useState("");
  const [officialUrl, setOfficialUrl] = useState("");
  const [language, setLanguage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const catalog = await apiClient.createSongbookCatalog({
        name,
        abbreviation: abbreviation.trim() || undefined,
        publisher: publisher.trim() || undefined,
        isbn: isbn.trim() || undefined,
        description: description.trim() || undefined,
        officialUrl: officialUrl.trim() || undefined,
        language: (language.trim() || undefined) as LanguageCode | undefined,
      });
      await navigate({ to: "/songbook-catalogs/$catalogId", params: { catalogId: catalog.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("songbookCatalog.createCatalog")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("songbookCatalog.details")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-name">{t("songbookCatalog.name")}</Label>
            <Input id="catalog-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="JEM" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-abbreviation">{t("songbookCatalog.abbreviation")}</Label>
            <Input
              id="catalog-abbreviation"
              value={abbreviation}
              onChange={(e) => setAbbreviation(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-publisher">{t("songbookCatalog.publisher")}</Label>
            <Input id="catalog-publisher" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-isbn">{t("songbookCatalog.isbn")}</Label>
            <Input id="catalog-isbn" value={isbn} onChange={(e) => setIsbn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-description">{t("songbookCatalog.descriptionLabel")}</Label>
            <Textarea id="catalog-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-official-url">{t("songbookCatalog.officialUrl")}</Label>
            <Input
              id="catalog-official-url"
              value={officialUrl}
              onChange={(e) => setOfficialUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catalog-language">{t("songbookCatalog.language")}</Label>
            <LanguageSelect
              id="catalog-language"
              value={language}
              onChange={setLanguage}
              allowEmpty
              emptyLabel={t("common.noLanguage")}
            />
          </div>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button onClick={() => void submit()} disabled={submitting || !name.trim()}>
        {submitting ? t("songbookCatalog.creating") : t("songbookCatalog.createCatalog")}
      </Button>

      <CreateFromFileCard />
    </div>
  );
}

/** A whole catalogue - details and entries - from a JSON export (see docs/songbook-catalog-format.md). */
function CreateFromFileCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const { catalog } = await apiClient.createSongbookCatalogFromFile({ content: await file.text(), filename: file.name });
      await navigate({ to: "/songbook-catalogs/$catalogId", params: { catalogId: catalog.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("songbookCatalog.createFromFile")}</CardTitle>
        <CardDescription>{t("songbookCatalog.createFromFileHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button variant="outline" className="self-start" disabled={pending} onClick={() => fileInput.current?.click()}>
          {pending ? t("songbookCatalog.creating") : t("songbookCatalog.chooseFile")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          data-testid="catalog-create-file"
          onChange={(event) => {
            void create(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
