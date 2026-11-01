// Writes docs/song-provider-api.json, the Song provider API's OpenAPI 3.1
// description (issue #157), from the schemas in src/song-provider: run
// `pnpm --filter @oneverse/core song-provider-api` after changing them.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { songProviderOpenApi } from "../dist/index.js";

const file = fileURLToPath(new URL("../../../docs/song-provider-api.json", import.meta.url));
writeFileSync(file, `${JSON.stringify(songProviderOpenApi(), null, 2)}\n`);
console.log(`Wrote ${file}`);
