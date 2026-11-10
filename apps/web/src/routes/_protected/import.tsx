import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FilePlus2, FileText, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { attachmentTypeFor } from "#/components/song-editor/attachment-types";
import { apiClient } from "#/lib/api-client";
import { formatBytes } from "#/lib/format-bytes";
import { handOver, isChartFile, onLaunchedFiles, takeShared, textAsFile, type Incoming } from "#/lib/incoming";
import { SongPicker } from "#/components/song-picker";
import { FieldError } from "@oneverse/ui/components/field";

/**
 * What another app gave Songverse (issue #407): shared to it from another
 * app's Share menu (Android, ChromeOS: the manifest's `share_target`, kept by
 * the service worker), or a file opened with it on a computer (`file_handlers`).
 * A chart or a PDF makes a new song; any file can go on a song one picks; a
 * Songverse address opens.
 */
export const Route = createFileRoute("/_protected/import")({
  component: ImportPage,
});

function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [incoming, setIncoming] = useState<Incoming | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void takeShared().then((shared) => {
      if (!current) return;
      // A link to one of Songverse's own pages: that page.
      const own = shared && !shared.files.length ? ownPath(shared.url || shared.text.trim()) : null;
      if (own) void navigate({ to: own, replace: true });
      else setIncoming((was) => (was?.files.length ? was : shared));
    });
    onLaunchedFiles((files) => current && setIncoming({ files, title: "", text: "", url: "" }));
    return () => {
      current = false;
    };
  }, [navigate]);

  const words = incoming ? textAsFile({ title: incoming.title, text: [incoming.text, incoming.url].filter(Boolean).join("\n") }) : null;
  const files = incoming ? [...incoming.files, ...(words && incoming.files.length === 0 ? [words] : [])] : [];

  return (
    <div className="flex flex-col gap-6" data-testid="import-page">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("incoming.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("incoming.description")}</p>
      </div>
      {incoming === undefined ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-start gap-3" data-testid="import-nothing">
          <p className="text-sm text-muted-foreground">{t("incoming.nothing")}</p>
          <Button variant="outline" render={<Link to="/library" />}>
            {t("nav.library")}
          </Button>
        </div>
      ) : (
        files.map((file, index) => <IncomingFile key={`${file.name}-${index}`} file={file} />)
      )}
    </div>
  );
}

/** A path in this app, from an address shared to it; null for anywhere else. */
function ownPath(address: string): string | null {
  try {
    const url = new URL(address);
    return url.origin === window.location.origin && url.pathname !== "/import" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

function IncomingFile({ file }: { file: File }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chart = isChartFile(file);

  const newSong = () => {
    handOver(file);
    void navigate({ to: "/library/new" });
  };

  const attachTo = async (songVersionId: string) => {
    setBusy(true);
    setError(null);
    const type = attachmentTypeFor(file);
    try {
      await apiClient.uploadAttachment(songVersionId, type, file);
      void navigate({ to: "/library/$songVersionId", params: { songVersionId }, search: { tab: type === "AUDIO" ? "audio" : "files" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <Card data-testid="import-file">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{file.name}</span>
        </CardTitle>
        <CardDescription>{formatBytes(file.size)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {chart ? (
            <Button type="button" onClick={newSong} data-testid="import-new-song">
              <FilePlus2 />
              {t("incoming.newSong")}
            </Button>
          ) : null}
          <Button type="button" variant={chart ? "outline" : "default"} onClick={() => setPicking((open) => !open)} aria-expanded={picking} data-testid="import-attach">
            <Paperclip />
            {t("incoming.attach")}
          </Button>
        </div>
        {picking ? (
          <SongPicker
            autoFocus
            limit={8}
            placeholder={t("incoming.findSong")}
            empty={t("incoming.noSong")}
            disabled={busy}
            onPick={(song) => void attachTo(song.id)}
            testIds={{ input: "import-song-search", item: "import-song" }}
          />
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
