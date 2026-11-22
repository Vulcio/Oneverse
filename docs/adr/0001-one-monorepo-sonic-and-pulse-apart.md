# One monorepo for the apps; Sonic and Pulse in their own repositories

Decided 2026-10-21 (docs/oneverse-architecture.md). Songverse, Oneverse Plan, Oneverse home, the screen page, the API,
the database and the shared packages live in one repository (`Vulcio/Oneverse`, renamed from `Vulcio/Songverse`):
one schema, one API, one e2e harness and changes made across them at once were worth more than separate repositories.
Songverse Sonic (Python) and Oneverse Pulse's daemon (Rust) stay apart because they are other languages, deployed on
their own; Pulse's live engine is the exception and lives here (`apps/pulse`), see ADR 0008.
