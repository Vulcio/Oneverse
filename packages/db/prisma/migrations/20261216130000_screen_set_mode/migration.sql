-- A screen follows its owner's set of the day, or shows a set put on it (issue #274).
CREATE TYPE "ScreenSetMode" AS ENUM ('FIXED', 'DAY');
ALTER TABLE "Screen" ADD COLUMN "setMode" "ScreenSetMode" NOT NULL DEFAULT 'FIXED',
ADD COLUMN "setlistPickedOn" TEXT;
