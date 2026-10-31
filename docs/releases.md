# Releases

Oneverse is versioned as one product (issue #164): the API, the Worker, the web
apps and the database's migrations ship together from `main`. The docs and the
website aren't versioned.

- **SemVer**, starting at `0.9.0`. `1.0` means "a solid start, a great
  foundation": things may still change after it. An API change is announced in
  the release notes, with the old way kept for a release where possible; brice
  decides when a release candidate becomes `1.0`.
- **The version being prepared** is the root `package.json`'s `version`. A build
  that isn't a release reports it as `0.9.0-dev` (SemVer orders that before
  `0.9.0`); a release's images are given the exact version and commit
  (`ONEVERSE_VERSION`, `ONEVERSE_COMMIT`), read by `apps/api/src/common/version.ts`.
- **What runs** shows on the API's `/health` (`version`, `commit`, the database's
  latest `migration`) and in Admin > Metadata > Background jobs, which warns when
  the Worker runs another version than the API.

## Cutting a release

1. On `main`, with CI green, check `package.json`'s version is the one to
   release, and read a draft of the notes:
   `node scripts/release-notes.mjs v0.9.0` (it uses the `gh` command line).
   Label an issue `breaking` if it needs attention when upgrading; it's listed first.
2. Tag the commit and push the tag:
   ```
   git tag v0.9.0 && git push origin v0.9.0
   ```
   A candidate is `v0.9.0-rc.1`: same steps, its images aren't tagged `latest`
   and its release is marked as a pre-release.
3. `.github/workflows/release.yml` checks the tag is `package.json`'s version
   and on `main`, builds every image with the version in it, pushes them to
   `ghcr.io/vulcio/oneverse-<app>:<version>` (and `:<minor>`, `:latest` for a
   release), and drafts the GitHub Release from the issues closed since the
   previous release's tag.
4. Edit the draft: say at the top what matters and what an operator must do
   (Deploy.md's "Upgrading"), then publish it.
5. On `main`, set `package.json`'s version to the next one being prepared
   (`0.10.0`, or `0.9.1` for fixes only), in its own commit.

The first time, the images' packages on GitHub are private: make them public in
the organisation's Packages settings so a deployment can pull them without a token.
