-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "pointsEarned" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_userId_quizId_startedAt_key" ON "quiz_attempts"("userId", "quizId", "startedAt");

