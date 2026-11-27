-- Registration for events (issue #593).
ALTER TABLE "Role" ADD COLUMN "canManageRegistrations" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RegistrationForm" (
    "id" TEXT NOT NULL,
    "teamEventId" TEXT,
    "organizationEventId" TEXT,
    "publicId" TEXT NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "opensDaysBefore" INTEGER,
    "closesHoursBefore" INTEGER NOT NULL DEFAULT 0,
    "limit" INTEGER,
    "placeKinds" JSONB NOT NULL,
    "currency" TEXT,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "waitingList" BOOLEAN NOT NULL DEFAULT true,
    "intro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationForm_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RegistrationForm_one_event" CHECK (("teamEventId" IS NULL) <> ("organizationEventId" IS NULL))
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "places" JSONB NOT NULL,
    "count" INTEGER NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "paidAt" TIMESTAMP(3),
    "manageToken" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationForm_teamEventId_key" ON "RegistrationForm"("teamEventId");
CREATE UNIQUE INDEX "RegistrationForm_organizationEventId_key" ON "RegistrationForm"("organizationEventId");
CREATE UNIQUE INDEX "RegistrationForm_publicId_key" ON "RegistrationForm"("publicId");
CREATE UNIQUE INDEX "Registration_manageToken_key" ON "Registration"("manageToken");
CREATE INDEX "Registration_formId_date_idx" ON "Registration"("formId", "date");
CREATE INDEX "Registration_userId_idx" ON "Registration"("userId");

-- AddForeignKey
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_teamEventId_fkey" FOREIGN KEY ("teamEventId") REFERENCES "TeamEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RegistrationForm" ADD CONSTRAINT "RegistrationForm_organizationEventId_fkey" FOREIGN KEY ("organizationEventId") REFERENCES "OrganizationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_formId_fkey" FOREIGN KEY ("formId") REFERENCES "RegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
