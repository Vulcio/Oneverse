-- Announcements (issue #536): news for people, sent as notifications.
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "texts" JSONB NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'EVERYONE',
    "organizationId" TEXT,
    "release" TEXT,
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "recipients" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Announcement_release_key" ON "Announcement"("release");
CREATE INDEX "Announcement_organizationId_createdAt_idx" ON "Announcement"("organizationId", "createdAt");

ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification" ADD COLUMN "announcementId" TEXT;
CREATE INDEX "Notification_announcementId_idx" ON "Notification"("announcementId");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
