-- Sharing a song with a team, and offering it to one (issue #331).
ALTER TABLE "SongOwnershipRequest" ADD COLUMN "offeredByOwner" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "AccessGrant_songVersionId_grantedToTeamId_key" ON "AccessGrant"("songVersionId", "grantedToTeamId");
