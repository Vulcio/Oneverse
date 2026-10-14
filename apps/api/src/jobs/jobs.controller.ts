import { Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import { JobsService } from "./jobs.service.js";

@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/jobs")
@UseGuards(GlobalAdminGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Who runs background jobs, each queue's counts, and the last jobs (issue #92). */
  @Get()
  status() {
    return this.jobs.status();
  }

  /** A scheduled job run now (issue #235): "make-event-sets", "event-reminders" or "clean-up-notifications" (issue #149). */
  @Post("run/:name")
  async runNow(@Param("name") name: string) {
    const queued = await this.jobs.runNow(name);
    if (!queued) throw new NotFoundException("No such scheduled job");
    return queued;
  }

  /** Clears the failed jobs (issue #93), once their errors have been read. */
  @Delete("failed")
  clearFailed() {
    return this.jobs.clearFailed();
  }
}
