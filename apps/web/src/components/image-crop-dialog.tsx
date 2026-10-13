import { useEffect, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@songverse/ui/components/dialog";
import { Label } from "@songverse/ui/components/label";


function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("unreadable image"));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
}

/** Draws the chosen square region at most `maxSize` wide. Browsers apply EXIF orientation when drawing, matching the preview. */
async function cropToSquare(imageUrl: string, area: Area, maxSize: number): Promise<Blob> {
  const image = await loadImage(imageUrl);
  const size = Math.max(1, Math.min(Math.round(area.width), maxSize));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas not supported");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size, size);
  // Browsers without WebP encoding (older Safari) return null or PNG.
  const blob = (await canvasToBlob(canvas, "image/webp")) ?? (await canvasToBlob(canvas, "image/png"));
  if (!blob) throw new Error("Couldn't export the cropped image");
  return blob;
}

interface ImageCropDialogProps {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: Blob) => Promise<void>;
  /** The largest side kept, matching the API's own cap, which re-checks it. */
  maxSize: number;
  /** A round mask for a profile photo; a square one for artwork. */
  shape: "round" | "rect";
  title: string;
  description: string;
  saveLabel: string;
  testId: string;
}

/** Crops a picture to a square before it's uploaded: a profile photo, a song's artwork (issue #88). */
export function ImageCropDialog({ file, onCancel, onConfirm, maxSize, shape, title, description, saveLabel, testId }: ImageCropDialogProps) {
  const { t } = useTranslation();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    let cancelled = false;
    // Checked up front so an undecodable file (e.g. HEIC outside Safari) shows a message instead of an empty cropper.
    loadImage(url).then(
      () => !cancelled && setImageUrl(url),
      () => !cancelled && setError(t("account.avatarUnreadable")),
    );
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file, t]);

  async function confirm() {
    if (!imageUrl || !area) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(await cropToSquare(imageUrl, area, maxSize));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative h-72 overflow-hidden rounded-md bg-muted" data-testid={testId}>
          {imageUrl ? (
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape={shape}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <Label htmlFor={`${testId}-zoom`} className="shrink-0">
            {t("account.zoom")}
          </Label>
          <input
            id={`${testId}-zoom`}
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-primary"
            disabled={!imageUrl}
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {t("account.cancel")}
          </Button>
          <Button onClick={() => void confirm()} disabled={!imageUrl || !area || pending}>
            {pending ? t("account.saving") : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
