import { ApiProperty } from "@nestjs/swagger";
import type { BulkUploadMatchStatus } from "@oneverse/core";

const BULK_UPLOAD_MATCH_STATUSES: BulkUploadMatchStatus[] = ["MATCHED", "UNMATCHED", "DUPLICATE", "IGNORED"];

export class BulkUploadFileMatchDto {
  @ApiProperty() filename!: string;
  @ApiProperty({ required: false, nullable: true }) entryCode!: string | null;
  @ApiProperty({ enum: BULK_UPLOAD_MATCH_STATUSES }) status!: BulkUploadMatchStatus;
  @ApiProperty({ type: String, isArray: true, required: false, description: "DUPLICATE: the other files that claimed the same entry" })
  conflictsWith?: string[];
  @ApiProperty({ enum: ["hidden", "type"], required: false, description: "IGNORED: a system file, or not the kind being uploaded" })
  ignoredBecause?: "hidden" | "type";
}

export class BulkUploadCommitResultDto {
  @ApiProperty({ description: "Number of files queued for background processing" }) queued!: number;
  @ApiProperty({ type: String, isArray: true, description: "Filenames skipped (unmatched or duplicate)" })
  skipped!: string[];
}
