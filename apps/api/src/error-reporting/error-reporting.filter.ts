import { Catch, HttpException, type ArgumentsHost } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Request } from "express";
import { reportError } from "./error-reporter.js";

/**
 * Every request's error goes on to Nest's own handling, unchanged; one that
 * isn't an HTTP answer the code chose (a 500: a bug, a database gone) is
 * reported too (issue #469), with its route's pattern - never the address
 * with its ids and query, the body or the headers.
 */
@Catch()
export class ErrorReportingFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === "http" && (!(exception instanceof HttpException) || exception.getStatus() >= 500)) {
      const req = host.switchToHttp().getRequest<Request>();
      const route = (req.route as { path?: string } | undefined)?.path;
      void reportError(exception, { source: "api", where: `${req.method} ${route ? `${req.baseUrl ?? ""}${route}` : "(no route)"}`, tags: { method: req.method } });
    }
    super.catch(exception, host);
  }
}
