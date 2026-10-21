-- Bibles' settings: YouVersion's App Key (issue #304).
CREATE TABLE "ScriptureSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "youversionAppKeyEnc" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScriptureSettings_pkey" PRIMARY KEY ("id")
);
