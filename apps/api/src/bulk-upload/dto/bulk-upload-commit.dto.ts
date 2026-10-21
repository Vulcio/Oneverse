import { BulkUploadCommitSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export type { BulkUploadTypeValue } from "@oneverse/core";

export class BulkUploadCommitDto extends zodDto(BulkUploadCommitSchema) {}
