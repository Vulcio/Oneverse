-- Signing up by asking for an organisation, approved by a global admin (issue #533).
ALTER TABLE "Organization" ADD COLUMN "street" TEXT, ADD COLUMN "postalCode" TEXT, ADD COLUMN "country" TEXT,
  ADD COLUMN "responsibleFirstName" TEXT, ADD COLUMN "responsibleLastName" TEXT, ADD COLUMN "phone" TEXT;
ALTER TABLE "OrganizationRequest" ADD COLUMN "street" TEXT, ADD COLUMN "postalCode" TEXT, ADD COLUMN "country" TEXT,
  ADD COLUMN "responsibleFirstName" TEXT, ADD COLUMN "responsibleLastName" TEXT,
  ADD COLUMN "phone" TEXT, ADD COLUMN "addressFound" BOOLEAN, ADD COLUMN "addressFoundAs" TEXT,
  ADD COLUMN "atSignup" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "announcedAt" TIMESTAMP(3);
-- Requests made before: their admins were told when they were sent.
UPDATE "OrganizationRequest" SET "announcedAt" = "createdAt";
ALTER TABLE "User" ADD COLUMN "awaitingApprovalSince" TIMESTAMP(3);
ALTER TABLE "SecuritySettings" ADD COLUMN "signupOrganizationRequests" BOOLEAN;
-- Address suggestions and lookups (BAN for France, Photon elsewhere).
ALTER TABLE "OrganizationSettings" ADD COLUMN "addressLookup" BOOLEAN, ADD COLUMN "photonUrl" TEXT,
  ADD COLUMN "addressLookupFrance" BOOLEAN;

CREATE TABLE "OrganizationSignupDraft" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationSignupDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationSignupDraft_token_key" ON "OrganizationSignupDraft"("token");
CREATE INDEX "OrganizationSignupDraft_expiresAt_idx" ON "OrganizationSignupDraft"("expiresAt");
