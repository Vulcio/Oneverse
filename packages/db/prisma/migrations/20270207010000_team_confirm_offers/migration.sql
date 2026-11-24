-- Offers that wait for an admin to confirm them (issue #559).
ALTER TABLE "Team" ADD COLUMN "confirmOffers" BOOLEAN NOT NULL DEFAULT false;
