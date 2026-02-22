-- CreateTable
CREATE TABLE "ServerConfig" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "serverUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerConfig_pkey" PRIMARY KEY ("id")
);
