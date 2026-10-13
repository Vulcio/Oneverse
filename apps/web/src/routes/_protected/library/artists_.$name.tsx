import { METADATA_PROVIDER_NAMES, type ArtistDetail, type MetadataProviderKey } from "@songverse/core";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ChevronLeft, ExternalLink, ImageUp, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArtistPicture } from "#/components/artist-picture";
import { ImageCropDialog } from "@songverse/ui/components/image-crop-dialog";
import { SongCover } from "#/components/library-home";
import { Button } from "@songverse/ui/components/button";
import { Card, CardContent } from "@songverse/ui/components/card";
import { Textarea } from "@songverse/ui/components/textarea";
import { apiClient } from "#/lib/api-client";

/**
 * An artist's page (issue #86): their picture and a short bio (from Deezer
 * and Wikipedia, or uploaded and written by an admin), and their songs you
 * can see. The first visit asks the providers about them.
 */
export const Route = createFileRoute("/_protected/library/artists_/$name")({
  loader: async ({ params }) => {
    const [artist, songs] = await Promise.all([
      apiClient.getArtist(params.name),
      apiClient.listSongVersions({ artist: params.name, sort: "title", pageSize: 24 }),
    ]);
    return { artist, songs };
  },
  component: ArtistPage,
});

function ArtistPage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const loaded = Route.useLoaderData();
  const [artist, setArtist] = useState<ArtistDetail>(loaded.artist);
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [cropping, setCropping] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => setArtist(loaded.artist), [loaded.artist]);

  // Never asked about: ask now, once.
  const asked = useRef(false);
  useEffect(() => {
    if (artist.lookedUp || !artist.lookupsEnabled || asked.current) return;
    asked.current = true;
    setLookingUp(true);
    apiClient
      .lookUpArtist(artist.name)
      .then(setArtist)
      .catch(() => {})
      .finally(() => setLookingUp(false));
  }, [artist]);

  const language = i18n.language.slice(0, 2);
  const bio = artist.bios.find((b) => b.language === language) ?? artist.bios.find((b) => b.language === "en") ?? artist.bios[0] ?? null;
  const ownBio = artist.bios.find((b) => b.language === language && b.custom);

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

  return (
    <div className="flex flex-col gap-6">
      <Link to="/library/artists" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        {t("library.artists")}
      </Link>
      <Card>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start" data-testid="artist-header">
          <ArtistPicture name={artist.name} imageUrl={artist.imageUrl} size="large" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <h1 className="text-2xl font-semibold break-words">{artist.name}</h1>
              <Link to="/library/songs" search={{ artist: artist.name }} className="text-sm text-muted-foreground hover:text-primary">
                {t("library.songCount", { count: artist.songCount })}
              </Link>
            </div>

            {editing ? (
              <div className="flex flex-col gap-2">
                <label htmlFor="artist-bio" className="text-sm font-medium">
                  {t("artistPage.bioIn", { language: t(`artistPage.language_${language === "fr" ? "fr" : "en"}`) })}
                </label>
                <Textarea id="artist-bio" rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} />
                <p className="text-xs text-muted-foreground">{t("artistPage.bioHint")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() => apiClient.saveArtistBio(artist.name, language === "fr" ? "fr" : "en", draft)).then((done) => done && setEditing(false))
                    }
                  >
                    {t("artistPage.saveBio")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                    {t("library.cancel")}
                  </Button>
                </div>
              </div>
            ) : lookingUp ? (
              <p className="text-sm text-muted-foreground">{t("artistPage.lookingUp")}</p>
            ) : bio ? (
              <div className="flex flex-col gap-1.5" data-testid="artist-bio">
                <p className="text-sm leading-relaxed whitespace-pre-line">{bio.text}</p>
                <p className="text-xs text-muted-foreground">
                  {bio.custom ? (
                    t("artistPage.writtenHere")
                  ) : bio.sourceUrl ? (
                    <a href={bio.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                      {t("artistPage.fromWikipedia")}
                      <ExternalLink className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{artist.lookupsEnabled ? t("artistPage.noBio") : t("artistPage.lookupsOff")}</p>
            )}

            {artist.imageSource && artist.imageSource in METADATA_PROVIDER_NAMES && artist.imageSourceUrl ? (
              <p className="text-xs text-muted-foreground">
                <a href={artist.imageSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                  {t("artistPage.pictureFrom", { name: METADATA_PROVIDER_NAMES[artist.imageSource as MetadataProviderKey] })}
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              </p>
            ) : null}

            {artist.canEdit && !editing ? (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                  <ImageUp />
                  {t("artistPage.uploadPicture")}
                </Button>
                {artist.imageUrl ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => apiClient.removeArtistPicture(artist.name))}>
                    <Trash2 />
                    {t("artistPage.removePicture")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setDraft(ownBio?.text ?? (bio?.language === language ? bio.text : ""));
                    setEditing(true);
                  }}
                >
                  <Pencil />
                  {t("artistPage.editBio")}
                </Button>
                {artist.lookupsEnabled ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => setArtist(await apiClient.lookUpArtist(artist.name, true)))}>
                    <RefreshCw />
                    {t("artistPage.lookUpAgain")}
                  </Button>
                ) : null}
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic"
                  className="hidden"
                  data-testid="artist-upload"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) setCropping(file);
                    event.target.value = "";
                  }}
                />
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("artistPage.songs")}</h2>
          {loaded.songs.total > loaded.songs.items.length ? (
            <Link to="/library/songs" search={{ artist: artist.name }} className="text-sm text-primary hover:underline">
              {t("artistPage.allSongs", { count: loaded.songs.total })}
            </Link>
          ) : null}
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-4" data-testid="artist-songs">
          {loaded.songs.items.map((song) => (
            <li key={song.id}>
              <Link to="/library/$songVersionId" params={{ songVersionId: song.id }} className="group flex flex-col gap-1.5 rounded-lg p-1 hover:bg-accent/50">
                <SongCover song={song} />
                <span className="line-clamp-2 text-sm font-medium group-hover:text-primary">{song.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {cropping ? (
        <ImageCropDialog
          file={cropping}
          maxSize={800}
          shape="round"
          title={t("artistPage.cropTitle")}
          description={t("artistPage.cropDescription")}
          saveLabel={t("artistPage.savePicture")}
          testId="artist-cropper"
          onCancel={() => setCropping(null)}
          onConfirm={async (cropped) => {
            await apiClient.uploadArtistPicture(artist.name, cropped);
            setCropping(null);
            await router.invalidate();
          }}
        />
      ) : null}
    </div>
  );
}
