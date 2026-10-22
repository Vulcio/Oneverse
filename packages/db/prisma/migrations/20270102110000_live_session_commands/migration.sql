-- The record of a live session (issue #247): each change as it was applied.
CREATE TABLE "LiveSessionCommand" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rev" INTEGER NOT NULL,
    "epoch" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "origin" TEXT NOT NULL,
    "op" JSONB NOT NULL,

    CONSTRAINT "LiveSessionCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveSessionCommand_sessionId_rev_key" ON "LiveSessionCommand"("sessionId", "rev");
CREATE INDEX "LiveSessionCommand_userId_idx" ON "LiveSessionCommand"("userId");

ALTER TABLE "LiveSessionCommand" ADD CONSTRAINT "LiveSessionCommand_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSessionCommand" ADD CONSTRAINT "LiveSessionCommand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
