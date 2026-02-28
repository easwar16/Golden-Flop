-- DropForeignKey
ALTER TABLE "GameResult" DROP CONSTRAINT "GameResult_winnerId_fkey";

-- AlterTable
ALTER TABLE "GameResult" ALTER COLUMN "winnerId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
