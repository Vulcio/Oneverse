import { ImportSongbookFromCatalogSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class ImportSongbookFromCatalogDto extends zodDto(ImportSongbookFromCatalogSchema) {}
