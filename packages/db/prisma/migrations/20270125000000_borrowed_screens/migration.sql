-- A screen borrowed for a set for a while (issue #480).
ALTER TABLE "Screen" ADD COLUMN "borrowedUntil" TIMESTAMP(3),
ADD COLUMN "borrowedFrom" JSONB;

CREATE INDEX "Screen_borrowedUntil_idx" ON "Screen"("borrowedUntil");
