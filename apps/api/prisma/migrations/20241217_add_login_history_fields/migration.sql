-- Add userAgent and fingerprint to LoginHistory
ALTER TABLE "LoginHistory" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "LoginHistory" ADD COLUMN "fingerprint" TEXT;
