-- A date moved to another day (issue #576): the day its series put it on.
ALTER TABLE "TeamEventDate" ADD COLUMN "movedFrom" DATE;
