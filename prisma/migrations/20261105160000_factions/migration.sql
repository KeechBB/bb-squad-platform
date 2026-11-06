-- Фракции внутри клана BlackBerry.

CREATE TYPE "FactionSeat" AS ENUM ('LEADER', 'DEPUTY', 'MEMBER');

CREATE TABLE "Faction" (
  "id" TEXT NOT NULL,
  "clanId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "logoUrl" TEXT,
  "tgUrl" TEXT,
  "info" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Faction_slug_key" ON "Faction"("slug");
CREATE INDEX "Faction_clanId_idx" ON "Faction"("clanId");

ALTER TABLE "Faction"
  ADD CONSTRAINT "Faction_clanId_fkey"
  FOREIGN KEY ("clanId") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FactionRole" (
  "id" TEXT NOT NULL,
  "factionId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isDeputy" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactionRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FactionRole_factionId_name_key" ON "FactionRole"("factionId", "name");
CREATE INDEX "FactionRole_factionId_idx" ON "FactionRole"("factionId");

ALTER TABLE "FactionRole"
  ADD CONSTRAINT "FactionRole_factionId_fkey"
  FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FactionMember" (
  "id" TEXT NOT NULL,
  "factionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seat" "FactionSeat" NOT NULL DEFAULT 'MEMBER',
  "roleId" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactionMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FactionMember_userId_key" ON "FactionMember"("userId");
CREATE UNIQUE INDEX "FactionMember_factionId_userId_key" ON "FactionMember"("factionId", "userId");
CREATE INDEX "FactionMember_factionId_joinedAt_idx" ON "FactionMember"("factionId", "joinedAt");

ALTER TABLE "FactionMember"
  ADD CONSTRAINT "FactionMember_factionId_fkey"
  FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactionMember"
  ADD CONSTRAINT "FactionMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FactionMember"
  ADD CONSTRAINT "FactionMember_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "FactionRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
