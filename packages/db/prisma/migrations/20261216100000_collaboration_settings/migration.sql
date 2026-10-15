-- Live co-editing (issue #27): off unless Admin > Collaboration (or LIVE_CO_EDITING) turns it on.
CREATE TABLE "CollaborationSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "liveCoEditing" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollaborationSettings_pkey" PRIMARY KEY ("id")
);
