import { METADATA_PROVIDER_NAMES, type ArtworkCandidate, type SongVersionDetail } from "@songverse/core";
import { useRouter } from "@tanstack/react-router";
import { ImageIcon, Search, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageCropDialog } from "#/components/image-crop-dialog";
import { SongCover } from "#/components/library-home";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@songverse/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@songverse/ui/components/tooltip";
import { apiClient } from "#/lib/api-client";

/**
 * A song's image (issue #85): the album or single's artwork from Apple
 * Music, kept on Songverse's storage. Found on its own for a new song; its
 * editors find another among Apple Music's matches, upload their own
 * (issue #88), or remove it.
 */
export function ArtworkCard({ version, canEdit }: { version: SongVersionDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<ArtworkCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** A picture chosen to upload, being cropped to a square. */
  const [cropping, setCropping] = useState<File | null>(null);

  const uploadButton = (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
      <Upload />
      {t("artwork.upload")}
    </Button>
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function find() {
    setOpen(true);
    setCandidates(null);
    setError(null);
    apiClient
      .getArtworkCandidates(version.id)
      .then(setCandidates)
      .catch((err: unknown) => {
        setCandidates([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  return (
    <Card data-testid="artwork-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="size-4 text-primary" aria-hidden />
          {t("artwork.title")}
        </CardTitle>
        <CardDescription>{t("artwork.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-start gap-4">
        <div className="w-32 shrink-0">
          <SongCover song={version} size="large" />
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-2">
          {!version.imageUrl ? <p className="text-sm text-muted-foreground">{t("artwork.none")}</p> : null}
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={find} disabled={busy}>
                <Search />
                {t("artwork.find")}
              </Button>
              {uploadButton}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"
                className="hidden"
                data-testid="artwork-upload"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setOpen(false);
                    setCropping(file);
                  }
                  event.target.value = "";
                }}
              />
              {version.imageUrl ? (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => apiClient.clearArtwork(version.id))}>
                  <Trash2 />
                  {t("artwork.remove")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {error && !open ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>

      {cropping ? (
        <ImageCropDialog
          file={cropping}
          maxSize={800}
          shape="rect"
          title={t("artwork.cropTitle")}
          description={t("artwork.cropDescription")}
          saveLabel={t("artwork.saveUpload")}
          testId="artwork-cropper"
          onCancel={() => setCropping(null)}
          onConfirm={async (cropped) => {
            await apiClient.uploadArtwork(version.id, cropped, "artwork.webp");
            setCropping(null);
            await router.invalidate();
          }}
        />
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("artwork.chooseTitle")}</DialogTitle>
            <DialogDescription>{t("artwork.chooseDescription")}</DialogDescription>
          </DialogHeader>
          {candidates === null ? (
            <p className="text-sm text-muted-foreground">{t("artwork.searching")}</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{error ?? t("artwork.noMatches")}</p>
          ) : (
            <ul className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3" data-testid="artwork-candidates">
              {candidates.map((candidate) => {
                const year = candidate.releaseDate?.slice(0, 4);
                return (
                  <li key={candidate.artworkUrl}>
                    <Tooltip>
                      <TooltipTrigger delay={300} render={<button type="button" disabled={busy} className="flex w-full flex-col gap-1 rounded-lg p-1.5 text-left hover:bg-accent disabled:opacity-60" aria-label={t("artwork.use", { album: candidate.album ?? candidate.title })} onClick={() =>
                            void run(() => apiClient.setArtwork(version.id, candidate.artworkUrl)).then((done) => {
                              if (done) setOpen(false);
                            })
                          } />}>
                          <img src={candidate.thumbnailUrl} alt="" loading="lazy" className="aspect-square w-full rounded-md object-cover" />
                          <span className="line-clamp-2 text-sm leading-snug font-medium break-words">{candidate.album ?? candidate.title}</span>
                          <span className="line-clamp-2 text-xs break-words text-muted-foreground">
                            {[candidate.title, candidate.artist, year].filter(Boolean).join(" · ")}
                          </span>
                          {candidate.provider ? <span className="text-xs text-muted-foreground/80">{METADATA_PROVIDER_NAMES[candidate.provider]}</span> : null}
                        </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-64" data-testid="artwork-tooltip">
                        <p className="font-medium">{candidate.album ?? candidate.title}</p>
                        <p>{[candidate.title, candidate.artist, year].filter(Boolean).join(" · ")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <p className="text-sm text-muted-foreground">{t("artwork.notThere")}</p>
            {uploadButton}
          </div>
          {error && candidates && candidates.length > 0 ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
