-- When someone last skipped "What do you play or do?" (issue #109).
ALTER TABLE "User" ADD COLUMN "profilePromptSkippedAt" TIMESTAMP(3);
