-- Error reporting (issue #469): Admin > Error reporting's settings.
CREATE TABLE "ErrorReportingSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "dsn" TEXT,
    "browsers" BOOLEAN,
    "environment" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorReportingSettings_pkey" PRIMARY KEY ("id")
);
