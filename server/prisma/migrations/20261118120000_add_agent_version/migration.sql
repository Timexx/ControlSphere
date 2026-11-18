-- AlterTable: add agent version and architecture to Machine (nullable = unknown for old agents)
ALTER TABLE "Machine" ADD COLUMN "agentVersion" TEXT,
ADD COLUMN "agentArch" TEXT;
