-- CreateTable
CREATE TABLE "Cve" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT,
    "severity" TEXT NOT NULL,
    "score" REAL,
    "publishedAt" DATETIME NOT NULL,
    "affected" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VulnerabilityMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cveId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VulnerabilityMatch_cveId_fkey" FOREIGN KEY ("cveId") REFERENCES "Cve" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VulnerabilityMatch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "VMPackage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VulnerabilityMatch_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CveMirrorState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "lastSync" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "Cve_id_idx" ON "Cve"("id");

-- CreateIndex
CREATE INDEX "VulnerabilityMatch_machineId_idx" ON "VulnerabilityMatch"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "VulnerabilityMatch_cveId_packageId_key" ON "VulnerabilityMatch"("cveId", "packageId");
