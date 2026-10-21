// Deletes the end-to-end suites' users (emails starting "e2e-", plus the
// older "um-"/"ui-" test prefixes) and everything they own, through the
// API's own UserDeletionService so foreign keys are handled as in the app.
// Needs a built API (`pnpm --filter @oneverse/api build`); reads
// apps/api/.env when there is one.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DB } from "./lib/harness.mjs";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/api");
if (existsSync(path.join(apiDir, ".env"))) process.loadEnvFile(path.join(apiDir, ".env"));
process.chdir(apiDir);

const PREFIXES = "^(e2e|um|ui)-";
const ids = execSync(
  `psql ${DB} -tAc ${JSON.stringify(
    `select u.id from "User" u left join "ContentTransfer" t on t."fromUserId" = u.id where u.email ~ '${PREFIXES}' or t."fromEmail" ~ '${PREFIXES}'`,
  )}`,
)
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean);

const load = (file) => import(pathToFileURL(path.join(apiDir, file)).href);
const { NestFactory } = await load("node_modules/@nestjs/core/index.js");
const { AppModule } = await load("dist/app.module.js");
const { UserDeletionService } = await load("dist/user-management/user-deletion.service.js");
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
const deletion = app.get(UserDeletionService);
for (const id of [...new Set(ids)]) await deletion.deleteAccountAndContent(id);
await app.close();
console.log(`purged ${new Set(ids).size} test account(s)`);
process.exit(0);
