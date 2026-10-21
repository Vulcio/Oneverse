import { SubmitSongSchema, PublishSongSchema, ResubmitSchema, ApproveSubmissionSchema, MergeSubmissionSchema, ReviewNotesSchema, ListSubmissionsQuerySchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SubmitSongDto extends zodDto(SubmitSongSchema) {}

export class PublishSongDto extends zodDto(PublishSongSchema) {}

export class ResubmitDto extends zodDto(ResubmitSchema) {}

export class ApproveSubmissionDto extends zodDto(ApproveSubmissionSchema) {}

export class MergeSubmissionDto extends zodDto(MergeSubmissionSchema) {}

export class ReviewNotesDto extends zodDto(ReviewNotesSchema) {}

export class ListSubmissionsQueryDto extends zodDto(ListSubmissionsQuerySchema) {}
