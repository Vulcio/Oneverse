import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { jobsInApi } from "./jobs/jobs.constants.js";
import { startJobs } from "./jobs/start-jobs.js";
import { SyncServer } from "./sync/sync.server.js";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { toNodeHandler } from "better-auth/node";
import { openApiDoc, ZodValidationPipe } from "./common/zod-validation.js";
import compression from "compression";
import type { Express, NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import { getAuth } from "./auth/better-auth.js";
import { registerOAuthClients } from "./auth/oauth-clients.js";
import { webOrigins } from "./common/utils/web-apps.js";
import { apiDocsAllowed } from "./security/security-settings.js";
import { requestMemoMiddleware } from "./common/request-memo.js";

async function bootstrap() {
  // rawBody: a webhook's signature is checked against the bytes it came as (the Demucs API's, issue #63).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Above Express's 100kb default: a songbook catalogue file is imported as
  // JSON text (see ImportCatalogEntriesDto's own 10 MB cap).
  app.useBodyParser("json", { limit: "12mb" });
  // What a reading request asks for more than once, read once (issue #341).
  app.use(requestMemoMiddleware);

  // Registered via `app.enableCors()` rather than `NestFactory.create`'s
  // `cors` option: the option only takes effect once Nest actually
  // initializes (normally deferred until `app.listen()`), which would put
  // it AFTER the raw auth handler mounted below in Express's middleware
  // stack, so every OPTIONS preflight would hit BetterAuth first and 404
  // (better-call has no OPTIONS route). `enableCors()` instead registers
  // the `cors` middleware on the Express instance immediately, so it runs
  // before anything mounted after this line - including the auth handler.
  //
  // Explicit origin + credentials (not the `cors: true` shorthand) -
  // BetterAuth's session cookie is cross-origin (web and API are separate
  // apps/domains), and browsers only send/accept cookies on a cross-origin
  // request when Access-Control-Allow-Origin names the exact origin and
  // Access-Control-Allow-Credentials is true; a wildcard origin can't be
  // combined with credentials at all. Both web apps' (issue #241), named.
  app.enableCors({ origin: webOrigins(), credentials: true });

  // Mounted directly on the underlying Express app rather than as a Nest
  // controller: BetterAuth's handler wants to own the raw request/response
  // itself. It's compatible with Nest's own global body-parser running
  // first regardless of registration order here (better-call's Node
  // adapter falls back to re-serializing an already-parsed `req.body`),
  // and it never passes through JwtAuthGuard/GlobalAdminGuard (those are
  // registered as Nest's APP_GUARD, which only runs for Nest-routed
  // requests) - BetterAuth handles its own endpoint-level authorization.
  //
  // getAuth() is resolved per request, not once at boot: it rebuilds the
  // instance when Admin > Auth settings change (e.g. Google credentials),
  // and a handler bound to the boot-time instance would keep serving the
  // old config until a restart.
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  // Security headers on every answer (issue #112): no framing, no sniffing,
  // no referrer; Express doesn't announce itself.
  expressApp.disable("x-powered-by");
  // Compressed answers (issue #120): JSON and the docs, brotli or gzip as
  // the client takes. Not files - they're served by byte ranges, and audio,
  // images and PDFs are compressed already.
  expressApp.use(
    compression({
      filter: (req, res) => !res.getHeader("Accept-Ranges") && compression.filter(req, res),
    }),
  );
  expressApp.use((_req: unknown, res: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  expressApp.all("/api/auth/*", (req, res, next) => {
    getAuth()
      .then((auth) => toNodeHandler(auth)(req, res))
      .catch(next);
  });

  // Requests are checked against @oneverse/core's zod schemas (issue #118).
  app.useGlobalPipes(new ZodValidationPipe());

  const config = new DocumentBuilder()
    .setTitle("Songverse API")
    .setDescription("Song library, arrangement, and performance API for Songverse.")
    .setVersion("0.1.0")
    // 3.1: nullable fields are type lists ("string" or null), as zod describes them (issue #118).
    .setOpenAPIVersion("3.1.0")
    .addBearerAuth()
    .build();
  // The API's docs (issue #113): for everyone out of production, else for global admins
  // only (their session cookie, which the API's domain shares) - unless Admin > Security says everyone.
  expressApp.use(["/api/docs", "/api/docs-json", "/api/docs-yaml"], (req: Request, res: Response, next: NextFunction) => {
    void apiDocsAllowed(req.headers)
      .then((allowed) => (allowed ? next() : res.status(404).json({ statusCode: 404, message: ["Not Found"] })))
      .catch(next);
  });
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, openApiDoc(document));

  // Sync play's WebSocket (issue #13), on the same port.
  app.get(SyncServer).attach(app.getHttpServer());

  // The web apps as OAuth clients (Sign in with Oneverse, issue #303), from
  // their addresses as this start has them.
  await registerOAuthClients();

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
  console.log(`Songverse API listening on :${port} (docs at /api/docs)`);
  // Background jobs are the Worker's (issue #92); the API runs them too only with JOBS_IN_API (by default, out of production).
  if (jobsInApi()) startJobs(app, "api");
}

void bootstrap();
