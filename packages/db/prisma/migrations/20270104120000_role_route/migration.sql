-- Route (issue #322): a role that changes what a set's screens draw - their layers and overlays - without presenting.
ALTER TABLE "Role" ADD COLUMN "canRoute" BOOLEAN NOT NULL DEFAULT false;
