-- Swaps (issue #235, phase 7): someone on a line-up asking for a replacement.
ALTER TABLE "TeamEventAssignment" ADD COLUMN "swapNote" TEXT,
ADD COLUMN "swapRequestedAt" TIMESTAMP(3);
