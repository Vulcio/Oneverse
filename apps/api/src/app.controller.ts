import { Controller, Get } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { Public } from "./common/decorators/public.decorator.js";
import { latestMigration } from "./common/database-migration.js";
import { serverVersion } from "./common/version.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { RateLimit } from "./security/rate-limit.decorator.js";

/** How long the database's latest migration is remembered: the endpoint is public and unthrottled. */
const MIGRATION_TTL_MS = 60_000;

@Controller()
export class AppController {
  private migration: { name: string | null; at: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public: what's running (issue #164) - its version, the commit when known, and
   * the database's latest migration - so an app or a device can tell whether it
   * fits this server, and an operator what a deploy brought.
   */
  @Public()
  @RateLimit("none")
  @Get("health")
  @ApiExcludeEndpoint()
  async health() {
    if (!this.migration || Date.now() - this.migration.at > MIGRATION_TTL_MS) {
      this.migration = { name: await latestMigration(this.prisma.client), at: Date.now() };
    }
    const { version, commit } = serverVersion();
    return { status: "ok", version, commit, migration: this.migration.name };
  }
}
