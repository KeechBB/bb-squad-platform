-- AlterTable
ALTER TABLE "Clan" ADD COLUMN IF NOT EXISTS "isExternal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClanPendingMember" (
    "id" TEXT NOT NULL,
    "clanId" TEXT NOT NULL,
    "nick" TEXT NOT NULL,
    "nickKey" TEXT NOT NULL,
    "steamId" TEXT,
    "matchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClanPendingMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClanPendingMember_clanId_nickKey_key" ON "ClanPendingMember"("clanId", "nickKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClanPendingMember_steamId_idx" ON "ClanPendingMember"("steamId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClanPendingMember_nickKey_idx" ON "ClanPendingMember"("nickKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClanPendingMember_clanId_idx" ON "ClanPendingMember"("clanId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ClanPendingMember" ADD CONSTRAINT "ClanPendingMember_clanId_fkey"
    FOREIGN KEY ("clanId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
