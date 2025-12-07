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
    "secretKey" TEXT,
    "secretKeyHash" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Machine" ("createdAt", "hostname", "id", "ip", "lastSeen", "notes", "osInfo", "secretKeyHash", "status", "updatedAt") SELECT "createdAt", "hostname", "id", "ip", "lastSeen", "notes", "osInfo", "secretKeyHash", "status", "updatedAt" FROM "Machine";
DROP TABLE "Machine";
ALTER TABLE "new_Machine" RENAME TO "Machine";
CREATE UNIQUE INDEX "Machine_secretKey_key" ON "Machine"("secretKey");
CREATE UNIQUE INDEX "Machine_secretKeyHash_key" ON "Machine"("secretKeyHash");
CREATE INDEX "Machine_status_idx" ON "Machine"("status");
CREATE INDEX "Machine_lastSeen_idx" ON "Machine"("lastSeen");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
