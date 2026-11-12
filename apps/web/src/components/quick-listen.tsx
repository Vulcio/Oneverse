import { formatDuration, type Attachment } from "@oneverse/core";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Spinner } from "@oneverse/ui/components/spinner";
import { apiClient } from "#/lib/api-client";
import { pauseStems } from "#/lib/stem-engine";
import { pauseYouTube } from "#/lib/youtube-player";

/** What a song's quick listen plays (issue #445): its own recording, else its YouTube video; null: nothing. */
export type ListenSource = { kind: "recording"; attachment: Attachment } | { kind: "youtube"; videoId: string };

/** One thing plays at a time: the stem player and Practice's YouTube player stop for a quick listen. */
function quietOthers() {
  pauseStems();
  pauseYouTube();
}

/**
 * A song's own recording, played in its preview (issue #445): from the
 * start, with Play/Pause and a bar to move through it. Not the stems - the
 * stem player is for practising; this is for hearing what the song is.
 */
export function RecordingListen({ songVersionId, attachment }: { songVersionId: string; attachment: Attachment }) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let live = true;
    quietOthers();
    // A signed address (issue #33): the <audio> streams and seeks by itself.
    apiClient.getAttachmentLink(songVersionId, attachment.id).then(
      (link) => live && setUrl(link.url),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [songVersionId, attachment.id]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      quietOthers();
      void element.play().catch(() => setPlaying(false));
    } else element.pause();
  };

  return (
    <div className="flex items-center gap-2 rounded-md border bg-background/90 px-2 py-1 backdrop-blur" data-testid="quick-listen-recording">
      {url ? (
        <audio
          ref={audio}
          src={url}
          autoPlay
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onError={() => setFailed(true)}
          data-testid="quick-listen-audio"
        />
      ) : null}
      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" disabled={!url || failed} onClick={toggle} aria-label={playing ? t("library.peek.pause") : t("library.peek.play")} data-testid="quick-listen-toggle">
        {!url && !failed ? <Spinner /> : playing ? <Pause /> : <Play />}
      </Button>
      {failed ? (
        <span className="text-xs text-destructive">{t("library.peek.listenFailed")}</span>
      ) : (
        <>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(position, duration || 1)}
            disabled={!duration}
            onChange={(event) => {
              const to = Number(event.target.value);
              if (audio.current) audio.current.currentTime = to;
              setPosition(to);
            }}
            aria-label={t("library.peek.seek")}
            className="h-1 min-w-0 flex-1 accent-primary"
          />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatDuration(position)} / {duration ? formatDuration(duration) : "-:--"}
          </span>
        </>
      )}
    </div>
  );
}

/** The song's YouTube video, in its preview (issue #445): YouTube's own player, which it requires shown. */
export function YouTubeListen({ videoId, title }: { videoId: string; title: string }) {
  useEffect(quietOthers, [videoId]);
  return (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&playsinline=1&rel=0`}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture"
      allowFullScreen
      className="size-full rounded-md border-0 bg-black"
      data-testid="quick-listen-youtube"
    />
  );
}
