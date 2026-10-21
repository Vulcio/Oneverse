import { UpdateCatalogSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class UpdateCatalogDto extends zodDto(UpdateCatalogSchema) {}
