# End-to-end suites

API suites (`api/`) call the running API directly; browser suites (`web/`)
drive the running web app with Playwright's Chromium. Every suite signs up
its own users, so they can run against a database that already has data.

## Running them locally

The database needs its migrations and seed applied (`pnpm --filter
@oneverse/db exec prisma migrate deploy`, then `pnpm --filter @oneverse/db
seed`) - some suites use the built-in global tags.

1. Start Postgres and Redis, then the API, the Worker and the web apps, with the API's output
   going to a file - with no email provider configured the API prints the
   emails it would send, and the suites read verification links from there.
   Point the API's song artwork and song info at the suites' stand-ins for
   Apple Music (and its API), MusicBrainz, Deezer, Spotify, YouTube, YouVersion, Wikidata and Wikipedia (`lib/fake-providers.mjs`, which the
   suites that need them start on port 3999):

   ```sh
   export ITUNES_SEARCH_URL=http://localhost:3999 MUSICBRAINZ_API_URL=http://localhost:3999/mb/ws/2/ \
     DEEZER_API_URL=http://localhost:3999/deezer APPLE_MUSIC_API_URL=http://localhost:3999/applemusic \
     WIKIDATA_API_URL=http://localhost:3999/wikidata/w/api.php WIKIPEDIA_URL='http://localhost:3999/wikipedia/{lang}' \
     SPOTIFY_API_URL=http://localhost:3999/spotify SPOTIFY_ACCOUNTS_URL=http://localhost:3999/spotify-accounts \
     YOUTUBE_API_URL=http://localhost:3999/youtube YOUVERSION_API_URL=http://localhost:3999/youversion
   # Push notifications go to a stand-in push service (lib/fake-push.mjs, port 3997) besides the real ones.
   # The Worker reads the notification emails' and pushes' outcomes; the email suites read its log, /tmp/worker.log.
   export PUSH_TEST_ORIGINS=http://localhost:3997
   # Planiverse (issue #241) beside Songverse: the API trusts it, and it opens sets in Songverse.
   export PLANIVERSE_URL=http://localhost:3002 SONGVERSE_URL=http://localhost:3000
   # People sign in at Oneverse (issue #303); the apps send them there.
   export ONEVERSE_URL=http://localhost:3003
   # As in production (#92): the API only adds background jobs, the Worker runs them.
   JOBS_IN_API=false pnpm --filter @oneverse/api dev > /tmp/api-dev.log 2>&1 &
   pnpm --filter @oneverse/api build && (cd apps/api && node dist/worker.js > /tmp/worker.log 2>&1 &)
   pnpm --filter @oneverse/web dev &
   pnpm --filter @oneverse/planiverse dev &
   pnpm --filter @oneverse/oneverse dev &
   ```

2. Run everything, or pick suites:

   ```sh
   pnpm --filter @oneverse/e2e e2e              # all
   pnpm --filter @oneverse/e2e e2e api          # the API suites
   pnpm --filter @oneverse/e2e e2e sets web/share
   ```

The first time, install the browser: `pnpm --filter @oneverse/e2e exec playwright install chromium`.

Screenshots of failed browser steps go to `e2e/.artifacts/`.

## Settings

| Variable | Default |
| --- | --- |
| `E2E_API_URL` | `http://localhost:3001` |
| `E2E_WEB_URL` | `http://localhost:3000` |
| `E2E_PLANIVERSE_URL` | `http://localhost:3002` |
| `E2E_ONEVERSE_URL` | `http://localhost:3003` |
| `E2E_API_LOG` | `/tmp/api-dev.log` |
| `E2E_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/songverse_dev` |

Test users have emails starting with `e2e-`. `node e2e/purge-users.mjs`
deletes them (and what they own) from the database `E2E_DATABASE_URL` points at.

## Writing a suite

Import what you need from `lib/harness.mjs` - `user()` for a signed-up,
verified user with an API token, `call()`/`api()` for API requests,
`check()` for an API assertion, `stepper(() => page)` for browser steps
that screenshot on failure, `signIn()` for the web app's sign-in form - and
end with `finish()`, which sets the exit code. Name the file
`<name>.test.mjs` and `run.mjs` picks it up.

CI runs the suites in six jobs at once (issue #308): `node e2e/run.mjs
--shard 2/6` runs the second part, `--list` shows which suites that is. The
parts are balanced by each suite's duration in `durations.json`, taken from
CI's summary (`PASS  web/sets (42s)`); a new suite counts as an average one
until the file is refreshed: paste every part's summary from a green run
into `node e2e/run.mjs --durations`. Every suite still runs alone against
its own stack and database, so a suite never needs to know which part it's
in, nor count on what another suite left behind.

On a pull request, CI runs only the suites its changes need (issue #315):
`--changed <file>` (the changed paths, one a line) picks them with
`affected.mjs` - a suite file changed runs itself, a path in one of its
`AREAS` runs the suites named after that area, documentation runs none, and
anything else (a shared package, the harness, an area not listed) runs every
suite. `main` always runs every suite. Add an area to `AREAS` once you know
which suites cover it.

## Docs screenshots

`docs/screenshots.mjs` isn't a suite: it takes the screenshots for the user
docs, on a fresh database. See [apps/docs/README.md](../apps/docs/README.md).
