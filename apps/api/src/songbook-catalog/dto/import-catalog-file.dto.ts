import { CatalogFileSchema, ImportCatalogEntriesSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

/** A catalogue file (see docs/songbook-catalog-format.md), sent as text. */
export class CatalogFileDto extends zodDto(CatalogFileSchema) {}

export class ImportCatalogEntriesDto extends zodDto(ImportCatalogEntriesSchema) {}
