-- A widget's default look (issue #273): a person's own or a team's.
CREATE TABLE "ScreenWidgetDefault" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "look" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "ownerTeamId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenWidgetDefault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScreenWidgetDefault_ownerUserId_kind_key" ON "ScreenWidgetDefault"("ownerUserId", "kind");
CREATE UNIQUE INDEX "ScreenWidgetDefault_ownerTeamId_kind_key" ON "ScreenWidgetDefault"("ownerTeamId", "kind");

ALTER TABLE "ScreenWidgetDefault" ADD CONSTRAINT "ScreenWidgetDefault_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScreenWidgetDefault" ADD CONSTRAINT "ScreenWidgetDefault_ownerTeamId_fkey" FOREIGN KEY ("ownerTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
