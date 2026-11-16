-- Email by SMTP beside Resend (issue #38)
ALTER TABLE "AuthSettings" ADD COLUMN "emailProvider" TEXT,
ADD COLUMN "smtpHost" TEXT,
ADD COLUMN "smtpPort" INTEGER,
ADD COLUMN "smtpSecure" BOOLEAN,
ADD COLUMN "smtpUser" TEXT,
ADD COLUMN "smtpPasswordEnc" TEXT;
