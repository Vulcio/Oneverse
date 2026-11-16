import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { ErrorReportSchema, pathPattern } from "@oneverse/core";
import { Public } from "../common/decorators/public.decorator.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { reportError } from "./error-reporter.js";

class ErrorReportDto extends zodDto(ErrorReportSchema) {}

/**
 * A web app's error (issue #469), reported by the API with its own DSN when
 * Admin > Error reporting has browsers' errors on; dropped otherwise. Open to
 * pages before sign-in too, on the tighter rate limit; always 204, so a page
 * learns nothing from it.
 */
@Controller("error-reports")
export class ErrorReportsController {
  @Public()
  @RateLimit("heavy")
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  report(@Body() dto: ErrorReportDto): void {
    const path = dto.path ? pathPattern(dto.path) : null;
    void reportError({ type: dto.type, message: dto.message, stack: dto.stack ?? null }, { source: dto.app, where: path, ...(dto.release && { release: dto.release }) }, { browser: true });
  }
}
