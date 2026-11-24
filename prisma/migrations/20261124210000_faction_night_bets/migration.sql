-- CreateTable
CREATE TABLE IF NOT EXISTS "FactionNightBetWindow" (
    "id" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pot" INTEGER NOT NULL DEFAULT 0,
    "winnerFactionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionNightBetWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "FactionNightBet" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "fromFactionId" TEXT NOT NULL,
    "pickFactionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "placedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payout" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionNightBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FactionNightBet_windowId_fromFactionId_key" ON "FactionNightBet"("windowId", "fromFactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FactionNightBet_windowId_idx" ON "FactionNightBet"("windowId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FactionNightBet_pickFactionId_idx" ON "FactionNightBet"("pickFactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FactionNightBet_fromFactionId_idx" ON "FactionNightBet"("fromFactionId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "FactionNightBet" ADD CONSTRAINT "FactionNightBet_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "FactionNightBetWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FactionNightBet" ADD CONSTRAINT "FactionNightBet_fromFactionId_fkey" FOREIGN KEY ("fromFactionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FactionNightBet" ADD CONSTRAINT "FactionNightBet_pickFactionId_fkey" FOREIGN KEY ("pickFactionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FactionNightBet" ADD CONSTRAINT "FactionNightBet_placedByUserId_fkey" FOREIGN KEY ("placedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
