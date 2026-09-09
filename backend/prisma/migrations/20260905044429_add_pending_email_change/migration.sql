-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pendingEmail" TEXT,
ADD COLUMN     "pendingEmailExpiry" TIMESTAMP(3),
ADD COLUMN     "pendingEmailToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_pendingEmailToken_key" ON "users"("pendingEmailToken");

