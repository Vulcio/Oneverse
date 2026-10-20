import type { Brand, BrandAsset } from "@songverse/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Plus, Star, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@songverse/ui/components/button";
import { Input } from "@songverse/ui/components/input";
import { Label } from "@songverse/ui/components/label";
import { NativeSelect } from "@songverse/ui/components/native-select";
import { cn } from "@songverse/ui/lib/utils";
import { apiClient } from "#/lib/api-client";

/** Who a new brand can be for: a team or an organisation the user runs. */
export type BrandOwnerChoice = { kind: "team" | "organization"; id: string; name: string };

/** A brand's logo for a light or a dark background (issue #279): that side's own, else the main one, else the mark. */
export function brandLogo(assets: BrandAsset[], side: "light" | "dark"): BrandAsset | undefined {
  const kinds = side === "dark" ? ["logo-dark", "logo", "logomark"] : ["logo-light", "logo", "logomark"];
  for (const kind of kinds) {
    const found = assets.find((asset) => asset.kind === kind);
    if (found) return found;
  }
  return undefined;
}

/**
 * Screens > Brands (issue #279): the brands one can use - one's teams' and
 * organisations' - each with its logo and colours, grouped by whose; New
 * brand for a team or an organisation one runs, opened to fill in.
 */
export function BrandsList({ brands, owners }: { brands: Brand[]; owners: BrandOwnerChoice[] }) {
  const { t } = useTranslation();
  const groups = new Map<string, { owner: Brand["owner"]; brands: Brand[] }>();
  for (const brand of brands) {
    const key = `${brand.owner.kind}:${brand.owner.id}`;
    groups.set(key, { owner: brand.owner, brands: [...(groups.get(key)?.brands ?? []), brand] });
  }
  return (
    <div className="flex flex-col gap-6" data-testid="brands">
      {owners.length > 0 ? <NewBrand owners={owners} /> : null}
      {brands.length === 0 ? <p className="text-sm text-muted-foreground">{owners.length ? t("brands.none") : t("brands.noneToMake")}</p> : null}
      {[...groups.values()].map(({ owner, brands: theirs }) => {
        const OwnerIcon = owner.kind === "team" ? Users : Building2;
        return (
          <section key={`${owner.kind}:${owner.id}`} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <OwnerIcon className="size-4 text-muted-foreground" aria-hidden />
              {owner.name}
            </h3>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {theirs.map((brand) => (
                <li key={brand.id}>
                  <BrandTile brand={brand} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BrandTile({ brand }: { brand: Brand }) {
  const { t } = useTranslation();
  const dark = brandLogo(brand.assets, "dark");
  const light = brandLogo(brand.assets, "light");
  return (
    <Link to="/brands/$brandId" params={{ brandId: brand.id }} className="flex flex-col overflow-hidden rounded-xl border bg-card hover:border-primary/50" data-testid={`brand-${brand.name}`}>
      {/* Its logo on a light and on a dark background. */}
      <div className="grid h-24 grid-cols-2">
        <LogoPane asset={light} className="bg-white" />
        <LogoPane asset={dark} className="bg-neutral-950" />
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="flex items-center gap-1.5 font-medium">
          <span className="min-w-0 flex-1 truncate">{brand.name}</span>
          {brand.isDefault ? (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" data-testid="brand-default">
              <Star className="size-3" aria-hidden />
              {t("brands.default")}
            </span>
          ) : null}
        </p>
        {brand.colors.length ? (
          <div className="flex gap-1" aria-label={t("brands.colors")}>
            {brand.colors.slice(0, 10).map((color) => (
              <span key={color.id} className="size-5 rounded-full border" style={{ background: color.light }} title={color.name} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("brands.noColors")}</p>
        )}
      </div>
    </Link>
  );
}

function LogoPane({ asset, className }: { asset: BrandAsset | undefined; className: string }) {
  return (
    <div className={cn("flex items-center justify-center p-3", className)}>
      {asset ? asset.mimeType.startsWith("video/") ? <video src={asset.url} muted autoPlay loop playsInline className="max-h-full max-w-full" /> : <img src={asset.url} alt="" className="max-h-full max-w-full object-contain" /> : null}
    </div>
  );
}

/** New brand: its name and whose, then opened to fill in. */
function NewBrand({ owners }: { owners: BrandOwnerChoice[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(`${owners[0]!.kind}:${owners[0]!.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [kind, id] = owner.split(":") as ["team" | "organization", string];
      const brand = await apiClient.createBrand({ name: name.trim(), ...(kind === "team" ? { teamId: id } : { organizationId: id }) });
      await navigate({ to: "/brands/$brandId", params: { brandId: brand.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)} data-testid="brand-new">
          <Plus />
          {t("brands.new")}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" data-testid="brand-new-form">
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label htmlFor="brand-new-name">{t("brands.name")}</Label>
        <Input id="brand-new-name" value={name} maxLength={80} required autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex min-w-48 flex-col gap-1.5">
        <Label htmlFor="brand-new-owner">{t("brands.owner")}</Label>
        <NativeSelect id="brand-new-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
          {owners.map((one) => (
            <option key={`${one.kind}:${one.id}`} value={`${one.kind}:${one.id}`}>
              {one.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={busy || !name.trim()} data-testid="brand-create">
        {t("brands.create")}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        {t("admin.cancel")}
      </Button>
      {error ? (
        <p className="w-full text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
