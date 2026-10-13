# @songverse/app

What Songverse's web app and Planiverse (issue #241) each need to sign
people in and reach the API, kept once:

- `public-env`: the API's address, read at runtime (`API_URL`).
- `session`, `server-auth`: the session and the API token, forwarded to
  the API with the visitor's cookie. `server-auth` holds only the server
  functions (`getSession`, `getVisitorLocale`, `getApiToken`).
- `api-client`: `createAppApiClient()`, an app's one client, sharing a
  token that's reused until shortly before it expires.
- `i18n`, `components/locale-provider`: the languages.
- `auth-client`, `components/auth-card`, `components/reset-password-card`,
  `components/auth-page`: signing in, signing up, passkeys, Google, a new
  password; the app passes its name and mark to `AuthPage`.

Source only, no build: an app imports the files and compiles them, so
TanStack Start turns the server functions into calls to its own server.

```tsx
import { createAppApiClient } from "@songverse/app/api-client";
import { AuthCard } from "@songverse/app/components/auth-card";
```
