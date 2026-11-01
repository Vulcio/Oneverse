-- Plugins (issue #157): built-in plugins' state, and the Song provider plugin's servers.
CREATE TABLE "Plugin" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Plugin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SongProviderSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiUrl" TEXT NOT NULL,
    "apiKeyEnc" TEXT,
    "allowPrivate" BOOLEAN NOT NULL DEFAULT false,
    "hooks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "provides" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SongProviderSource_pkey" PRIMARY KEY ("id")
);
