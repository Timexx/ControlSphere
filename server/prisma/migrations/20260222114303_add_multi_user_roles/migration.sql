-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "createdBy" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'user';

-- CreateTable
CREATE TABLE "UserMachineAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT NOT NULL,

    CONSTRAINT "UserMachineAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMachineAccess_userId_idx" ON "UserMachineAccess"("userId");

-- CreateIndex
CREATE INDEX "UserMachineAccess_machineId_idx" ON "UserMachineAccess"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMachineAccess_userId_machineId_key" ON "UserMachineAccess"("userId", "machineId");

-- AddForeignKey
ALTER TABLE "UserMachineAccess" ADD CONSTRAINT "UserMachineAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMachineAccess" ADD CONSTRAINT "UserMachineAccess_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
