-- CreateEnum
CREATE TYPE "QuizDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "difficulty" "QuizDifficulty",
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "quizzes_published_idx" ON "quizzes"("published");


-- Backfill: every quiz that exists today was created before drafts existed,
-- so it was live. Without this the new column's default would quietly turn
-- them all into drafts.
UPDATE "quizzes" SET "published" = true;
