import { BulkUploadPreviewSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class BulkUploadPreviewDto extends zodDto(BulkUploadPreviewSchema) {}
