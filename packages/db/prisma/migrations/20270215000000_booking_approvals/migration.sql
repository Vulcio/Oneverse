-- CreateEnum
CREATE TYPE "BookingApprovalStatus" AS ENUM ('REQUESTED', 'APPROVED');

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "managerTeamId" TEXT,
ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "managerTeamId" TEXT,
ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BookingApproval" (
    "id" TEXT NOT NULL,
    "roomId" TEXT,
    "resourceId" TEXT,
    "teamEventId" TEXT,
    "organizationEventId" TEXT,
    "status" "BookingApprovalStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedByUserId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingApproval_roomId_idx" ON "BookingApproval"("roomId");

-- CreateIndex
CREATE INDEX "BookingApproval_resourceId_idx" ON "BookingApproval"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingApproval_teamEventId_roomId_key" ON "BookingApproval"("teamEventId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingApproval_teamEventId_resourceId_key" ON "BookingApproval"("teamEventId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingApproval_organizationEventId_roomId_key" ON "BookingApproval"("organizationEventId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingApproval_organizationEventId_resourceId_key" ON "BookingApproval"("organizationEventId", "resourceId");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_managerTeamId_fkey" FOREIGN KEY ("managerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_managerTeamId_fkey" FOREIGN KEY ("managerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingApproval" ADD CONSTRAINT "BookingApproval_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingApproval" ADD CONSTRAINT "BookingApproval_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingApproval" ADD CONSTRAINT "BookingApproval_teamEventId_fkey" FOREIGN KEY ("teamEventId") REFERENCES "TeamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingApproval" ADD CONSTRAINT "BookingApproval_organizationEventId_fkey" FOREIGN KEY ("organizationEventId") REFERENCES "OrganizationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingApproval" ADD CONSTRAINT "BookingApproval_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingApproval" ADD CONSTRAINT "BookingApproval_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
