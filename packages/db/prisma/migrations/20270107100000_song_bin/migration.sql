-- Songs in the bin (issue #340): who deleted them and when; deleted for good 30 days on.
ALTER TABLE "SongVersion" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByUserId" TEXT;

ALTER TABLE "SongVersion" ADD CONSTRAINT "SongVersion_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
