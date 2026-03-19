-- AlterTable
ALTER TABLE "ServerConfig" ADD COLUMN "autoCheckUpdates" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ServerConfig" ADD COLUMN "updateDismissedSha" TEXT;
