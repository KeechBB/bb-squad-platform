-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dayOffUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dayOffReason" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DayOffStint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "untilAt" TIMESTAMP(3) NOT NULL,
    "exitedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'self',
    "enteredById" TEXT,
    "exitedById" TEXT,

    CONSTRAINT "DayOffStint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DayOffStint_userId_enteredAt_idx" ON "DayOffStint"("userId", "enteredAt");
CREATE INDEX IF NOT EXISTS "DayOffStint_exitedAt_idx" ON "DayOffStint"("exitedAt");
CREATE INDEX IF NOT EXISTS "DayOffStint_untilAt_idx" ON "DayOffStint"("untilAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DayOffStint" ADD CONSTRAINT "DayOffStint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DayOffStint" ADD CONSTRAINT "DayOffStint_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DayOffStint" ADD CONSTRAINT "DayOffStint_exitedById_fkey" FOREIGN KEY ("exitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
