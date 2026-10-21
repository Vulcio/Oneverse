-- Screens operators (issue #305): a role that controls what sets' screens present.
ALTER TABLE "Role" ADD COLUMN "canOperateScreens" BOOLEAN NOT NULL DEFAULT false;
