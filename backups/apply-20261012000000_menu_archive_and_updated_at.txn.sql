BEGIN;

-- Adds soft-delete and updatedAt columns to MenuItem.
-- Run during an explicit maintenance window:
--   npx prisma migrate deploy
--   npx prisma generate
-- Backfill is not required: archivedAt defaults to NULL (active).

ALTER TABLE "MenuItem"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "MenuItem_archivedAt_idx" ON "MenuItem"("archivedAt");


INSERT INTO "_prisma_migrations" (
    "id", "checksum", "migration_name", "finished_at",
    "applied_steps_count", "started_at"
) VALUES (
    'cmv4cgt5y4a60502e0c945aba22cd34a4'::text,
    '362938995e1adbfcc6f3767b4f4c66af14fccfce3342bc08cc68b3e98a4a8210',
    '20261012000000_menu_archive_and_updated_at',
    NOW(),
    1,
    NOW()
);

COMMIT;
