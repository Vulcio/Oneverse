# The machine CI's e2e shards run in (issue #315): Playwright's own image -
# Chromium and every library and font it needs - with what the stack and the
# suites call besides: ffmpeg (the Worker's Opus, test audio), psql (the
# harness's sql()), python3, curl and git. Built and pushed to ghcr.io by
# ci.yml's e2e-image job, tagged by a hash of this file and e2e/package.json,
# so the shards install nothing from Ubuntu's mirror.
#
# The Playwright version here must be e2e/package.json's: a new one there
# changes the tag, and the image is built again with it.
ARG PLAYWRIGHT=1.56.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT}-noble

RUN apt-get update -q \
  && apt-get install -y -q --no-install-recommends ffmpeg postgresql-client python3 curl git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
