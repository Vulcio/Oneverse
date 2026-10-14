-- A team's calendar link (issue #240): a feed of all its dates.
ALTER TABLE "CalendarFeed" ADD COLUMN     "locale" TEXT,
ADD COLUMN     "teamId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_teamId_key" ON "CalendarFeed"("teamId");

-- AddForeignKey
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
