-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "home" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER,
    "setupMinutes" INTEGER NOT NULL DEFAULT 0,
    "teardownMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_OrganizationEventRooms" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_OrganizationEventRooms_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TeamEventRooms" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TeamEventRooms_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TeamEventTypeRooms" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TeamEventTypeRooms_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Room_locationId_idx" ON "Room"("locationId");

-- CreateIndex
CREATE INDEX "_OrganizationEventRooms_B_index" ON "_OrganizationEventRooms"("B");

-- CreateIndex
CREATE INDEX "_TeamEventRooms_B_index" ON "_TeamEventRooms"("B");

-- CreateIndex
CREATE INDEX "_TeamEventTypeRooms_B_index" ON "_TeamEventTypeRooms"("B");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OrganizationEventRooms" ADD CONSTRAINT "_OrganizationEventRooms_A_fkey" FOREIGN KEY ("A") REFERENCES "OrganizationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OrganizationEventRooms" ADD CONSTRAINT "_OrganizationEventRooms_B_fkey" FOREIGN KEY ("B") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamEventRooms" ADD CONSTRAINT "_TeamEventRooms_A_fkey" FOREIGN KEY ("A") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamEventRooms" ADD CONSTRAINT "_TeamEventRooms_B_fkey" FOREIGN KEY ("B") REFERENCES "TeamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamEventTypeRooms" ADD CONSTRAINT "_TeamEventTypeRooms_A_fkey" FOREIGN KEY ("A") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TeamEventTypeRooms" ADD CONSTRAINT "_TeamEventTypeRooms_B_fkey" FOREIGN KEY ("B") REFERENCES "TeamEventType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
