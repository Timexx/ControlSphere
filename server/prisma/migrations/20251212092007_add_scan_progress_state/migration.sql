-- CreateTable
CREATE TABLE "ScanProgressState" (
    "machineId" TEXT NOT NULL PRIMARY KEY,
    "progress" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "etaSeconds" INTEGER,
    "startedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScanProgressState_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
