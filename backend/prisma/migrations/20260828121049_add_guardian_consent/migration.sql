-- CreateEnum
CREATE TYPE "GuardianConsentStatus" AS ENUM ('not_required', 'pending', 'confirmed');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "guardianConsentAt" TIMESTAMP(3),
ADD COLUMN     "guardianConsentExpiry" TIMESTAMP(3),
ADD COLUMN     "guardianConsentStatus" "GuardianConsentStatus" NOT NULL DEFAULT 'not_required',
ADD COLUMN     "guardianConsentToken" TEXT,
ADD COLUMN     "guardianEmail" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_guardianConsentToken_key" ON "users"("guardianConsentToken");
