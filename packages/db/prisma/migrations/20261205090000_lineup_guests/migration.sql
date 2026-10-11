-- Guests on a line-up (issue #235, phase 7): someone without an account, by name.
ALTER TABLE "TeamEventAssignment" ADD COLUMN "guestName" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;
