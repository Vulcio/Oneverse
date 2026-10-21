import {
  BRAND_FONT_ROLES,
  BRAND_LIMITS,
  BRAND_LOGO_KINDS,
  BRAND_SOCIAL_NETWORKS,
  BRAND_STARTER_COLORS,
  brandColorId,
  isAnimatedLogoKind,
  SCREEN_FONT_FAMILIES,
  SCREEN_FONTS,
  type Brand,
  type BrandAsset,
  type BrandAssetKind,
  type BrandColor,
  type BrandFont,
  type BrandFonts,
  type BrandSocial,
  type BrandWhatsAppGroup,
} from "@oneverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { strFromU8, unzipSync } from "fflate";
import { ArrowLeft, ImagePlus, Plus, Star, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@oneverse/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@oneverse/ui/components/card";
import { ConfirmButton } from "@oneverse/ui/components/confirm-button";
import { Input } from "@oneverse/ui/components/input";
import { Label } from "@oneverse/ui/components/label";
import { NativeSelect } from "@oneverse/ui/components/native-select";
import { cn } from "@oneverse/ui/lib/utils";
import { BrandLogo } from "#/components/brand-logo";
import { apiClient } from "#/lib/api-client";

/** What's saved with Save: everything but the files, which go up at once. */
interface Draft {
  name: string;
  colors: BrandColor[];
  fonts: BrandFonts;
  website: string;
  socials: BrandSocial[];
  whatsapp: BrandWhatsAppGroup[];
}

const draftOf = (brand: Brand): Draft => ({ name: brand.name, colors: brand.colors, fonts: brand.fonts, website: brand.website ?? "", socials: brand.socials, whatsapp: brand.whatsapp });

/** The family an uploaded font is drawn with on this page. */
const uploadedFamily = (assetId: string) => `brand-font-${assetId}`;

/**
 * A brand kit (issue #279): its logos in their slots, its colours (each for
 * a light and a dark background), its fonts - built-in or uploaded - its
 * backgrounds, and its links (website, social profiles, WhatsApp groups).
 * Files go up and away at once; the rest is saved with Save. Its owner's
 * admins change it; the others see it.
 */
export function BrandEditor({ initial }: { initial: Brand }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [brand, setBrand] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [saved, setSaved] = useState<Draft>(() => draftOf(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // Changed again: the last refusal no longer stands.
  useEffect(() => setError(null), [draft]);
  const editable = brand.canEdit;
  useUploadedFonts(brand.assets);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    const fresh = await apiClient.getBrand(brand.id);
    setBrand(fresh);
    // Files changed: a removed font leaves the fonts it was, the choices not yet saved stay.
    const fonts = new Set(fresh.assets.filter((asset) => asset.kind === "font").map((asset) => asset.id));
    const kept = (chosen: BrandFonts): BrandFonts => Object.fromEntries(Object.entries(chosen).filter(([, font]) => !(font && "assetId" in font && !fonts.has(font.assetId))));
    setDraft((was) => ({ ...was, fonts: kept(was.fonts) }));
    setSaved((was) => ({ ...was, fonts: fresh.fonts }));
  };
  const save = () =>
    run(async () => {
      const updated = await apiClient.updateBrand(brand.id, { name: draft.name.trim(), colors: draft.colors, fonts: draft.fonts, website: draft.website.trim() || null, socials: draft.socials, whatsapp: draft.whatsapp });
      setBrand(updated);
      setDraft(draftOf(updated));
      setSaved(draftOf(updated));
    });
  const upload = (kind: BrandAssetKind, file: File) =>
    run(async () => {
      // A .lottie file, unpacked to the Lottie JSON the API takes.
      const sent = /\.lottie$/i.test(file.name) ? await dotLottieToJson(file) : file;
      await apiClient.uploadBrandAsset(brand.id, kind, sent, sent.name);
      await refresh();
    });
  const removeAsset = (asset: BrandAsset) =>
    run(async () => {
      await apiClient.deleteBrandAsset(brand.id, asset.id);
      await refresh();
    });

  return (
    <div className="flex flex-col gap-6" data-testid="brand-editor" data-brand={brand.id}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" render={<Link to="/screens" search={{ tab: "brands" }} aria-label={t("brands.back")} />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{brand.name}</h1>
          <p className="text-sm text-muted-foreground">{t(brand.owner.kind === "team" ? "brands.ofTeam" : "brands.ofOrganization", { name: brand.owner.name })}</p>
        </div>
        {brand.isDefault ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs" data-testid="brand-default">
            <Star className="size-3.5" aria-hidden />
            {t("brands.default")}
          </span>
        ) : editable ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => setBrand(await apiClient.updateBrand(brand.id, { isDefault: true })))} data-testid="brand-make-default">
            <Star />
            {t("brands.makeDefault")}
          </Button>
        ) : null}
        {editable ? (
          <Button disabled={busy || !dirty || !draft.name.trim()} onClick={() => void save()} data-testid="brand-save">
            {dirty ? t("brands.save") : t("brands.saved")}
          </Button>
        ) : null}
      </div>
      {!editable ? <p className="text-sm text-muted-foreground">{t("brands.readOnly")}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <fieldset disabled={!editable} className="contents">
        <Section title={t("brands.details")}>
          <div className="flex max-w-md flex-col gap-1.5">
            <Label htmlFor="brand-name">{t("brands.name")}</Label>
            <Input id="brand-name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="brand-name" />
          </div>
        </Section>

        <Section title={t("brands.logos")} description={t("brands.logosHint")}>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="brand-logos">
            {BRAND_LOGO_KINDS.map((kind) => (
              <li key={kind}>
                <LogoSlot kind={kind} asset={brand.assets.find((asset) => asset.kind === kind)} editable={editable} busy={busy} onUpload={(file) => void upload(kind, file)} onRemove={(asset) => void removeAsset(asset)} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t("brands.colors")} description={t("brands.colorsHint")}>
          <ColorsEditor colors={draft.colors} onChange={(colors) => setDraft({ ...draft, colors })} editable={editable} />
        </Section>

        <Section title={t("brands.typography")} description={t("brands.typographyHint")}>
          <FontsEditor fonts={draft.fonts} assets={brand.assets.filter((asset) => asset.kind === "font")} onChange={(fonts) => setDraft({ ...draft, fonts })} editable={editable} busy={busy} onUpload={(file) => void upload("font", file)} onRemove={(asset) => void removeAsset(asset)} />
        </Section>

        <Section title={t("brands.backgrounds")} description={t("brands.backgroundsHint")}>
          <Backgrounds assets={brand.assets.filter((asset) => asset.kind === "background")} editable={editable} busy={busy} onUpload={(file) => void upload("background", file)} onRemove={(asset) => void removeAsset(asset)} />
        </Section>

        <Section title={t("brands.links")} description={t("brands.linksHint")}>
          <LinksEditor draft={draft} onChange={(change) => setDraft({ ...draft, ...change })} editable={editable} />
        </Section>
      </fieldset>

      {editable ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <ConfirmButton
            label={t("brands.delete")}
            confirmLabel={t("brands.confirmDelete")}
            busyLabel={t("brands.deleting")}
            cancelLabel={t("admin.cancel")}
            busy={busy}
            onConfirm={() =>
              run(async () => {
                await apiClient.deleteBrand(brand.id);
                await navigate({ to: "/screens", search: { tab: "brands" } });
              })
            }
          />
          <Button className="ml-auto" disabled={busy || !dirty || !draft.name.trim()} onClick={() => void save()}>
            {dirty ? t("brands.save") : t("brands.saved")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/**
 * A dotLottie file (.lottie, a zip) unpacked to its first animation's JSON
 * (issue #295), its pictures embedded in it: the API takes Lottie as JSON.
 */
async function dotLottieToJson(file: File): Promise<File> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : null);
  const manifest = JSON.parse(text("manifest.json") ?? "{}") as { animations?: { id?: string }[] };
  const id = manifest.animations?.[0]?.id;
  const path = (id && Object.keys(files).find((one) => one === `animations/${id}.json` || one === `a/${id}.json`)) ?? Object.keys(files).find((one) => /^(animations|a)\/[^/]+\.json$/.test(one));
  const json = path ? text(path) : null;
  if (!json) throw new Error("This .lottie file has no animation");
  const animation = JSON.parse(json) as { assets?: { p?: string; u?: string; e?: number }[] };
  // Its pictures, from the archive into the animation.
  for (const asset of animation.assets ?? []) {
    if (!asset.p || asset.p.startsWith("data:")) continue;
    const found = Object.keys(files).find((one) => one.endsWith(`/${asset.p}`));
    if (!found) continue;
    const type = asset.p.toLowerCase().endsWith(".png") ? "image/png" : asset.p.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
    let binary = "";
    for (const byte of files[found]!) binary += String.fromCharCode(byte);
    asset.p = `data:${type};base64,${btoa(binary)}`;
    asset.u = "";
    asset.e = 1;
  }
  return new File([JSON.stringify(animation)], file.name.replace(/\.lottie$/i, "") + ".json", { type: "application/json" });
}

/** A file picker as a button. */
function UploadButton({ accept, label, busy, onFile, testId, variant = "outline" }: { accept: string; label: string; busy: boolean; onFile: (file: File) => void; testId?: string; variant?: "outline" | "ghost" }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
        data-testid={testId ? `${testId}-input` : undefined}
      />
      <Button type="button" size="sm" variant={variant} disabled={busy} onClick={() => input.current?.click()} data-testid={testId}>
        <Upload />
        {label}
      </Button>
    </>
  );
}

/** A background shown as it is: a picture, or a looping video. */
function AssetPreview({ asset, className }: { asset: BrandAsset; className?: string }) {
  return asset.mimeType.startsWith("video/") ? (
    <video src={asset.url} muted autoPlay loop playsInline className={cn("max-h-full max-w-full", className)} />
  ) : (
    <img src={asset.url} alt="" className={cn("max-h-full max-w-full object-contain", className)} />
  );
}

/** A logo's slot: its file on the background it's for, Upload (or Replace) and Remove. */
function LogoSlot({ kind, asset, editable, busy, onUpload, onRemove }: { kind: (typeof BRAND_LOGO_KINDS)[number]; asset: BrandAsset | undefined; editable: boolean; busy: boolean; onUpload: (file: File) => void; onRemove: (asset: BrandAsset) => void }) {
  const { t } = useTranslation();
  const dark = kind.includes("dark");
  const animated = isAnimatedLogoKind(kind);
  return (
    <div className="flex flex-col gap-2" data-testid={`brand-logo-${kind}`} data-filled={asset ? "" : undefined}>
      <div className={cn("flex h-24 items-center justify-center rounded-lg border p-3", dark ? "bg-neutral-950" : "bg-white")}>
        {asset ? <BrandLogo asset={asset} /> : <ImagePlus className={cn("size-6", dark ? "text-neutral-600" : "text-neutral-300")} aria-hidden />}
      </div>
      <p className="text-xs font-medium">{t(`brands.assetKinds.${kind}`)}</p>
      {editable ? (
        <div className="flex flex-wrap gap-1">
          <UploadButton accept={animated ? "video/webm,video/mp4,image/gif,image/webp,image/png,image/apng,image/svg+xml,.svg,.json,.lottie" : "image/svg+xml,.svg,image/png,image/webp,image/jpeg,image/avif"} label={asset ? t("brands.replace") : t("brands.upload")} busy={busy} onFile={onUpload} testId={`brand-upload-${kind}`} />
          {asset ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onRemove(asset)} aria-label={t("brands.remove")} data-testid={`brand-remove-${kind}`}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The colours: each a name, and its colour on a light and a dark background. */
function ColorsEditor({ colors, onChange, editable }: { colors: BrandColor[]; onChange: (colors: BrandColor[]) => void; editable: boolean }) {
  const { t } = useTranslation();
  const change = (index: number, update: Partial<BrandColor>) => onChange(colors.map((one, i) => (i === index ? { ...one, ...update } : one)));
  return (
    <div className="flex flex-col gap-2" data-testid="brand-colors">
      {colors.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{t("brands.noColors")}</p>
          {editable ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onChange(BRAND_STARTER_COLORS.map((one) => ({ ...one, name: t(`brands.colorNames.${one.id}`) })))} data-testid="brand-colors-start">
              {t("brands.startColors")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-3 gap-y-2 text-sm">
          <span className="text-xs text-muted-foreground">{t("brands.colorName")}</span>
          <span className="text-xs text-muted-foreground">{t("brands.onLight")}</span>
          <span className="text-xs text-muted-foreground">{t("brands.onDark")}</span>
          <span />
          {colors.map((color, index) => (
            <div key={color.id} className="contents" data-testid="brand-color">
              <Input value={color.name} maxLength={40} onChange={(e) => change(index, { name: e.target.value })} aria-label={t("brands.colorName")} className="h-8" />
              <ColorSwatch value={color.light} background="#ffffff" onChange={(light) => change(index, { light })} label={t("brands.onLight")} />
              <ColorSwatch value={color.dark} background="#0b0b0f" onChange={(dark) => change(index, { dark })} label={t("brands.onDark")} />
              {editable ? (
                <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => onChange(colors.filter((_, i) => i !== index))} aria-label={t("brands.remove")}>
                  <X />
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
      {editable && colors.length > 0 && colors.length < BRAND_LIMITS.colors ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              const name = t("brands.newColor");
              onChange([...colors, { id: brandColorId(name, colors.map((one) => one.id)), name, light: "#64748b", dark: "#cbd5e1" }]);
            }}
            data-testid="brand-color-add"
          >
            <Plus />
            {t("brands.addColor")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ColorSwatch({ value, background, onChange, label }: { value: string; background: string; onChange: (value: string) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 rounded-md border px-1.5 py-1" style={{ background }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={label} />
      <span className="font-mono text-xs" style={{ color: value }}>
        {value}
      </span>
    </label>
  );
}

const fontValue = (font: BrandFont | null | undefined) => (!font ? "" : "family" in font ? `family:${font.family}` : `asset:${font.assetId}`);
const fontFrom = (value: string): BrandFont | null => (value.startsWith("family:") ? { family: value.slice(7) as (typeof SCREEN_FONTS)[number] } : value.startsWith("asset:") ? { assetId: value.slice(6) } : null);
const fontFamily = (font: BrandFont | null | undefined) => (!font ? undefined : "family" in font ? SCREEN_FONT_FAMILIES[font.family] : `"${uploadedFamily(font.assetId)}", sans-serif`);

/** Its fonts for headings, text and the lyrics: built-in ones or its uploaded fonts, each shown in itself. */
function FontsEditor({ fonts, assets, onChange, editable, busy, onUpload, onRemove }: { fonts: BrandFonts; assets: BrandAsset[]; onChange: (fonts: BrandFonts) => void; editable: boolean; busy: boolean; onUpload: (file: File) => void; onRemove: (asset: BrandAsset) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4" data-testid="brand-fonts">
      <div className="grid gap-3 md:grid-cols-3">
        {BRAND_FONT_ROLES.map((role) => (
          <div key={role} className="flex flex-col gap-1.5">
            <Label htmlFor={`brand-font-${role}`}>{t(`brands.fontRoles.${role}`)}</Label>
            <NativeSelect id={`brand-font-${role}`} value={fontValue(fonts[role])} onChange={(e) => onChange({ ...fonts, [role]: fontFrom(e.target.value) })} data-testid={`brand-font-${role}`}>
              <option value="">{t("brands.fontNone")}</option>
              <optgroup label={t("brands.fontBuiltIn")}>
                {SCREEN_FONTS.map((font) => (
                  <option key={font} value={`family:${font}`}>
                    {t(`screens.editor.fonts.${font}`)}
                  </option>
                ))}
              </optgroup>
              {assets.length ? (
                <optgroup label={t("brands.fontUploaded")}>
                  {assets.map((asset) => (
                    <option key={asset.id} value={`asset:${asset.id}`}>
                      {asset.name ?? asset.filename}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </NativeSelect>
            <p className="truncate text-lg" style={{ fontFamily: fontFamily(fonts[role]) }} data-testid={`brand-font-sample-${role}`}>
              {t("brands.fontSample")}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("brands.fontUploaded")}</p>
        {assets.length === 0 ? <p className="text-sm text-muted-foreground">{t("brands.noFonts")}</p> : null}
        <ul className="flex flex-col gap-1">
          {assets.map((asset) => (
            <li key={asset.id} className="flex items-center gap-2 text-sm" data-testid="brand-font-file">
              <span className="min-w-0 flex-1 truncate" style={{ fontFamily: `"${uploadedFamily(asset.id)}", sans-serif` }}>
                {asset.name ?? asset.filename}
              </span>
              <span className="text-xs text-muted-foreground">{asset.filename}</span>
              {editable ? (
                <Button type="button" size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => onRemove(asset)} aria-label={t("brands.remove")}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable && assets.length < BRAND_LIMITS.fonts ? (
          <div>
            <UploadButton accept=".woff2,.woff,.ttf,.otf" label={t("brands.uploadFont")} busy={busy} onFile={onUpload} testId="brand-upload-font" />
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("brands.fontLicence")}</p>
      </div>
    </div>
  );
}

/**
 * Its uploaded fonts, loaded into the page so they show in themselves: their
 * bytes fetched and handed to the browser as FontFaces, as a screen's theme
 * fonts are (the page's CSP only lets fonts come from the app itself as files).
 */
function useUploadedFonts(assets: BrandAsset[]) {
  const key = assets
    .filter((asset) => asset.kind === "font")
    .map((asset) => `${asset.id} ${asset.url}`)
    .join("|");
  useEffect(() => {
    if (typeof FontFace === "undefined" || !key) return;
    let current = true;
    const faces: FontFace[] = [];
    for (const entry of key.split("|")) {
      const [id, url] = entry.split(" ") as [string, string];
      fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
        .then((bytes) => new FontFace(uploadedFamily(id), bytes).load())
        .then((face) => {
          if (!current) return;
          document.fonts.add(face);
          faces.push(face);
        })
        // One that can't be read shows in the page's font.
        .catch(() => undefined);
    }
    return () => {
      current = false;
      for (const face of faces) document.fonts.delete(face);
    };
  }, [key]);
}

/** Its backgrounds: pictures and videos to offer in templates. */
function Backgrounds({ assets, editable, busy, onUpload, onRemove }: { assets: BrandAsset[]; editable: boolean; busy: boolean; onUpload: (file: File) => void; onRemove: (asset: BrandAsset) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3" data-testid="brand-backgrounds">
      {assets.length === 0 ? <p className="text-sm text-muted-foreground">{t("brands.noBackgrounds")}</p> : null}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {assets.map((asset) => (
          <li key={asset.id} className="flex flex-col gap-1" data-testid="brand-background">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-black">
              <AssetPreview asset={asset} className="size-full object-cover" />
            </div>
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-xs">{asset.name ?? asset.filename}</span>
              {editable ? (
                <Button type="button" size="icon" variant="ghost" className="size-7" disabled={busy} onClick={() => onRemove(asset)} aria-label={t("brands.remove")}>
                  <Trash2 />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {editable && assets.length < BRAND_LIMITS.backgrounds ? (
        <div>
          <UploadButton accept="image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm" label={t("brands.uploadBackground")} busy={busy} onFile={onUpload} testId="brand-upload-background" />
        </div>
      ) : null}
    </div>
  );
}

/** Its website, social profiles and WhatsApp groups. */
function LinksEditor({ draft, onChange, editable }: { draft: Draft; onChange: (change: Partial<Draft>) => void; editable: boolean }) {
  const { t } = useTranslation();
  const social = (index: number, update: Partial<BrandSocial>) => onChange({ socials: draft.socials.map((one, i) => (i === index ? { ...one, ...update } : one)) });
  const group = (index: number, update: Partial<BrandWhatsAppGroup>) => onChange({ whatsapp: draft.whatsapp.map((one, i) => (i === index ? { ...one, ...update } : one)) });
  return (
    <div className="flex flex-col gap-5" data-testid="brand-links">
      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor="brand-website">{t("brands.website")}</Label>
        <Input id="brand-website" type="url" placeholder="https://" value={draft.website} maxLength={500} onChange={(e) => onChange({ website: e.target.value })} data-testid="brand-website" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("brands.socials")}</p>
        {draft.socials.map((one, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2" data-testid="brand-social">
            <NativeSelect value={one.network} onChange={(e) => social(index, { network: e.target.value as BrandSocial["network"] })} aria-label={t("brands.network")} className="w-40">
              {BRAND_SOCIAL_NETWORKS.map((network) => (
                <option key={network} value={network}>
                  {t(`brands.networks.${network}`)}
                </option>
              ))}
            </NativeSelect>
            <Input type="url" placeholder="https://" value={one.url} maxLength={500} onChange={(e) => social(index, { url: e.target.value })} aria-label={t("brands.address")} className="min-w-56 flex-1" />
            {editable ? (
              <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => onChange({ socials: draft.socials.filter((_, i) => i !== index) })} aria-label={t("brands.remove")}>
                <X />
              </Button>
            ) : null}
          </div>
        ))}
        {editable && draft.socials.length < BRAND_LIMITS.socials ? (
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ socials: [...draft.socials, { network: "instagram", url: "" }] })} data-testid="brand-social-add">
              <Plus />
              {t("brands.addSocial")}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("brands.whatsapp")}</p>
        <p className="text-xs text-muted-foreground">{t("brands.whatsappHint")}</p>
        {draft.whatsapp.map((one, index) => (
          <div key={index} className="grid gap-2 rounded-lg border p-2 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)_auto]" data-testid="brand-whatsapp">
            <Input value={one.name} maxLength={80} placeholder={t("brands.groupName")} onChange={(e) => group(index, { name: e.target.value })} aria-label={t("brands.groupName")} />
            <Input type="url" value={one.url} maxLength={500} placeholder="https://chat.whatsapp.com/…" onChange={(e) => group(index, { url: e.target.value })} aria-label={t("brands.groupLink")} />
            <Input value={one.purpose} maxLength={200} placeholder={t("brands.groupPurpose")} onChange={(e) => group(index, { purpose: e.target.value })} aria-label={t("brands.groupPurpose")} />
            {editable ? (
              <Button type="button" size="icon" variant="ghost" className="size-9" onClick={() => onChange({ whatsapp: draft.whatsapp.filter((_, i) => i !== index) })} aria-label={t("brands.remove")}>
                <X />
              </Button>
            ) : null}
          </div>
        ))}
        {editable && draft.whatsapp.length < BRAND_LIMITS.whatsapp ? (
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ whatsapp: [...draft.whatsapp, { name: "", url: "", purpose: "" }] })} data-testid="brand-whatsapp-add">
              <Plus />
              {t("brands.addGroup")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
