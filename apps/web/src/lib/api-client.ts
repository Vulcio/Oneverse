import { createAppApiClient } from "@oneverse/app/api-client";
import { markAppDataStale } from "#/lib/app-data-version";

export { apiToken, forgetApiToken } from "@oneverse/app/api-client";

/** Shared instance for calling the NestJS API from web routes/components. */
export const apiClient = createAppApiClient({ onChange: markAppDataStale });
