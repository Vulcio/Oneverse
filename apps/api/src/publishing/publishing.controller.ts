import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import {
  ApproveSubmissionDto,
  ListSubmissionsQueryDto,
  MergeSubmissionDto,
  PublishSongDto,
  ResubmitDto,
  ReviewNotesDto,
  SubmitSongDto,
} from "./dto/publishing.dto.js";
import { PublishingService } from "./publishing.service.js";

/** Submitting a song to the global catalogue, from its page. */
@ApiTags("publishing")
@ApiBearerAuth()
@Controller("song-versions/:songVersionId")
export class SongPublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Get("publication")
  status(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string) {
    return this.publishing.status(user, songVersionId);
  }

  @Post("submissions")
  submit(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Body() dto: SubmitSongDto) {
    return this.publishing.submit(user, songVersionId, dto);
  }

  /** Global admins only: into the catalogue straight away. */
  @Post("publish")
  publish(@SignedIn() user: AuthenticatedUser, @Param("songVersionId") songVersionId: string, @Body() dto: PublishSongDto) {
    return this.publishing.publishDirectly(user, songVersionId, dto);
  }
}

/** The review queue, and what submitters and reviewers do with a submission. */
@ApiTags("publishing")
@ApiBearerAuth()
@Controller("submissions")
export class SubmissionsController {
  constructor(private readonly publishing: PublishingService) {}

  /** Reviewers and global admins. */
  @Get()
  list(@SignedIn() user: AuthenticatedUser, @Query() query: ListSubmissionsQueryDto) {
    return this.publishing.list(user, query.state ?? "open");
  }

  @Get("mine")
  mine(@SignedIn() user: AuthenticatedUser) {
    return this.publishing.mine(user);
  }

  @Get(":submissionId")
  findOne(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string) {
    return this.publishing.findOne(user, submissionId);
  }

  @Post(":submissionId/withdraw")
  withdraw(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string) {
    return this.publishing.withdraw(user, submissionId);
  }

  @Post(":submissionId/resubmit")
  resubmit(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string, @Body() dto: ResubmitDto) {
    return this.publishing.resubmit(user, submissionId, dto);
  }

  @Post(":submissionId/start-review")
  startReview(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string) {
    return this.publishing.startReview(user, submissionId);
  }

  @Post(":submissionId/approve")
  approve(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string, @Body() dto: ApproveSubmissionDto) {
    return this.publishing.approve(user, submissionId, dto);
  }

  @Post(":submissionId/merge")
  merge(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string, @Body() dto: MergeSubmissionDto) {
    return this.publishing.merge(user, submissionId, dto);
  }

  @Post(":submissionId/request-changes")
  requestChanges(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string, @Body() dto: ReviewNotesDto) {
    return this.publishing.requestChanges(user, submissionId, dto.notes);
  }

  @Post(":submissionId/reject")
  reject(@SignedIn() user: AuthenticatedUser, @Param("submissionId") submissionId: string, @Body() dto: ReviewNotesDto) {
    return this.publishing.reject(user, submissionId, dto.notes);
  }
}
