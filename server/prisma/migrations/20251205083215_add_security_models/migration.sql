-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machineId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VMPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manager" TEXT,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "cveIds" TEXT,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanId" TEXT,
    CONSTRAINT "VMPackage_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VMPackage_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "PackageScan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackageScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machineId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackageScan_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecurityPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "policyType" TEXT NOT NULL DEFAULT 'config',
    "expectedHash" TEXT,
    "expectedContent" TEXT,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "mode" TEXT NOT NULL DEFAULT 'observe',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PolicyAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyAssignment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SecurityPolicy" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PolicyAssignment_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machineId" TEXT NOT NULL,
    "policyId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "message" TEXT NOT NULL,
    "data" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SecurityEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SecurityEvent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SecurityPolicy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AuditLog_machineId_createdAt_idx" ON "AuditLog"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "VMPackage_machineId_status_idx" ON "VMPackage"("machineId", "status");

-- CreateIndex
CREATE INDEX "VMPackage_machineId_lastSeen_idx" ON "VMPackage"("machineId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "VMPackage_machineId_name_key" ON "VMPackage"("machineId", "name");

-- CreateIndex
CREATE INDEX "PackageScan_machineId_createdAt_idx" ON "PackageScan"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityPolicy_policyType_idx" ON "SecurityPolicy"("policyType");

-- CreateIndex
CREATE INDEX "SecurityPolicy_targetPath_idx" ON "SecurityPolicy"("targetPath");

-- CreateIndex
CREATE INDEX "PolicyAssignment_machineId_idx" ON "PolicyAssignment"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyAssignment_policyId_machineId_key" ON "PolicyAssignment"("policyId", "machineId");

-- CreateIndex
CREATE INDEX "SecurityEvent_machineId_status_idx" ON "SecurityEvent"("machineId", "status");

-- CreateIndex
CREATE INDEX "SecurityEvent_machineId_createdAt_idx" ON "SecurityEvent"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_policyId_idx" ON "SecurityEvent"("policyId");
