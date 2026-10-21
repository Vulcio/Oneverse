# Sign in with Oneverse

Issue #303. How people sign in once the apps live on their own domains
(`oneverse.top`, `songverse.top`, `planiverse.top`), decided 2026-10-21.

## The parts

| Part | Address (production) | Does |
| --- | --- | --- |
| Oneverse (`apps/oneverse`) | `oneverse.top` | The account: sign in, sign up, verify, reset, passkeys, the account's settings. Later Oneverse's home and the operator console |
| API (`apps/api`) | `api.oneverse.top` | BetterAuth, and an OAuth 2.1 / OpenID Connect provider (`@better-auth/oauth-provider`); every other endpoint, as today |
| Songverse (`apps/web`), Planiverse (`apps/planiverse`) | `songverse.top`, `planiverse.top` | OAuth clients: they send people to Oneverse to sign in and keep a session of their own |

Oneverse and the API share a parent domain (`oneverse.top`), so BetterAuth's
session cookie works between them as it does today
(`crossSubDomainCookies`). The apps never see that cookie.

## Signing in to an app

1. Someone signed out opens `songverse.top/library`. Its server answers with a
   redirect to its own `/auth/sign-in?next=/library`.
2. That route makes a PKCE verifier and a `state`, keeps both in a short-lived
   httpOnly cookie on `songverse.top`, and redirects to
   `api.oneverse.top/api/auth/oauth2/authorize` (client `songverse`, scopes
   `openid profile email offline_access`, `resource` = the API).
3. Not signed in at Oneverse: the provider sends them to its login page,
   `oneverse.top/sign-in`, which is today's `AuthCard`. Once a session is
   made, the provider carries on by itself. Already signed in: nothing shows.
4. The provider redirects to `songverse.top/auth/callback?code=…&state=…`.
   Songverse's server checks `state`, exchanges the code (with the verifier)
   at `/oauth2/token`, and gets an access token (a JWT for the API, an hour)
   and a refresh token (30 days, a new one at each refresh).
5. It keeps them in an httpOnly, `Secure`, `SameSite=Lax` cookie on
   `songverse.top`, and redirects to `next`.

The apps are public clients (no client secret, PKCE required): nothing to
copy between the API's and the apps' settings. A code is worth nothing
without the verifier, and the redirect addresses are fixed. The clients are
the API's own (`skip_consent`): nobody is asked "allow Songverse?". The API
writes them when it starts, from `WEB_URL` and `PLANIVERSE_URL` (their
redirect address is `<app>/auth/callback`).

## Using the API

Unchanged: the browser and the app's server call the API with a Bearer JWT.
Today the token comes from `/api/auth/token`, called with BetterAuth's cookie;
now it's the access token kept in the app's own cookie, refreshed by the app's
server when it's about to expire (`getApiToken` keeps its name and its job).
`JwtAuthGuard` accepts both kinds of token while the old sessions last: the
provider's (issuer `…/api/auth`, audience the API) and BetterAuth's.

What the session carries today (`/api/auth/get-session`: name, picture,
admin, roles' rights, language) comes from `GET /users/me` with the access
token, which already answers all of it.

Both kinds of token are signed with the jwt plugin's keys, by the API's
address (`iss`), for the API's address (`aud`, which is also the OAuth
`resource`): the guard checks both. An ID token (its audience is the app)
isn't taken as an access token.

The sync socket, signed addresses (`<img>`, `<audio>`) and screens' tokens
need no cookie and don't change.

## Signing out

The app clears its cookie and revokes the refresh token
(`/oauth2/revoke`), then offers to sign out of Oneverse too (its
`/sign-out`, which ends BetterAuth's session). Banning or deleting someone
already ends their sessions; their refresh tokens are refused from then on.

## Configuration

- `ONEVERSE_URL` (the API's environment): Oneverse's address. Set, it's the
  provider's sign-in page, the only web app sharing BetterAuth's cookie with
  the API (whose domain and the passkeys' relying party come from it and
  `AUTH_URL`), and Songverse and Planiverse may be on any domain. Unset,
  everyone signs in in the apps as before, and the provider's sign-in page
  is Songverse's.
- The clients (`songverse`, `planiverse`) are written when the API starts,
  from `WEB_URL` and `PLANIVERSE_URL` (`apps/api/src/auth/oauth-clients.ts`).
- The plugin's tables are in `schema.prisma` (`Oauth*`). Its optional lists
  are Json (null is "any" to it, `[]` "none", and a Postgres list can't be
  null): BetterAuth gets a Prisma client that writes their nulls as
  `Prisma.DbNull` (`auth/oauth-prisma.ts`).
- Checked against a local API: sign in, authorize, code for tokens with
  PKCE, `/users/me` with the access token, the ID token refused, refresh
  (a new refresh token each time), revoke, BetterAuth's own token still taken.

## Passkeys

Their relying party becomes `oneverse.top`, and they're only ever used on
`oneverse.top`'s pages. Passkeys made on `songverse.one` don't work there:
after the move, people sign in with their password, Google or an emailed link
once, and add a passkey again (the account page says so).

## On one domain

A server on one parent domain (self-hosted, or `localhost` in development)
works the same way, same-site: the flow doesn't depend on the domains being
different. Development: Oneverse on `localhost:3003`, the API on `:3001`,
Songverse on `:3000`, Planiverse on `:3002`.

## Moving from songverse.one

- `songverse.one` and its subdomains redirect, path kept, to the new
  addresses, for the links already sent (emails, set and invite links,
  calendar feeds).
- Everyone signs in again once.
- Google sign-in's redirect address moves to `api.oneverse.top`.
- Email keeps going out from `songverse.one` until `oneverse.top` has SPF,
  DKIM and DMARC.

## Tests

The e2e suites run Oneverse and the apps on different hosts (`localhost` and
`127.0.0.1`), which don't share cookies, so a flow that only worked because of
a shared cookie fails there.
