-- An organisation's limits on what goes into its own bucket (issue #206).
ALTER TABLE "OrganizationStorage" ADD COLUMN "teamLimitMb" INTEGER,
ADD COLUMN "memberLimitMb" INTEGER,
ADD COLUMN "maxFileMb" INTEGER;
