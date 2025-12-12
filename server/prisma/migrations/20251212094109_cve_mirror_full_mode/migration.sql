-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CveMirrorState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "lastSync" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'full',
    "ecosystems" TEXT,
    "totalCves" INTEGER
);
INSERT INTO "new_CveMirrorState" ("error", "id", "lastSync", "status") SELECT "error", "id", "lastSync", "status" FROM "CveMirrorState";
DROP TABLE "CveMirrorState";
ALTER TABLE "new_CveMirrorState" RENAME TO "CveMirrorState";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Cve_severity_idx" ON "Cve"("severity");

-- CreateIndex
CREATE INDEX "Cve_publishedAt_idx" ON "Cve"("publishedAt");
