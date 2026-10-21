# Deploying Oneverse

This documents the working deployment of this repository (Oneverse: the shared API and Worker, Songverse, Planiverse, the docs and the website) to a self-hosted [Dokploy](https://dokploy.com) instance, with a domain for each app (#303): Oneverse, where people sign in, at `oneverse.top` and the API at `api.oneverse.top`; Songverse at `songverse.top`; Planiverse (the planning on its own, #241) at `planiverse.top` if you deploy it; the docs at `docs.oneverse.top`, and Songverse's website at `songverse.one` (#43). Before #303 everything was under `songverse.one` (the app at `app.songverse.one`, the API at `api.songverse.one`). Follow this in order if you're setting it up from scratch, or use it as a reference if something needs fixing later.

## Architecture

Eight things get created in Dokploy, all in one Project (nine with Planiverse):

| Resource | Type | Built from | Notes |
|---|---|---|---|
| Postgres | Database | Dokploy's built-in template | Shared by the API and the Worker |
| Redis | Database | Dokploy's built-in template | Backs the background jobs' queues (BullMQ), the Worker's heartbeat, and rate limits shared by the API and the Worker |
| API | Application | `Dockerfile.api` | Serves the NestJS API (Oneverse's, for every app), listens on port 3001 |
| Worker | Application | `Dockerfile.api` (same as API) | Same image as API, different start command — runs the background jobs |
| Oneverse | Application | `Dockerfile.oneverse` | Where people sign in, and their account (#303): the apps send them there, listens on port 3000 |
| Songverse | Application | `Dockerfile.songverse` | Songverse's web app (TanStack Start), listens on port 3000 |
| Planiverse | Application | `Dockerfile.planiverse` | Optional (#241): the planning on its own, same accounts and API, listens on port 3000 |
| Docs | Application | `Dockerfile.docs` | The user documentation, a static site on port 80 |
| Site | Application | `Dockerfile.site` | The website at the root domain, a static page on port 80 |

The API and Worker share one Docker image because they're the same codebase — only the command that starts the container differs.

**What the Worker does** (#92): it runs every background job - bulk songbook uploads, recorded takes turned into Opus with ffmpeg (#127: `Dockerfile.api` installs it; running the Worker elsewhere, install ffmpeg there or takes stay WAV), the hourly clean-up of expired account transfers, and lookups (a new song's artwork, new artists' pictures and bios, the backfills started from Admin > Metadata). The API only adds jobs to the queues; with no Worker running they wait, so songs get no artwork and uploads aren't processed. Admin > Metadata > **Background jobs** shows whether a Worker is running (from a heartbeat it keeps in Redis), each queue's jobs and the last ones' results. For a small setup without a Worker, set `JOBS_IN_API=true` on the API and it runs the jobs itself (it does by default outside production, for `pnpm dev`).

## 1. DNS

Using deSEC.io (or any DNS host with similar record types):

For each domain (`oneverse.top`, `songverse.top`, `planiverse.top`, `songverse.one`):

- **A record**, subname `@` (apex/root) → your server's IP
- **A record**, subname `*` (wildcard) → your server's IP

That covers each domain and every subdomain (`api.oneverse.top`, `docs.oneverse.top`, etc.) with two records per domain.

Verify it resolves before touching Dokploy — cert issuance fails silently if DNS hasn't propagated:
```
dig +short oneverse.top
dig +short api.oneverse.top
dig +short songverse.top
dig +short planiverse.top
dig +short songverse.one
```
Each should print your server's IP.

## 2. Dokploy setup

Create a **Project** to hold everything, then add these five resources.

### Postgres

**Database** → **Postgres**. Set a name and password, deploy it, and copy the connection string it gives you — that's your `DATABASE_URL` for the next three steps.

### Redis

**Database** → **Redis**. Copy its connection string too — that's `REDIS_URL`.

### API app

**Application**, configured as:
- Source: this repo, branch `main`
- Build type: **Dockerfile**
- Dockerfile path: `Dockerfile.api`
- Build context / base directory: `.` (repo root) — see [Gotcha #1](#1-docker-build-context) if this matters to you
- Port: `3001`
- Domain: `api.oneverse.top`
- Watch paths (if you use auto-deploy): `apps/api/**`, `packages/core/**`, `packages/db/**`, `packages/secret-crypto/**`, `packages/tsconfig/**`, `Dockerfile.api`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**` - see [Watch paths](#watch-paths)

Environment variables:
```
DATABASE_URL=<Postgres connection string>
REDIS_URL=<Redis connection string>
PORT=3001

# BetterAuth lives here now (apps/api/src/auth/) - see below.
AUTH_URL=https://api.oneverse.top
WEB_URL=https://songverse.top
# Where people sign in (#303) - see below.
ONEVERSE_URL=https://oneverse.top
# Only with Planiverse deployed (#241): trusted like WEB_URL - see below.
PLANIVERSE_URL=https://planiverse.top
BETTER_AUTH_SECRET=<generate one — see below>
BOOTSTRAP_ADMIN_EMAILS=<comma-separated emails to auto-promote on sign-up>

SETTINGS_ENCRYPTION_KEY=<any long random string>

# Transactional email (verification + password reset) — fallback only,
# prefer Admin > Auth once the app is up. See below.
RESEND_API_KEY=<Resend API key>
EMAIL_FROM=Songverse <onboarding@resend.dev>

# Google sign-in — optional, also configurable via Admin > Auth. See below.
GOOGLE_CLIENT_ID=<Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
```

**`AUTH_URL` vs `WEB_URL` vs `API_URL`, since it's easy to mix up:** `AUTH_URL` is this **API's own address** (BetterAuth is mounted here — see `apps/api/src/auth/`). `WEB_URL` is **Songverse's** address — needed here because it's an OAuth client the API registers, at `WEB_URL/auth/callback`, and because notifications link to it. `ONEVERSE_URL` is where people sign in (below). `API_URL` (set on the web apps only, below) is this same API's address again, from the web app's point of view, for its ordinary (non-auth) data calls.

**`ONEVERSE_URL`** (#303, `docs/sign-in-with-oneverse.md`) is the Oneverse app's address (see "Oneverse app" below): people sign in, sign up and manage their account (email, password, passkeys) there, and Songverse and Planiverse are OAuth clients of this API that send them there and keep sessions of their own. The API registers them as clients when it starts, with `WEB_URL` and `PLANIVERSE_URL` as their addresses (`<address>/auth/callback`), so both must be the apps' exact public addresses. Only Oneverse and the API then share a cookie, so `ONEVERSE_URL` must share a parent domain with `AUTH_URL` (`oneverse.top` and `api.oneverse.top`), and the apps may be on any domain (`songverse.top`, `planiverse.top`). Unset, people sign in on Songverse's own page, which no longer exists once the apps are this version: set it.

**`PLANIVERSE_URL`** (#241) is Planiverse's address, when it's deployed (see "Planiverse app" below): the API trusts it as it trusts `WEB_URL` - for its sign-ins and CORS - and sends notifications about planning-only groups and organisations' events there (their emails link to it; their pushes go to the devices turned on in Planiverse). Unset, there's no Planiverse and everything goes to Songverse. Admin > Organisations shows it.

**Generating `BETTER_AUTH_SECRET`:**
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Keep this stable once set — BetterAuth encrypts its signing key with it in the database, so changing the secret without clearing the `Jwks` table breaks login for everyone until you do.

**`RESEND_API_KEY` / `EMAIL_FROM`:** email addresses now have to be verified before sign-in works (`emailAndPassword.requireEmailVerification` in `apps/api/src/auth/better-auth.ts`), and "forgot password" sends a reset link — both go out through [Resend](https://resend.com). Sign up for a free account, verify a sending domain (or use their shared `onboarding@resend.dev` sender for testing), and create an API key. The env vars here are a fallback: once the app is up, sign in as a global admin and set this at **Admin > Auth** instead — it takes effect immediately, no redeploy needed. Whichever path is used, if no Resend API key is configured at all, emails are logged to the container's stdout instead of sent — fine for local dev, **not fine in production** (nobody can verify their account). The app only ever sends account emails (verification, password reset, and the two-step email change from the account page), never bulk/marketing mail, specifically to stay inside the free tier's daily/monthly send cap — don't add new call sites to `apps/api/src/auth/email.ts` without keeping that in mind.

**`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`:** optional, and also settable at **Admin > Auth** instead of these env vars. Leave both unset everywhere to keep email+password (and passkeys) as the only sign-in methods — the "Continue with Google" button only renders once either path is configured. To enable it, create an OAuth 2.0 Client ID at the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) with an authorized redirect URI of `<AUTH_URL>/api/auth/callback/google` (e.g. `https://api.oneverse.top/api/auth/callback/google`).

**Passkeys** (`@better-auth/passkey`) need no extra configuration. They're added and used at Oneverse; their relying-party ID is the parent domain `AUTH_URL` and `ONEVERSE_URL` share (`oneverse.top`, see `apps/api/src/auth/auth-domains.ts`), not Oneverse's own hostname. A passkey works only for the ID it was made for, so the passkeys made before #303 are removed by its migration, and everyone adds theirs again at Oneverse. Moving Oneverse and the API to another domain later does the same: remove them (`DELETE FROM "Passkey"`), as they no longer work.

**The session cookie is cross-subdomain by design** (`advanced.crossSubDomainCookies` in `better-auth.ts`): Oneverse (`oneverse.top`) and this API (`api.oneverse.top`) are different origins but the same *site* (same registrable domain), so a cookie scoped to `oneverse.top` reaches both. That parent domain is derived automatically from `AUTH_URL` and `ONEVERSE_URL` (their shared suffix; `WEB_URL` and `PLANIVERSE_URL` instead, without Oneverse), so they must be subdomains of one domain you own — the API refuses to start otherwise. The apps don't use it: each keeps its tokens in a cookie of its own (`oneverse_session_songverse`, `…_planiverse`), on its own domain. Two subdomains of a shared hosting domain (e.g. two different `*.up.railway.app` hosts) won't work either: browsers refuse cookies scoped to a public suffix. This is also why the API's CORS config (`main.ts`) names the web app's exact origin with `credentials: true` rather than using a wildcard — browsers refuse to combine a wildcard `Access-Control-Allow-Origin` with credentialed (cookie-bearing) requests.

**Rate limits and the API docs** (issue #113) are set at **Admin > Security**; these optional env vars are the fallback: `RATE_LIMIT_ENABLED` (default `true` in production), `RATE_LIMIT_PER_MINUTE` (per signed-in user, default 600), `RATE_LIMIT_ANONYMOUS_PER_MINUTE` (per address before sign-in, default 120), `RATE_LIMIT_HEAVY_PER_MINUTE` (uploads, lookups and joins by link, default 30), `TRUSTED_PROXIES` (proxies in front of the API whose `X-Forwarded-For` is trusted; default 1 in production - Traefik) `API_DOCS_PUBLIC` (default `false` in production: `/api/docs` for global admins only) and `CONTENT_SECURITY_POLICY` (`enforce`, `report-only` or `off`, default `enforce`: the web app's Content-Security-Policy, issue #114 - the web server asks the API for it every 15 seconds, and reports what it refuses to its own log as `CSP: …`). The counts live in Redis, so they hold across the API's instances.

**Sign-up by invitation only** (issue #198) is switched on at **Admin > Users** (under **Sign-up and invitations**); `SIGNUP_INVITE_ONLY=true` is the fallback (default `false`: anyone can sign up). The `BOOTSTRAP_ADMIN_EMAILS` can always sign up, so a new server can't lock its admins out.

**Notifications by email** (issue #236) are switched on at **Admin > Notifications**; `NOTIFICATION_EMAILS=true` is the fallback (default `false`: notifications only show in the app). They're sent by the Worker, through the same Resend key as account mail, one email per person per batch; the links in them point at `WEB_URL` as the API knows it, since the Worker may run without it.

**Organisations** (issue #241, Planiverse) are set at **Admin > Organisations**; `ORGANIZATION_MODE` is the fallback: `NONE` (the default: Songverse on its own), `SINGLE` (one organisation, everyone who signs in is in it - a church hosting its own server) or `MULTI` (several, each kept apart - a hosted service), and with several, `ORGANIZATIONS_OPEN=true` lets anyone create one (default `false`: global admins only).

**Push notifications** (web push, issue #236) are set up at **Admin > Notifications** (**Generate keys**); `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (generate a pair with `npx web-push generate-vapid-keys`) and `VAPID_SUBJECT` (`mailto:` or `https:`, default the web app's https address) are the fallback. The Worker posts to the browsers' push services (fcm.googleapis.com, push.services.mozilla.com, push.apple.com, notify.windows.com) over HTTPS, so it needs outbound access to them; no other address is accepted for a device. `PUSH_TEST_ORIGINS` lets the end-to-end suites use a stand-in push service - never set it in production.

**Stem separation** (issue #63) is set up at **Admin > Stem separation**, and given to people and teams through the **Stem separation** role (**Admin > Roles**, issue #160); these optional env vars are the fallback: `DEMUCS_API_URL` and `DEMUCS_API_KEY` (the Demucs API and its `X-API-Key`; without both, it isn't offered), `DEMUCS_FAST_MODEL` (default `htdemucs`), `DEMUCS_HQ_ENABLED` (default `true`: a finer pass later replaces the quick stems), `DEMUCS_HQ_MODEL` (default `htdemucs_ft`), `STEM_SEPARATION_MONTHLY_LIMIT` (per person in 30 days, default none) and `DEMUCS_CALLBACK_SECRET` (signs the server's webhooks; generated and kept in the database when not set). The Worker sends recordings and brings stems in; the Demucs server calls `${AUTH_URL}/stem-separation/callback` when they're ready, so it must be able to reach the API - if it can't, the Worker checks every 2 minutes. The instance's own server is optional: teams and organisations can connect their own Songverse Sonic servers (issue #300) when **Admin > Stem separation** allows it, or `STEM_SEPARATION_OWN_SERVERS=true`; their addresses must be public and https:// unless `STEM_SEPARATION_OWN_SERVERS_PRIVATE=true` (or the Admin switch) allows private and local ones. Their keys are kept encrypted, so `SETTINGS_ENCRYPTION_KEY` must be set. Their webhooks come to `${AUTH_URL}/stem-separation/callback/<server>`.

**Object storage (R2) has two setup paths** — pick one:

1. **Preferred: Admin > Storage** (in the web app, once it's up). Enter the
   account ID, access key ID, secret access key, and bucket there; it's
   saved in the database (secret access key encrypted with
   `SETTINGS_ENCRYPTION_KEY`) and takes effect immediately, no redeploy or
   env var needed. This requires `SETTINGS_ENCRYPTION_KEY` to be set on
   **both** the API and Worker apps (same value on both — it's what
   decrypts the stored secret), generated with:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. **Fallback: env vars**, only used when nothing has been saved via the
   admin dashboard:
   ```
   R2_ACCOUNT_ID=<Cloudflare account ID>
   R2_ACCESS_KEY_ID=<R2 API token access key ID>
   R2_SECRET_ACCESS_KEY=<R2 API token secret access key>
   R2_BUCKET=songverse
   ```
   `R2_ENDPOINT` is optional — leave it unset and it defaults to
   `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; only set it if using
   a custom R2 endpoint/domain.

**If neither path is configured**, song attachments (uploaded ChordPro
files, PDF sheet music scans) silently fall back to local disk inside the
container instead of erroring — fine for local dev, **broken in
production**: the API and Worker are separate containers with separate
disks, an upload handled by one won't be visible to the other, and nothing
survives a redeploy either way. Set one of the two paths before anyone
uploads an attachment or runs a bulk content upload for real. Admin >
Storage shows which path is currently active.

**Sync play** (#13) is a WebSocket on the API itself, at
`wss://api.oneverse.top/sync` - the same app and port, nothing to add.
Dokploy's proxy (Traefik) passes WebSocket connections through as they
are; a proxy of your own in front must allow the `Upgrade` header. The
sessions live in Redis, so it works with more than one API instance.

### Worker app

**Application**, same source and Dockerfile as the API:
- Dockerfile path: `Dockerfile.api`
- Build context: `.`
- **No domain, no port** — it doesn't serve web traffic
- **Command override** (usually under an "Advanced" tab, field is typically called "Command"): `node dist/worker.js`
- Watch paths (if you use auto-deploy): the same as the API's - it's the same image, and must be rebuilt whenever the API is

Environment variables - only these three are required:
```
DATABASE_URL=...              # same as the API's
REDIS_URL=...                 # same as the API's
SETTINGS_ENCRYPTION_KEY=...   # same as the API's
```
Everything else the Worker uses - object storage, the metadata providers'
keys (Spotify, Apple Music), MusicBrainz's contact - it reads from what's
saved in the Admin UI, like the API does; `SETTINGS_ENCRYPTION_KEY` is what
decrypts the secrets saved there, so it must be the API's exact value. Only
if you configure those through env vars instead (`R2_*`, `SPOTIFY_*`,
`APPLE_MUSIC_*`, `MUSICBRAINZ_CONTACT`) does the Worker need them too.
Admin > Metadata > **Background jobs** warns when the running Worker has no
`SETTINGS_ENCRYPTION_KEY`, or one that isn't the API's (#95) - its logs then
say "SETTINGS_ENCRYPTION_KEY is not set" or "can't be decrypted". An env var
changed in Dokploy only reaches the container on the next deploy.

It doesn't need `BETTER_AUTH_SECRET`, `AUTH_URL`, `WEB_URL`, the
Resend/Google vars or `PORT`: it serves no HTTP traffic and signs nothing.
Leave `JOBS_IN_API` unset (or `false`) on the API when you run a Worker.

### Oneverse app

Where people sign in, sign up, reset a password and manage their account (#303, `apps/oneverse`). Songverse and Planiverse send people here and come back signed in; someone already signed in here goes straight through.

**Application**, configured as:
- Source: this repo, branch `main`
- Build type: **Dockerfile**
- Dockerfile path: `Dockerfile.oneverse`
- Build context: `.`
- Port: `3000`
- Domain: `oneverse.top` (the API is a subdomain of it, `api.oneverse.top`: see `ONEVERSE_URL` above)
- Watch paths (if you use auto-deploy): `apps/oneverse/**`, `packages/core/**`, `packages/ui/**`, `packages/app/**`, `packages/tsconfig/**`, `Dockerfile.oneverse`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**`

Environment variables:
```
API_URL=https://api.oneverse.top
# The apps it links to (its home page, and where it sends people back to).
SONGVERSE_URL=https://songverse.top
PLANIVERSE_URL=https://planiverse.top   # only with Planiverse
PORT=3000
```

Then set `ONEVERSE_URL` to its address on the **API** and on each app (below).

### Songverse app

Songverse's web app (`apps/web`). Called the Web app in earlier versions of this guide, built from `Dockerfile.web`.

**Application**, configured as:
- Source: this repo, branch `main`
- Build type: **Dockerfile**
- Dockerfile path: `Dockerfile.songverse`
- Build context: `.`
- Port: `3000`
- Domain: `songverse.top` (any domain; see "Old links keep working" for `app.songverse.one`)
- Watch paths (if you use auto-deploy): `apps/web/**`, `packages/core/**`, `packages/ui/**`, `packages/app/**`, `packages/planning/**`, `packages/tsconfig/**`, `Dockerfile.songverse`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**`

Environment variables:
```
API_URL=https://api.oneverse.top
# Its own address: where Oneverse sends people back to (must match the API's WEB_URL).
WEB_URL=https://songverse.top
# Where people sign in (the API's ONEVERSE_URL).
ONEVERSE_URL=https://oneverse.top
PORT=3000
```

That's it — the web app no longer talks to Postgres or BetterAuth directly (see the "Where auth lives" note below), so it doesn't need `DATABASE_URL`, `AUTH_URL`, `BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, or the Resend/Google vars at all anymore; those all live on the API app now (see above).

**Old links keep working.** Links already sent out (emails, set share links, claim links, bookmarks) point at `app.songverse.one` or `songverse.one`. The website at `songverse.one` sends any path that isn't one of its pages to the same path on the app (see "Site app" below).

Since #303 the app is at `songverse.top`, and links sent before point at `app.songverse.one`: keep that domain on the Songverse app too, and set `REDIRECT_HOSTS=app.songverse.one` on it. A request for a listed host is redirected to the same page on `WEB_URL` (see `apps/web/redirect-hosts.mjs`). The website's `APP_URL` (below) sends old `songverse.one` links straight to `songverse.top`.

### Planiverse app

Optional (#241): Songverse's planning on its own - My calendar, organisations, their groups and events - for people who plan without playing, signed in to with the same accounts. Deploy it when a server has organisations (Admin > Organisations); without it, people plan in Songverse as before.

**Application**, configured as:
- Source: this repo, branch `main`
- Build type: **Dockerfile**
- Dockerfile path: `Dockerfile.planiverse`
- Build context: `.`
- Port: `3000`
- Domain: `planiverse.top` (any domain)
- Watch paths (if you use auto-deploy): `apps/planiverse/**`, `packages/core/**`, `packages/ui/**`, `packages/app/**`, `packages/planning/**`, `packages/tsconfig/**`, `Dockerfile.planiverse`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**`

Environment variables:
```
API_URL=https://api.oneverse.top
# Where a date's set opens (Songverse's sets aren't made in Planiverse). Unset, sets aren't shown.
SONGVERSE_URL=https://songverse.top
# Its own address (the API's PLANIVERSE_URL), and where people sign in.
PLANIVERSE_URL=https://planiverse.top
ONEVERSE_URL=https://oneverse.top
PORT=3000
```

Then set `PLANIVERSE_URL=https://planiverse.top` on the **API** and redeploy it: until then the API refuses Planiverse's sign-ins. The Worker needs nothing new (the API passes the addresses with each job).

### Site app

The website at the root domain (`apps/site`, #43): one static page in English and French, served by nginx, which sends any other path on to the app.

**Application**, configured as:
- Source: this repo, branch `main`
- Build type: **Dockerfile**
- Dockerfile path: `Dockerfile.site`
- Build context: `.`
- Port: `80`
- Domain: `songverse.one`
- Watch paths (if you use auto-deploy): `apps/site/**`, `Dockerfile.site`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**`

Environment variables: none needed. `APP_URL` (default `https://songverse.top`; `https://app.songverse.one` before #303) is where paths that aren't website pages are redirected.

### Docs app

The user documentation (`apps/docs`), a static site served by nginx.

**Application**, configured as:
- Source: this repo, branch `main`
- Build type: **Dockerfile**
- Dockerfile path: `Dockerfile.docs`
- Build context: `.`
- Port: `80`
- Domain: `docs.oneverse.top` (it was `docs.songverse.one` before #303: keep that domain on the app too, so old links still open)
- Watch paths (under the app's advanced settings, if you use auto-deploy): `apps/docs/**`, `Dockerfile.docs`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**`, so only docs changes rebuild it.

No environment variables. The build fails if any page links to a page or heading that doesn't exist, so a broken docs change never deploys.

### Other parts, deployed on their own

- **Songverse Sonic** (stem separation and music analysis) is its own server, with its own repository and images: [Vulcio/songverse-sonic](https://github.com/Vulcio/songverse-sonic). Point the API at it in **Admin > Stem separation**; teams and organisations can bring their own (#300).
- **The on-site player** (a mini PC driving the screens over HDMI, #247) is [Vulcio/songverse-player](https://github.com/Vulcio/songverse-player). It's a prototype: nothing in this deployment depends on it yet.

### Signing in at Oneverse

A one-time change for a deployment that predates #303, where people signed in on Songverse's own pages. Once the apps are this version they have no sign-in page of their own, so do it with the same deploy, at a quiet time:
This also moves everything from `songverse.one` to the apps' own domains (only the website stays).
1. **Oneverse app:** create it (see "Oneverse app" above) at `oneverse.top`, and deploy it.
2. **API:** add the domain `api.oneverse.top` (keep `api.songverse.one` for now: the Sonic servers and anything else calling the old address keep working), and set `AUTH_URL=https://api.oneverse.top`, `ONEVERSE_URL=https://oneverse.top`, `WEB_URL=https://songverse.top`, `PLANIVERSE_URL=https://planiverse.top`. Redeploy it and the Worker. The new migrations add the OAuth tables and remove the old passkeys; the API registers Songverse and Planiverse as its clients as it starts.
3. **Songverse:** add `songverse.top` (keep `app.songverse.one`, with `REDIRECT_HOSTS=app.songverse.one`), set `API_URL=https://api.oneverse.top`, `WEB_URL=https://songverse.top`, `ONEVERSE_URL=https://oneverse.top`, and redeploy.
4. **Planiverse**, if deployed: domain `planiverse.top`, `API_URL`, `PLANIVERSE_URL=https://planiverse.top`, `ONEVERSE_URL`, `SONGVERSE_URL=https://songverse.top`, and redeploy.
5. **Site:** set `APP_URL=https://songverse.top` and redeploy. **Docs:** add the domain `docs.oneverse.top`, keeping `docs.songverse.one`.
6. **Google sign-in**, if set up: add `https://api.oneverse.top/api/auth/callback/google` to the OAuth client's authorized redirect URIs in the Google Cloud Console.
7. **Stem separation:** the Sonic server's webhooks go to `AUTH_URL`, so it must be able to reach `api.oneverse.top`.
8. **Check** [Verify](#4-verify). Everyone signs in once more (the apps' sessions are new) and adds their passkeys again at Oneverse.

The apps can move to other domains later: change their address on the API and on the app, together. Moving Oneverse and the API changes the passkeys' relying party: remove them again (`DELETE FROM "Passkey"`).

## 3. Database migrations (automatic)

Nothing to run by hand. The API container applies any pending migrations each time it starts, before serving traffic (see the `CMD` in `Dockerfile.api`), so the first deploy creates the schema and later deploys pick up new migrations. Check the API's startup logs for Prisma's output: either the migrations it applied or `No pending migrations to apply.` If a migration fails, the API won't start and the error will be in those same logs.

The Worker doesn't migrate: its command override (`node dist/worker.js`) replaces the image's start command.

To run migrations manually anyway (e.g. to retry after fixing a failure), open a shell in the running **API** container and run:
```
/repo/packages/db/node_modules/.bin/prisma migrate deploy --schema /repo/packages/db/prisma/schema.prisma
```
Don't use `pnpm --filter @oneverse/db exec ...` there: the image doesn't include the pnpm workspace files, so pnpm finds no matching project and silently does nothing.

## 4. Verify

- `https://api.oneverse.top/health` → `{"status":"ok"}`
- `https://api.oneverse.top/api/docs` → interactive API documentation
- `https://songverse.one` → the website, in English (`/fr/` in French)
- `https://songverse.top` → Oneverse's sign-in page, at `https://oneverse.top/sign-in` (and `https://songverse.one/library` redirects to the app)
- `https://docs.oneverse.top` → the documentation, with a language menu (English, Français)
- Sign up for an account → back in Songverse, on `/library`; Planiverse, if deployed, then signs you in without asking
- Sign out in Songverse → back at Oneverse's sign-in page
- On a set, **Sync** → **Turn sync on** → it says who's leading (or that no one is) rather than "Connecting…": the WebSocket gets through

If all of those work, the deployment is healthy end to end: DNS → HTTPS → Songverse → Oneverse → Auth → API → Database.

## Gotchas already hit (and fixed in the repo)

These were real failures during the first deploy. The fixes are already committed, but they're documented here in case a future change accidentally reintroduces one of them.

#### 1. Docker build context
Every Dockerfile lives at the **repo root** (`Dockerfile.api`, `Dockerfile.songverse`, `Dockerfile.planiverse`…), not inside `apps/api/` or `apps/web/`. They need to reach sibling folders (`packages/*`) during the build, and some platforms — Dokploy included — default the build context to "the directory the Dockerfile is in," ignoring a separately configured context path. Keeping the Dockerfiles at the root sidesteps the ambiguity entirely: wherever the Dockerfile is *is* the context.

#### 2. pnpm version drift
Both Dockerfiles pin pnpm explicitly with `corepack prepare pnpm@10.33.0 --activate` in the base stage, rather than letting corepack lazily resolve a version from `package.json` at first use. Without this, a newer base image's corepack silently fetched pnpm 12 instead of the pinned 10.33.0, and pnpm 12 resolves monorepo workspaces more strictly — breaking the (normal, standard) "copy `package.json` files first, then install" layer-caching pattern both Dockerfiles use.

#### 3. Missing OpenSSL
Both Dockerfiles now `apt-get install openssl` in the base stage. `node:22-slim` doesn't include it, and Prisma's query engine needs it to detect which binary variant to use — without it, Prisma falls back to a guess that happens to work on some hosts and might not on others.

#### 4. `vite preview` blocking the production domain
`apps/web/vite.config.ts` sets `preview.allowedHosts: true`. By default, `vite preview` (which is what serves the Songverse app in production here — see the comment at the top of `Dockerfile.songverse` for why) only trusts `localhost`, as a defense meant for a developer's own machine. Behind Dokploy's reverse proxy, that protection is redundant — the proxy already controls which domains reach the container.

#### 5. The API URL must be a runtime value, not baked in at build time
`packages/app/src/public-env.ts` reads `API_URL` from the container's environment at request time, rather than through Vite's `VITE_`-prefixed build-time env inlining. The build-time approach requires the hosting platform to correctly pass a value as a Docker *build argument* specifically (not just a regular env var), which didn't work reliably here. If `/users/me` or similar ever starts failing again with something like `Failed to parse URL from /users/me`, it means `API_URL` isn't set on the Songverse (or Planiverse) app's environment variables.

#### 6. Auth's session cookie and CORS have to agree on the exact origin
Since BetterAuth moved into `apps/api`, its session cookie is set by `api.oneverse.top` but needs to be usable by pages served from Oneverse (`oneverse.top`; the web app's, before #303) — a genuinely cross-origin (though same-site) setup. Two things have to be configured together, in `apps/api/src/main.ts` / `auth/better-auth.ts`, or sign-in silently stops persisting:
- CORS must name the web apps' **exact** origins (`ONEVERSE_URL`, `WEB_URL`, `PLANIVERSE_URL`) with `credentials: true` — `cors: true` (reflecting any origin) or a wildcard origin cannot be combined with credentialed requests; the browser will drop the cookie.
- BetterAuth's `advanced.crossSubDomainCookies` must be enabled **with an explicit `domain`** of the shared parent (`oneverse.top`). Enabling it without one doesn't help: BetterAuth then defaults the domain to `AUTH_URL`'s own hostname (`api.oneverse.top`), which the web app still never sees. `better-auth.ts` derives this domain from `AUTH_URL`/`ONEVERSE_URL`, so in practice this means those two env vars must be right.

If sign-in appears to succeed (a 200 comes back) but the user is immediately signed out again on the next page load, check these two first — it's almost always one of them, usually caused by `ONEVERSE_URL`/`AUTH_URL` being wrong or swapped. If instead Oneverse signs you in but the app sends you straight back to it, check the app's own `WEB_URL` (or `PLANIVERSE_URL`): it must be the address the browser uses, the one the API has too.

## Redeploying after a code change

Push to `main`, then trigger a rebuild in Dokploy for whichever app(s) changed (API and Worker share an image, so a backend change means rebuilding both). New Prisma migrations apply automatically when the API restarts (see step 3).

### Watch paths

With auto-deploy on, Dokploy rebuilds an app only when a push changes a file matching its watch paths. They're exactly what each app's Dockerfile copies:

| App | Watch paths |
|---|---|
| API, Worker | `apps/api/**`, `packages/core/**`, `packages/db/**`, `packages/secret-crypto/**`, `packages/tsconfig/**`, `Dockerfile.api`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**` |
| Oneverse | `apps/oneverse/**`, `packages/core/**`, `packages/ui/**`, `packages/app/**`, `packages/tsconfig/**`, `Dockerfile.oneverse`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**` |
| Songverse | `apps/web/**`, `packages/core/**`, `packages/ui/**`, `packages/app/**`, `packages/planning/**`, `packages/tsconfig/**`, `Dockerfile.songverse`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**` |
| Planiverse | `apps/planiverse/**`, `packages/core/**`, `packages/ui/**`, `packages/app/**`, `packages/planning/**`, `packages/tsconfig/**`, `Dockerfile.planiverse`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**` |
| Site | `apps/site/**`, `Dockerfile.site`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**` |
| Docs | `apps/docs/**`, `Dockerfile.docs`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/**` |

The root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `patches/**` are in every app's: every image installs its dependencies from them, so a dependency change rebuilds them all.

- `packages/core` (shared types, translations, the API client) is in the API's and every web app's: a change there has to reach them all, or the web apps and the API disagree.
- `packages/ui` and `packages/app` (#241: the UI, signing in) are in every web app's: a change there rebuilds Oneverse, Songverse and Planiverse; `packages/planning` (the planning screens) only Songverse and Planiverse.
- `packages/db` holds the Prisma schema and migrations: a new migration rebuilds the API, which applies it as it starts (step 3).
- `e2e/`, `docs/` and the `.md` files at the root aren't in any image, so changing them rebuilds nothing.

If a Dockerfile starts copying something new (another package, say), add it to that app's watch paths too, or a change there won't redeploy it.
