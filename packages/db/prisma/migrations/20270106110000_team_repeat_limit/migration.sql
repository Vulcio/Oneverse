-- Songs played often (issue #335): a team's window and limit.
ALTER TABLE "Team" ADD COLUMN "repeatWeeks" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN "repeatLimit" INTEGER;
