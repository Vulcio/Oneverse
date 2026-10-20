import "../zod-config.js";
import { z } from "zod";
import { BRAND_ASSET_KINDS, BRAND_LIMITS, BrandColorSchema, BrandFontsSchema, BrandSocialSchema, BrandWhatsAppGroupSchema } from "../brands/index.js";
import { optional } from "./fields.js";

const name = z.string().trim().min(1, "name must not be empty").max(80);
const id = z.string().min(1).max(40);

/** POST /brands (issue #279): a team's brand, or an organisation's - for its admins. */
export const CreateBrandSchema = z
  .strictObject({
    name,
    teamId: optional(id),
    organizationId: optional(id),
  })
  .refine((brand) => !!brand.teamId !== !!brand.organizationId, "A brand belongs to a team or an organisation: give teamId or organizationId");
export type CreateBrandRequest = z.input<typeof CreateBrandSchema>;

/** PATCH /brands/:id: a field left out keeps its value; website null (or "") clears it. */
export const UpdateBrandSchema = z.strictObject({
  name: optional(name),
  /** The one picked first among its owner's; making one the default unsets the others. */
  isDefault: optional(z.boolean()),
  colors: optional(
    z
      .array(BrandColorSchema)
      .max(BRAND_LIMITS.colors)
      .refine((colors) => new Set(colors.map((one) => one.id)).size === colors.length, "colors must have different ids"),
  ),
  fonts: optional(BrandFontsSchema),
  website: z
    .union([z.literal(""), z.string().trim().max(500).regex(/^https?:\/\/\S+$/i, "website must be an address starting with https://")])
    .nullable()
    .optional(),
  socials: optional(z.array(BrandSocialSchema).max(BRAND_LIMITS.socials)),
  whatsapp: optional(z.array(BrandWhatsAppGroupSchema).max(BRAND_LIMITS.whatsapp)),
});
export type UpdateBrandRequest = z.input<typeof UpdateBrandSchema>;

/** GET /brands: one owner's, or (nothing given) every brand the user can use. */
export const BrandsQuerySchema = z.strictObject({
  teamId: optional(id),
  organizationId: optional(id),
});

/** POST /brands/:id/assets (multipart, with `file`): what the file is for, and a background's or a font's name. */
export const UploadBrandAssetSchema = z.strictObject({
  kind: z.enum(BRAND_ASSET_KINDS),
  name: optional(z.string().trim().max(80)),
});
