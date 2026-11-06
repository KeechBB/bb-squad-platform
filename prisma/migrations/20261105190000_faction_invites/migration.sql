-- Приглашение во фракцию ждёт ответа в колокольчике.

CREATE TYPE "FactionInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE "FactionInvite" (
  "id" TEXT NOT NULL,
  "factionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "invitedBy" TEXT NOT NULL,
  "status" "FactionInviteStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactionInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FactionInvite_userId_status_idx" ON "FactionInvite"("userId", "status");
CREATE INDEX "FactionInvite_factionId_status_idx" ON "FactionInvite"("factionId", "status");

ALTER TABLE "FactionInvite"
  ADD CONSTRAINT "FactionInvite_factionId_fkey"
  FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactionInvite"
  ADD CONSTRAINT "FactionInvite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactionInvite"
  ADD CONSTRAINT "FactionInvite_invitedBy_fkey"
  FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
