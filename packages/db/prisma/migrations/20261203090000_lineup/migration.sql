-- Scheduling by part (issue #235, phase 7): who's on which part for a date.
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "TeamEventAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "partKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "TeamEventAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamEventAssignment_userId_date_idx" ON "TeamEventAssignment"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TeamEventAssignment_eventId_date_partKey_userId_key" ON "TeamEventAssignment"("eventId", "date", "partKey", "userId");

-- AddForeignKey
ALTER TABLE "TeamEventAssignment" ADD CONSTRAINT "TeamEventAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TeamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEventAssignment" ADD CONSTRAINT "TeamEventAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEventAssignment" ADD CONSTRAINT "TeamEventAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
