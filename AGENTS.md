# Instructions for coding agents

Read [CLAUDE.md](CLAUDE.md) before changing anything: it is this repository's rulebook for every agent,
whatever its name. In short:

- **An issue first.** Every change has a GitHub issue (an existing one, or a new one); commits reference it
  (`Refs #n`, `Closes #n` in the one that finishes it).
- **Green before pushing.** Run `pnpm lint`, `pnpm type-check` and `pnpm test`, and the e2e suites the
  change touches (`e2e/README.md`). Never push to `main` with any of them failing.
- **One commit per change,** with a message that says what changed and why - not one commit per file, not
  the same message repeated.
- **Tests and docs with the change:** an e2e suite in `e2e/`, the user docs in English and French
  (`apps/docs`), conformance cases for behaviour every client shares (`packages/core/conformance`).
- **Reuse, don't fork:** another app or repository that needs Songverse's screens, chords or songs uses
  `@songverse/core` and the existing components (see "The player screen" in CLAUDE.md).
