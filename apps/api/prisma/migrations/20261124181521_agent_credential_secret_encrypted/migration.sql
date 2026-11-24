/*
  Warnings:

  - You are about to drop the column `secretHash` on the `AgentCredential` table. All the data in the column will be lost.
  - Added the required column `secretEncrypted` to the `AgentCredential` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AgentCredential" DROP COLUMN "secretHash",
ADD COLUMN     "secretEncrypted" TEXT NOT NULL;
