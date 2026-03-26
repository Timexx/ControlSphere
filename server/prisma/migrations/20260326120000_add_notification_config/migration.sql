-- CreateTable
CREATE TABLE "NotificationConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "smtpHost" TEXT,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUsername" TEXT,
    "smtpPassword" TEXT,
    "smtpFromEmail" TEXT,
    "smtpFromName" TEXT NOT NULL DEFAULT 'ControlSphere',
    "smtpTls" BOOLEAN NOT NULL DEFAULT true,
    "smtpVerifyCert" BOOLEAN NOT NULL DEFAULT true,
    "recipientEmails" TEXT NOT NULL DEFAULT '',
    "eventSettings" TEXT NOT NULL DEFAULT '{}',
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "digestHour" INTEGER NOT NULL DEFAULT 8,
    "digestDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "machineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);
