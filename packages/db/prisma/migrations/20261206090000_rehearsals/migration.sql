-- Rehearsals tied to an event (issue #235, phase 7).
ALTER TABLE "TeamEvent" ADD COLUMN "daysBefore" INTEGER,
ADD COLUMN "rehearsalForId" TEXT;

-- AddForeignKey
ALTER TABLE "TeamEvent" ADD CONSTRAINT "TeamEvent_rehearsalForId_fkey" FOREIGN KEY ("rehearsalForId") REFERENCES "TeamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
