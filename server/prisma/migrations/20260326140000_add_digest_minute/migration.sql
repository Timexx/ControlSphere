-- AlterTable: add digestMinute to NotificationConfig
ALTER TABLE "NotificationConfig" ADD COLUMN "digestMinute" INTEGER NOT NULL DEFAULT 0;
