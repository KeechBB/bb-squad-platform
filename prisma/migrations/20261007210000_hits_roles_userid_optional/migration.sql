-- Allow log-based hits/roles for unregistered opponents (DCAI etc.) on TR1/TR2.
ALTER TABLE "SquadHitEvent" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "SquadRoleEvent" ALTER COLUMN "userId" DROP NOT NULL;
