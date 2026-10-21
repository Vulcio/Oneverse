import type { BrandAsset } from "@oneverse/core";
import { useEffect, useRef } from "react";
import { cn } from "@oneverse/ui/lib/utils";

/**
 * A brand's logo as it is (issues #279, #295): a picture - an SVG, animated
 * or not, included - a looping video, or a Lottie animation.
 */
export function BrandLogo({ asset, className }: { asset: BrandAsset; className?: string }) {
  if (asset.mimeType === "application/json") return <LottiePlayer url={asset.url} className={className} />;
  if (asset.mimeType.startsWith("video/")) return <video src={asset.url} muted autoPlay loop playsInline className={cn("max-h-full max-w-full", className)} />;
  return <img src={asset.url} alt="" className={cn("max-h-full max-w-full object-contain", className)} />;
}

/**
 * A Lottie animation, looping (issue #295): its JSON fetched and played by
 * lottie-web's light build, which runs no expressions - the page's CSP
 * forbids the eval they'd need. Loaded in the browser only.
 */
function LottiePlayer({ url, className }: { url: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    let stop: (() => void) | null = null;
    void Promise.all([import("lottie-web/build/player/lottie_light"), fetch(url).then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))])
      .then(([module, animationData]) => {
        if (!current || !box.current) return;
        const animation = module.default.loadAnimation({ container: box.current, renderer: "svg", loop: true, autoplay: true, animationData: animationData as object });
        stop = () => animation.destroy();
      })
      // One that can't be read shows nothing.
      .catch(() => undefined);
    return () => {
      current = false;
      stop?.();
    };
  }, [url]);
  return <div ref={box} className={cn("flex size-full items-center justify-center [&>svg]:max-h-full [&>svg]:max-w-full", className)} data-testid="brand-lottie" />;
}
