import { CreateCatalogSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateCatalogDto extends zodDto(CreateCatalogSchema) {}
