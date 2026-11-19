-- Groups that only plan get sets now (issue #531). Their events had none: they keep none until an admin asks for one.
UPDATE "TeamEvent" SET "withSet" = false WHERE "teamId" IN (SELECT "id" FROM "Team" WHERE "usesSongverse" = false);
UPDATE "TeamEventType" SET "withSet" = false WHERE "teamId" IN (SELECT "id" FROM "Team" WHERE "usesSongverse" = false);
