-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "language" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "osInfo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "secretKey" TEXT,
    "secretKeyHash" TEXT,
    "secretVersion" INTEGER NOT NULL DEFAULT 1,
    "secretRotatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "cpuUsage" DOUBLE PRECISION NOT NULL,
    "ramUsage" DOUBLE PRECISION NOT NULL,
    "ramTotal" DOUBLE PRECISION NOT NULL,
    "ramUsed" DOUBLE PRECISION NOT NULL,
    "diskUsage" DOUBLE PRECISION NOT NULL,
    "diskTotal" DOUBLE PRECISION NOT NULL,
    "diskUsed" DOUBLE PRECISION NOT NULL,
    "uptime" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Command" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "output" TEXT,
    "exitCode" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineTag" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Port" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "proto" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Port_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineLink" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'static',
    "query" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "command" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'parallel',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "targetType" TEXT NOT NULL DEFAULT 'adhoc',
    "groupId" TEXT,
    "targetQuery" TEXT,
    "strategy" TEXT,
    "totalTargets" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobExecution" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "output" TEXT,
    "exitCode" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "machineId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "eventType" TEXT,
    "details" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VMPackage" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manager" TEXT,
    "status" TEXT NOT NULL DEFAULT 'installed',
    "cveIds" TEXT,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanId" TEXT,

    CONSTRAINT "VMPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageScan" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanProgressState" (
    "machineId" TEXT NOT NULL,
    "progress" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "etaSeconds" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanProgressState_pkey" PRIMARY KEY ("machineId")
);

-- CreateTable
CREATE TABLE "SecurityPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "policyType" TEXT NOT NULL DEFAULT 'config',
    "expectedHash" TEXT,
    "expectedContent" TEXT,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "mode" TEXT NOT NULL DEFAULT 'observe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyAssignment" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "policyId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "message" TEXT NOT NULL,
    "data" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cve" (
    "id" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "affected" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VulnerabilityMatch" (
    "id" TEXT NOT NULL,
    "cveId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VulnerabilityMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CveMirrorState" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "lastSync" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'full',
    "ecosystems" TEXT,
    "totalCves" INTEGER,

    CONSTRAINT "CveMirrorState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_secretKey_key" ON "Machine"("secretKey");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_secretKeyHash_key" ON "Machine"("secretKeyHash");

-- CreateIndex
CREATE INDEX "Machine_status_idx" ON "Machine"("status");

-- CreateIndex
CREATE INDEX "Machine_lastSeen_idx" ON "Machine"("lastSeen");

-- CreateIndex
CREATE INDEX "Metric_machineId_timestamp_idx" ON "Metric"("machineId", "timestamp");

-- CreateIndex
CREATE INDEX "Command_machineId_createdAt_idx" ON "Command"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "MachineTag_machineId_idx" ON "MachineTag"("machineId");

-- CreateIndex
CREATE INDEX "MachineTag_key_value_idx" ON "MachineTag"("key", "value");

-- CreateIndex
CREATE INDEX "Port_machineId_idx" ON "Port"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "Port_machineId_port_proto_key" ON "Port"("machineId", "port", "proto");

-- CreateIndex
CREATE INDEX "MachineLink_machineId_createdAt_idx" ON "MachineLink"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "GroupMember_machineId_idx" ON "GroupMember"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_machineId_key" ON "GroupMember"("groupId", "machineId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- CreateIndex
CREATE INDEX "JobExecution_jobId_idx" ON "JobExecution"("jobId");

-- CreateIndex
CREATE INDEX "JobExecution_machineId_idx" ON "JobExecution"("machineId");

-- CreateIndex
CREATE INDEX "AuditLog_machineId_createdAt_idx" ON "AuditLog"("machineId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_eventType_idx" ON "AuditLog"("eventType");

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

-- CreateIndex
CREATE INDEX "Cve_id_idx" ON "Cve"("id");

-- CreateIndex
CREATE INDEX "Cve_severity_idx" ON "Cve"("severity");

-- CreateIndex
CREATE INDEX "Cve_publishedAt_idx" ON "Cve"("publishedAt");

-- CreateIndex
CREATE INDEX "VulnerabilityMatch_machineId_idx" ON "VulnerabilityMatch"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "VulnerabilityMatch_cveId_packageId_key" ON "VulnerabilityMatch"("cveId", "packageId");

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Command" ADD CONSTRAINT "Command_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineTag" ADD CONSTRAINT "MachineTag_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Port" ADD CONSTRAINT "Port_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineLink" ADD CONSTRAINT "MachineLink_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobExecution" ADD CONSTRAINT "JobExecution_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobExecution" ADD CONSTRAINT "JobExecution_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMPackage" ADD CONSTRAINT "VMPackage_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VMPackage" ADD CONSTRAINT "VMPackage_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "PackageScan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageScan" ADD CONSTRAINT "PackageScan_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanProgressState" ADD CONSTRAINT "ScanProgressState_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SecurityPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyAssignment" ADD CONSTRAINT "PolicyAssignment_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SecurityPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityMatch" ADD CONSTRAINT "VulnerabilityMatch_cveId_fkey" FOREIGN KEY ("cveId") REFERENCES "Cve"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityMatch" ADD CONSTRAINT "VulnerabilityMatch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "VMPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VulnerabilityMatch" ADD CONSTRAINT "VulnerabilityMatch_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
