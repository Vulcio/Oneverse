import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { BRAND_LIMITS, BRAND_LOGO_KINDS, readBrand, type BrandAssetKind, type BrandFonts, type UpdateBrandRequest } from "@songverse/core";
import type { Prisma } from "@songverse/db";
import type { Request, Response } from "express";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { sendFile } from "../files/send-file.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageQuotaService } from "../storage/storage-quota.service.js";
import { StorageService } from "../storage/storage.service.js";
import { brandAssetType, isValidBrandAssetSignature, presentBrandAssets } from "./brand-assets.js";
import { cleanLottie, sanitizeSvg } from "./brand-files.js";

const ASSET_SELECT = { id: true, kind: true, name: true, storageKey: true, mimeType: true, filename: true, sizeBytes: true } as const;
const BRAND_SELECT = {
  id: true,
  name: true,
  ownerTeamId: true,
  ownerOrganizationId: true,
  isDefault: true,
  colors: true,
  fonts: true,
  website: true,
  socials: true,
  whatsapp: true,
  updatedAt: true,
  team: { select: { name: true } },
  organization: { select: { name: true } },
  assets: { select: ASSET_SELECT, orderBy: { createdAt: "asc" } },
} as const;
type BrandRow = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;

/** What a user may do with brands: the teams and organisations they're in, and those they run. */
interface Scope {
  teams: Set<string>;
  adminTeams: Set<string>;
  organizations: Set<string>;
  adminOrganizations: Set<string>;
}

/**
 * Brand kits (issues #279, #295): an organisation's or a team's logos, colours,
 * fonts, backgrounds and links. Its admins change it; its members, and an
 * organisation's teams' members, use it. Its files are content-addressed in
 * storage like the screen themes': a team's count against the team's pool,
 * an organisation's against whoever uploads them.
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
  ) {}

  /** One owner's brands, or (none given) every brand the user can use: their teams', and their organisations' and their teams' organisations'. */
  async list(user: AuthenticatedUser, owner: { teamId?: string; organizationId?: string } = {}) {
    const scope = await this.scopeOf(user);
    let where: Prisma.BrandWhereInput;
    if (owner.teamId) {
      if (!scope.teams.has(owner.teamId) && !user.isGlobalAdmin) throw new NotFoundException("Team not found");
      where = { ownerTeamId: owner.teamId };
    } else if (owner.organizationId) {
      if (!scope.organizations.has(owner.organizationId) && !user.isGlobalAdmin) throw new NotFoundException("Organisation not found");
      where = { ownerOrganizationId: owner.organizationId };
    } else {
      where = { OR: [{ ownerTeamId: { in: [...scope.teams] } }, { ownerOrganizationId: { in: [...scope.organizations] } }] };
    }
    const brands = await this.prisma.client.brand.findMany({ where, select: BRAND_SELECT, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    return brands.map((brand) => present(brand, this.canEdit(user, scope, brand)));
  }

  async get(user: AuthenticatedUser, brandId: string) {
    const scope = await this.scopeOf(user);
    const brand = await this.prisma.client.brand.findUnique({ where: { id: brandId }, select: BRAND_SELECT });
    if (!brand || !this.canSee(user, scope, brand)) throw new NotFoundException("Brand not found");
    return present(brand, this.canEdit(user, scope, brand));
  }

  async create(user: AuthenticatedUser, data: { name: string; teamId?: string; organizationId?: string }) {
    const scope = await this.scopeOf(user);
    const owner = data.teamId ? { ownerTeamId: data.teamId } : { ownerOrganizationId: data.organizationId! };
    if (!this.canEdit(user, scope, { ownerTeamId: data.teamId ?? null, ownerOrganizationId: data.organizationId ?? null })) {
      throw new ForbiddenException(data.teamId ? "Only the team's admins add brands for it" : "Only the organisation's admins add brands for it");
    }
    // Its owner's first: the default.
    const others = await this.prisma.client.brand.count({ where: owner });
    const brand = await this.prisma.client.brand.create({ data: { name: data.name, ...owner, isDefault: others === 0 }, select: BRAND_SELECT });
    return present(brand, true);
  }

  async update(user: AuthenticatedUser, brandId: string, change: UpdateBrandRequest) {
    const brand = await this.changeable(user, brandId);
    if (change.fonts) await this.assertOwnFonts(brandId, change.fonts);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (change.isDefault) {
        await tx.brand.updateMany({ where: { id: { not: brandId }, ...(brand.ownerTeamId ? { ownerTeamId: brand.ownerTeamId } : { ownerOrganizationId: brand.ownerOrganizationId }) }, data: { isDefault: false } });
      }
      return tx.brand.update({
        where: { id: brandId },
        data: {
          name: change.name ?? undefined,
          isDefault: change.isDefault ?? undefined,
          colors: (change.colors ?? undefined) as Prisma.InputJsonValue | undefined,
          fonts: (change.fonts ?? undefined) as Prisma.InputJsonValue | undefined,
          website: change.website === undefined ? undefined : change.website || null,
          socials: (change.socials ?? undefined) as Prisma.InputJsonValue | undefined,
          whatsapp: (change.whatsapp ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: BRAND_SELECT,
      });
    });
    return present(updated, true);
  }

  async remove(user: AuthenticatedUser, brandId: string): Promise<void> {
    await this.changeable(user, brandId);
    const assets = await this.prisma.client.brandAsset.findMany({ where: { brandId }, select: { storageKey: true } });
    await this.prisma.client.brand.delete({ where: { id: brandId } });
    await this.storage.deleteUnreferenced(assets.map((asset) => asset.storageKey));
  }

  /**
   * A brand's file (issue #279): a logo put in its slot (the one there before
   * goes), a background, or a font. A team's brand's files count against the
   * team's storage pool, an organisation's against the uploader's own.
   */
  async addAsset(user: AuthenticatedUser, brandId: string, kind: BrandAssetKind, name: string | undefined, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }) {
    const brand = await this.changeable(user, brandId);
    const type = brandAssetType(kind, file.mimetype, file.originalname);
    if (!type) {
      throw new BadRequestException(
        kind === "font"
          ? "A font is a WOFF2, WOFF, TTF or OTF file"
          : kind === "background"
            ? "A background is a picture (JPEG, PNG, WebP, AVIF, GIF) or a video (MP4, WebM)"
            : kind.includes("animated")
              ? "An animated logo is a video (WebM, MP4), an animated picture (GIF, WebP, APNG), an animated SVG or a Lottie animation (JSON)"
              : "A logo is a picture (SVG, PNG, WebP, JPEG, AVIF)",
      );
    }
    if (file.size > type.limit) throw new PayloadTooLargeException(`This file is over ${Math.round(type.limit / 1024 / 1024)} MB`);
    // An SVG kept only once cleaned, a Lottie animation once checked (issue #295).
    const bytes = type.check === "svg" ? sanitizeSvg(file.buffer) : type.check === "lottie" ? cleanLottie(file.buffer) : file.buffer;
    if (!bytes) throw new BadRequestException(type.check === "svg" ? "This file isn't an SVG picture" : "This file isn't a Lottie animation");
    const isLogo = (BRAND_LOGO_KINDS as readonly string[]).includes(kind);
    if (!isLogo) {
      const count = await this.prisma.client.brandAsset.count({ where: { brandId, kind } });
      const most = kind === "font" ? BRAND_LIMITS.fonts : BRAND_LIMITS.backgrounds;
      if (count >= most) throw new BadRequestException(kind === "font" ? `A brand holds ${most} fonts at most` : `A brand holds ${most} backgrounds at most`);
    }
    if (brand.ownerTeamId) await this.quota.assertCanStoreForTeam(user.id, brand.ownerTeamId, bytes.length);
    else await this.quota.assertCanStore(user.id, bytes.length);
    const stored = await this.storage.put(bytes, type.mimeType);
    const replaced = isLogo ? await this.prisma.client.brandAsset.findMany({ where: { brandId, kind }, select: { id: true, storageKey: true } }) : [];
    const asset = await this.prisma.client.$transaction(async (tx) => {
      if (replaced.length) await tx.brandAsset.deleteMany({ where: { id: { in: replaced.map((one) => one.id) } } });
      return tx.brandAsset.create({
        data: { brandId, kind, name: isLogo ? null : (name?.trim() || file.originalname.replace(/\.[^.]+$/, "")).slice(0, 80), storageKey: stored.hash, mimeType: type.mimeType, filename: file.originalname.slice(0, 200), sizeBytes: stored.sizeBytes },
        select: ASSET_SELECT,
      });
    });
    await this.storage.deleteUnreferenced(replaced.map((one) => one.storageKey));
    return presentBrandAssets([asset])[0]!;
  }

  /** Removed: a font used by the brand stops being its font. */
  async removeAsset(user: AuthenticatedUser, brandId: string, assetId: string): Promise<void> {
    const brand = await this.changeable(user, brandId);
    const asset = await this.prisma.client.brandAsset.findFirst({ where: { id: assetId, brandId }, select: { storageKey: true, kind: true } });
    if (!asset) throw new NotFoundException("File not found");
    await this.prisma.client.brandAsset.delete({ where: { id: assetId } });
    if (asset.kind === "font") {
      const fonts = readBrand(brand).fonts;
      const kept = Object.fromEntries(Object.entries(fonts).filter(([, font]) => !(font && "assetId" in font && font.assetId === assetId)));
      await this.prisma.client.brand.update({ where: { id: brandId }, data: { fonts: kept as Prisma.InputJsonValue } });
    }
    await this.storage.deleteUnreferenced([asset.storageKey]);
  }

  /** A brand's file at its signed address: for a screen, which has no session. */
  async sendAsset(assetId: string, expires: string | undefined, signature: string | undefined, req: Request, res: Response): Promise<void> {
    const asset = await this.prisma.client.brandAsset.findUnique({ where: { id: assetId }, select: { storageKey: true, mimeType: true, filename: true, sizeBytes: true } });
    if (!asset || !isValidBrandAssetSignature(assetId, asset.storageKey, expires, signature)) throw new ForbiddenException("This address has expired");
    // Its SVGs were cleaned when they came in: shown as pictures (issue #295).
    await sendFile(this.storage, asset, req, res, "inline", { cleanSvg: asset.mimeType === "image/svg+xml" });
  }

  /** Its fonts are built-in ones, or its own uploaded fonts. */
  private async assertOwnFonts(brandId: string, fonts: BrandFonts) {
    const ids = Object.values(fonts).flatMap((font) => (font && "assetId" in font ? [font.assetId] : []));
    if (!ids.length) return;
    const found = await this.prisma.client.brandAsset.count({ where: { brandId, kind: "font", id: { in: ids } } });
    if (found !== new Set(ids).size) throw new BadRequestException("fonts must be built-in fonts or the brand's own uploaded fonts");
  }

  private async changeable(user: AuthenticatedUser, brandId: string) {
    const scope = await this.scopeOf(user);
    const brand = await this.prisma.client.brand.findUnique({ where: { id: brandId }, select: BRAND_SELECT });
    if (!brand || !this.canSee(user, scope, brand)) throw new NotFoundException("Brand not found");
    if (!this.canEdit(user, scope, brand)) throw new ForbiddenException(brand.ownerTeamId ? "Only the team's admins change its brands" : "Only the organisation's admins change its brands");
    return brand;
  }

  private canSee(user: AuthenticatedUser, scope: Scope, brand: { ownerTeamId: string | null; ownerOrganizationId: string | null }) {
    return user.isGlobalAdmin || (brand.ownerTeamId ? scope.teams.has(brand.ownerTeamId) : !!brand.ownerOrganizationId && scope.organizations.has(brand.ownerOrganizationId));
  }

  private canEdit(user: AuthenticatedUser, scope: Scope, brand: { ownerTeamId: string | null; ownerOrganizationId: string | null }) {
    return user.isGlobalAdmin || (brand.ownerTeamId ? scope.adminTeams.has(brand.ownerTeamId) : !!brand.ownerOrganizationId && scope.adminOrganizations.has(brand.ownerOrganizationId));
  }

  /** Their teams and organisations - an organisation also through a team in it - and those they run. */
  private async scopeOf(user: AuthenticatedUser): Promise<Scope> {
    const [teams, organizations] = await Promise.all([
      this.prisma.client.teamMembership.findMany({ where: { userId: user.id }, select: { teamId: true, role: true, team: { select: { organizationId: true } } } }),
      this.prisma.client.organizationMembership.findMany({ where: { userId: user.id }, select: { organizationId: true, role: true } }),
    ]);
    return {
      teams: new Set(teams.map((one) => one.teamId)),
      adminTeams: new Set(teams.filter((one) => one.role === "ADMIN").map((one) => one.teamId)),
      organizations: new Set([...organizations.map((one) => one.organizationId), ...teams.flatMap((one) => (one.team.organizationId ? [one.team.organizationId] : []))]),
      adminOrganizations: new Set(organizations.filter((one) => one.role === "ADMIN").map((one) => one.organizationId)),
    };
  }
}

function present(brand: BrandRow, canEdit: boolean) {
  return {
    id: brand.id,
    name: brand.name,
    owner: brand.ownerTeamId
      ? { kind: "team" as const, id: brand.ownerTeamId, name: brand.team?.name ?? "" }
      : { kind: "organization" as const, id: brand.ownerOrganizationId!, name: brand.organization?.name ?? "" },
    isDefault: brand.isDefault,
    canEdit,
    ...readBrand(brand),
    assets: presentBrandAssets(brand.assets),
    updatedAt: brand.updatedAt.toISOString(),
  };
}
