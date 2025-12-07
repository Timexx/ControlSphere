-- Step 1: Make secretKeyHash NOT NULL (requires all machines to have secretKeyHash populated)
-- Run this AFTER migrate-secret-keys.js has been executed

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Machine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostname" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "osInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "secretKeyHash" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Copy all data (secretKey is intentionally omitted)
INSERT INTO "new_Machine" ("id", "hostname", "ip", "osInfo", "status", "lastSeen", "secretKeyHash", "notes", "createdAt", "updatedAt")
SELECT "id", "hostname", "ip", "osInfo", "status", "lastSeen", "secretKeyHash", "notes", "createdAt", "updatedAt" FROM "Machine";

DROP TABLE "Machine";
ALTER TABLE "new_Machine" RENAME TO "Machine";

-- Recreate indexes
CREATE UNIQUE INDEX "Machine_secretKeyHash_key" ON "Machine"("secretKeyHash");
CREATE INDEX "Machine_status_idx" ON "Machine"("status");
CREATE INDEX "Machine_lastSeen_idx" ON "Machine"("lastSeen");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
