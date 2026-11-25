-- An organisation's calendar link (issue #551): its events' dates, for its members.
ALTER TABLE "CalendarFeed" ADD COLUMN "organizationId" TEXT;
CREATE UNIQUE INDEX "CalendarFeed_organizationId_key" ON "CalendarFeed"("organizationId");
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
