-- A revision is one change in an epoch (issue #247): during an outage the cloud and
-- Oneverse Pulse both go on from the same revision, each in its own epoch.
DROP INDEX "LiveSessionCommand_sessionId_rev_key";
CREATE UNIQUE INDEX "LiveSessionCommand_sessionId_epoch_rev_key" ON "LiveSessionCommand"("sessionId", "epoch", "rev");
