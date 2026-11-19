-- A speaker without an account comes with an email (issue #523).
ALTER TABLE "TeamEventAssignment" ADD COLUMN "guestEmail" TEXT;
