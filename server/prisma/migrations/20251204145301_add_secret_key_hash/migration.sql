/*
  Warnings:

  - You are about to drop the column `secretKey` on the `Machine` table. All the data in the column will be lost.
  - Added the required column `secretKeyHash` to the `Machine` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Step 1: Add secretKeyHash column as nullable
ALTER TABLE "Machine" ADD COLUMN "secretKeyHash" TEXT;

-- Step 2: Populate secretKeyHash with hashed values of secretKey
-- Note: SQLite doesn't have built-in SHA256, so we'll handle this in a separate data migration script
-- For now, we'll just prepare the column structure

-- Step 3: After data migration (run migrate-secret-keys.js), make secretKeyHash required
-- This will be done in a follow-up migration or manually after data migration

-- Step 4: Drop the old secretKey column (will be done after data migration is complete)
-- DROP INDEX "Machine_secretKey_key";
-- ALTER TABLE "Machine" DROP COLUMN "secretKey";

