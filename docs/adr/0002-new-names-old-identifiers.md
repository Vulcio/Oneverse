# A rename changes what people read, not stored identifiers

Songverse became Oneverse (2026-10-21), songverse-player became Oneverse Pulse (2026-10-22) and Planiverse became
Oneverse Plan (2026-11-20, #539). Each time, the names people read changed, but the identifiers already stored or
deployed did not: `planiverse` in the database, `PLANIVERSE_URL`, the `PLANIVERSE` announcement audience,
`apps/planiverse`, the `songverse:` Redis keys, Pulse's `songverse-player` binary. Renaming them would need data
migrations and redeploys for no gain to anyone using the apps. So the code may lag the glossary: a code name that
differs from a glossary term is not a reason to rename it, and new code uses the glossary's word.
