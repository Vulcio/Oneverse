# Oneverse

Oneverse is a family of apps for churches, worship teams and musicians,
built on one shared core: one account, the same teams and organisations,
the same sets, screens and live sessions, whichever app you open.

This repository holds the core and the web apps built on it:

| Part | What it is | Where |
| --- | --- | --- |
| **Oneverse core** | Accounts, personal spaces, teams and organisations, roles, sets, scriptures, screens and their layers, live sessions and the operator, behind one API | `apps/api`, `packages/db`, `packages/core` |
| **Oneverse** | Where people sign in, and their account, for every app ("Sign in with Oneverse") | `apps/oneverse` (account.oneverse.top) |
| **Songverse** | Songs and musicians: the library, charts and chords, arrangements, songbooks, practice and Live | `apps/web` (songverse.top) |
| **Planiverse** | Planning: events, rotas, groups and calendars, with the same accounts | `apps/planiverse` (planiverse.top) |
| Shared web parts | The UI, signing in and the account, the planning screens | `packages/ui`, `packages/app`, `packages/planning` |
| Docs and website | The user documentation in English and French, and Oneverse's website | `apps/docs` (docs.oneverse.top), `apps/site` (oneverse.top) |

Other parts live in their own repositories:
[Songverse Sonic](https://github.com/Vulcio/songverse-sonic) (stem separation
and music analysis, Python) and the on-site player
[Oneverse Pulse](https://github.com/Vulcio/oneverse-pulse) (Rust, the on-site
runtime). Planned: Songverse's native apps, Slidevese
(presentations) and Oneverse Screen (native display apps).

Where it's going, and why: [the architecture blueprint](docs/oneverse-architecture.md).
It's a direction, not a description of what's built. The shared packages are
`@oneverse/*`; the apps still run at the `songverse.one` addresses until they
move to their own domains.

User documentation, in English and French: [docs.oneverse.top](https://docs.oneverse.top) (source in `apps/docs`).

## Songverse

A songbook and set-planning app for worship teams and musicians: keep your
chord charts in one library, organise them into songbooks, plan what you're
playing on Sunday, and share it with the people playing with you.

- **Song library** – personal, team and global songs, added and edited
  on one tabbed screen (Song info, Editor, Files, Audio, Links). Upload
  or paste a chart as ChordPro, "chords over lyrics" or lyrics only (the
  format is detected, with how sure the guess is) and it's parsed into a
  structured chart, previewed live beside the text; export back to
  ChordPro. Each song has artists, composers, lyricists and other
  credits (autocompleted from names already in your library), a version
  name, and its own subtitle, sort title, album, year, key, time
  signature, capo, tempo, duration, copyright, CCLI, ISRC, reference and
  notes; plus tags, streaming links (Spotify, Apple Music, YouTube), file
  attachments with image thumbnails, and audio recordings to play in the
  page. Adding a song whose title is already in your library offers to
  open it, start from it, or add another version of it; translations and
  other versions are filed together.
- **Global catalogue** – submit a personal or team song for everyone to
  use. Reviewers (a role granted in Admin > Users) and global admins
  approve it, ask for changes, reject it, or merge it into a global song
  it duplicates; similar global songs are flagged when it's submitted.
  Approving publishes a copy and links your song to it, so yours stays
  yours to change. Global admins can also publish their own songs
  directly, when they choose to.
- **MusicBrainz matching** – link a song to its MusicBrainz recording and
  work to pull in artist and songwriter credits.
- **Songbooks** – simple or numbered collections, built by hand, imported
  from a published songbook catalogue, or filled by bulk-uploading files
  matched to entries.
- **Songbook catalogues** – the numbers, titles, credits, keys, tempos,
  scripture references and tags of published songbooks (facts only, no
  lyrics), kept in an editable table, imported and exported as CSV or JSON
  ([format](docs/songbook-catalog-format.md)). Songs created from a
  catalogue entry start with its details filled in.
- **Sets** – ordered song lists for a service or gig, dated or named, with
  drag-and-drop ordering, a version and key per song. Personal or owned by
  a team; share one with guest musicians by link, who can read every song
  in it and keep private notes. A personal set can move to a team, sharing
  its owner's songs read-only until they hand them over.
- **Arrangements** – how you or your band play a song, without changing
  it: its order, key, capo and tempo, and chords replaced or hidden, lines
  hidden and notes added on some passes. A team's usual arrangement is
  picked when the song goes into its sets, and any set can give a song its
  own order just for that set. Players choose their own view
  on top: chords hidden for them, simpler chords, capo shapes, solfège
  ([format](docs/arrangement-document-v2.md)).
- **Teams** – invite links, member and admin roles, and each member's
  instruments and other roles (sound, media, tech) shown on the team.
- **Accounts** – email and password, passkeys and Google sign-in; email
  verification, password reset and email change; avatars; per-user storage
  limits.
- **Admin** – manage users (ban, grant the reviewer role, delete with or
  without handing their content over), storage (Cloudflare R2 or local disk), sign-in providers
  and email, all editable in the app rather than only through environment
  variables.
- **English and French**, and usable on a phone.

## Planiverse

The planning on its own (issue #241), for people who plan without playing:
My calendar, organisations and their groups (sub-groups, positions of their
own), events that need several groups, availability, line-ups and
reminders, and notifications by email and push. The same accounts and API
as Songverse; a date's set opens in Songverse.

## Tech stack

| Area | Built with |
| --- | --- |
| Monorepo | pnpm workspaces, Vite+ (tasks, linting, tests), TypeScript |
| Web apps (`apps/oneverse`, `apps/web`, `apps/planiverse`) | TanStack Start and Router (React 19, SSR), Vite, Tailwind CSS 4, shadcn/ui, dnd-kit, react-i18next |
| API (`apps/api`) | NestJS (ES modules), requests checked against the shared zod schemas, BetterAuth (sessions, passkeys, OAuth, JWTs for API calls), BullMQ workers on Redis, sharp for images, Resend for email |
| Data (`packages/db`) | PostgreSQL with Prisma; migrations run when the API starts |
| Shared (`packages/core`) | API client, zod schemas, ChordPro and chords-over-lyrics parsers, key transposition, translations, tested with Vitest |
| Storage | Cloudflare R2 (S3-compatible) or local disk, content-addressed |
| Docs (`apps/docs`) | Astro Starlight, English and French, screenshots taken by Playwright |
| Website (`apps/site`) | A static Astro page at the root domain, English and French |
| Deployment | Docker images for the API/worker, Songverse, Planiverse, the docs and the website, run on Dokploy |

## Credits

Oneverse stands on a lot of open-source work. Thank you to everyone behind:

| Project | What it does here | Licence |
| --- | --- | --- |
| [TipTap](https://tiptap.dev) and [ProseMirror](https://prosemirror.net) | The structured song editor: lines, chords pinned to characters, sections dragged around | MIT |
| [React](https://react.dev) | The web app's UI | MIT |
| [TanStack Start, Router and Table](https://tanstack.com) | Server rendering, routing and tables in the web app | MIT |
| [Vite](https://vite.dev) | Building and serving the web app | MIT |
| [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) and [Base UI](https://base-ui.com) | Styling and the accessible building blocks (dialogs, menus, tabs) | MIT |
| [Lucide](https://lucide.dev) | Icons | ISC |
| [dnd-kit](https://dndkit.com) | Drag and drop (sets, songbooks, the song's order) | MIT |
| [pdf.js](https://mozilla.github.io/pdf.js/) | Reading a PDF chart's words and chords, with where they are on the page | Apache-2.0 |
| [react-easy-crop](https://github.com/ValentinH/react-easy-crop) | Cropping avatars and song images | MIT |
| [i18next](https://www.i18next.com) and react-i18next | English and French | MIT |
| [NestJS](https://nestjs.com) | The API | MIT |
| [Better Auth](https://www.better-auth.com) | Accounts, sessions, passkeys, Google sign-in, API tokens | MIT |
| [Prisma](https://www.prisma.io) and [PostgreSQL](https://www.postgresql.org) | The database and its migrations | Apache-2.0 / PostgreSQL |
| [BullMQ](https://bullmq.io), [ioredis](https://github.com/redis/ioredis) and [Redis](https://redis.io) | Background jobs, Sync play's sessions | MIT / MIT / RSALv2-SSPL-AGPL |
| [ws](https://github.com/websockets/ws) | Sync play's WebSocket | MIT |
| [sharp](https://sharp.pixelplumbing.com) | Image thumbnails and resizing | Apache-2.0 |
| [Signalsmith Stretch](https://signalsmith-audio.co.uk/code/stretch/) | Transposing the stems as they play | MIT |
| [RNNoise](https://gitlab.xiph.org/xiph/rnnoise) (through FFmpeg's `arnndn`) and a [rnnoise-models](https://github.com/GregorR/rnnoise-models) model | Cleaning up a sung take | BSD-3-Clause / not copyrighted |
| [FFmpeg](https://ffmpeg.org) with [libopus](https://opus-codec.org) | Recorded takes turned into Opus: silence trimmed, level evened out (EBU R128), noise reduced (run by the Worker, not linked) | LGPL-2.1+ / BSD-3-Clause |
| [jose](https://github.com/panva/jose) | Checking API tokens | MIT |
| [AWS SDK for JavaScript](https://github.com/aws/aws-sdk-js-v3) | Cloudflare R2 storage (S3-compatible) | Apache-2.0 |
| [Resend](https://resend.com) | Sending email | MIT (SDK) |
| [zod](https://zod.dev) and [nestjs-zod](https://github.com/BenLorantfy/nestjs-zod) | Song, arrangement and request schemas, shared by the API and its clients | MIT |
| [Tonal](https://github.com/tonaljs/tonal) | Chord and key theory for transposing | MIT |
| [nanoid](https://github.com/ai/nanoid) | Section, line and chord IDs | MIT |
| [Astro](https://astro.build) and [Starlight](https://starlight.astro.build) | The documentation site and the website | MIT |
| [pdf-lib](https://pdf-lib.js.org) | Making the PDFs the end-to-end tests read | MIT |
| [Playwright](https://playwright.dev) and [Vitest](https://vitest.dev) | End-to-end and unit tests, documentation screenshots | Apache-2.0 / MIT |
| [Vite+](https://viteplus.dev) (with [Oxlint](https://oxc.rs)), [pnpm](https://pnpm.io), [TypeScript](https://www.typescriptlang.org), [Prettier](https://prettier.io) | The workspace and its checks | MIT / MIT / Apache-2.0 / MIT |

Song and artist details come from outside services, each used within its
terms: [MusicBrainz](https://musicbrainz.org) (credits, recordings and
works, CC0), [Wikidata](https://www.wikidata.org) (CC0) and
[Wikipedia](https://www.wikipedia.org) (artist bios, shown with their CC
BY-SA attribution), [Deezer](https://developers.deezer.com), [Apple
Music / iTunes](https://developer.apple.com/musickit/) and
[Spotify](https://developer.spotify.com) (artwork, artist pictures,
links), and [YouTube](https://developers.google.com/youtube/iframe_api_reference)
(the embedded player).

## Getting started

Requires Node 22.18+, pnpm and Docker.

```sh
pnpm install
docker compose up -d postgres redis
cp apps/api/.env.example apps/api/.env       # then fill in the values
cp apps/web/.env.example apps/web/.env
cp packages/db/.env.example packages/db/.env
pnpm db:migrate
pnpm dev                                     # Songverse :3000, API :3001, Planiverse :3002, Oneverse :3003 (sign-in), docs :4321, website :4322
```

`pnpm lint`, `pnpm type-check` and `pnpm test` run the checks across the
workspace, through Vite+'s task runner (`vp run`), which replays a package's
result when nothing it reads has changed; `pnpm exec vp cache clean` starts
over. The lint rules are in the root `vite.config.ts`. `pnpm e2e` runs the end-to-end suites (API and browser) against
the running app - see [e2e/README.md](e2e/README.md). See [Deploy.md](Deploy.md) for production setup.

## Licence

Oneverse is free software: you can use it, study it, share it and change
it under the terms of the [GNU Affero General Public License, version 3](LICENSE)
(AGPL-3.0). If you run a modified copy that other people use over a
network, the licence asks you to offer them its source: the app links to
it (**Source code**, in the account menu and on the sign-in page) through
`SOURCE_CODE_URL` in `packages/core/src/constants/index.ts` - point it at
your own.

Songs, charts, recordings and anything else people add to a server are theirs,
not covered by this licence.
