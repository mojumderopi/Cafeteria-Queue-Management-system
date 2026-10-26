-- Adds soft-delete and updatedAt columns to MenuItem.
-- Run during an explicit maintenance window:
--   npx prisma migrate deploy
--   npx prisma generate
-- Backfill is not required: archivedAt defaults to NULL (active).

ALTER TABLE "MenuItem"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "MenuItem_archivedAt_idx" ON "MenuItem"("archivedAt");
