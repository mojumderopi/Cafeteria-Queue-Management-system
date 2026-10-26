-- Phase 1: introduce the Provider entity.
--
-- Goal: every Counter now belongs to exactly one Provider. The two
-- existing counters ("canteen-a" and "canteen-b") are each given a
-- dedicated provider so the multi-provider model is in place from the
-- start without breaking any existing data.
--
-- Safety properties:
--   * Idempotent on retry: every step uses IF NOT EXISTS / ON CONFLICT
--     so a partial run (or an accidental second run) is a no-op.
--   * No dependency on the still-pending 20261012000000 migration.
--     This file only adds new objects and a new nullable column.
--   * The Provider.id values are deterministic (md5(slug)) so the
--     backfill is self-contained and reviewable in SQL alone.
--   * Counter.providerId is made NOT NULL at the end, after every
--     existing row has a value.
--   * ON DELETE RESTRICT on the FK prevents a provider from being
--     deleted while it still owns counters (matches the existing
--     Order.counterId convention).
--
-- IMPORTANT: do NOT run this file by hand. It is intended for
--   npx prisma migrate deploy
-- during an explicit maintenance window after the still-pending
-- 20261012000000_menu_archive_and_updated_at migration has been
-- applied (or alongside it, since this file is independent).

-- 1. Create the Provider table. IF NOT EXISTS keeps retries safe.
CREATE TABLE IF NOT EXISTS "Provider" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- 2. Globally unique provider slug.
CREATE UNIQUE INDEX IF NOT EXISTS "Provider_slug_key" ON "Provider"("slug");

-- 3. Add the nullable providerId column on Counter. We add it as
--    nullable first so the backfill in step 4 can run before we
--    enforce NOT NULL. IF NOT EXISTS makes this safe to re-run.
ALTER TABLE "Counter"
    ADD COLUMN IF NOT EXISTS "providerId" TEXT;

-- 4. Add an index on Counter.providerId. Will be useful for every
--    "list counters for provider X" query, including the
--    provider-scoped analytics work in later phases.
CREATE INDEX IF NOT EXISTS "Counter_providerId_idx" ON "Counter"("providerId");

-- 5. Backfill one provider per existing counter. The provider ID is
--    derived deterministically from the counter slug so the migration
--    is self-contained and reviewable. ON CONFLICT DO NOTHING makes
--    a re-run safe (the second run sees the existing rows and skips).
INSERT INTO "Provider" ("id", "slug", "name", "createdAt", "updatedAt")
SELECT
    'prov_' || md5(c.slug)                                    AS id,
    'prov-' || c.slug                                        AS slug,
    c.name                                                   AS name,
    CURRENT_TIMESTAMP                                        AS "createdAt",
    CURRENT_TIMESTAMP                                        AS "updatedAt"
FROM "Counter" c
WHERE NOT EXISTS (
    SELECT 1 FROM "Provider" p WHERE p.id = 'prov_' || md5(c.slug)
)
ON CONFLICT ("id") DO NOTHING;

-- 6. Populate Counter.providerId for every row using the matching
--    provider. A counter's slug is unique, so this is a clean 1:1
--    update. We use the same deterministic id expression so this step
--    is also safe to re-run.
UPDATE "Counter" c
SET "providerId" = 'prov_' || md5(c.slug)
WHERE c."providerId" IS NULL;

-- 7. Enforce NOT NULL on Counter.providerId. The table guard means
--    this ALTER is a no-op on a re-run. The previous step guarantees
--    no NULLs remain, so the constraint is satisfied.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Counter'
          AND column_name = 'providerId'
          AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE "Counter"
            ALTER COLUMN "providerId" SET NOT NULL;
    END IF;
END $$;

-- 8. Add the updatedAt column on Counter. We add it as NOT NULL with
--    a default so existing rows get a sane value. This mirrors the
--    pattern used by the 20261012000000 migration for MenuItem.
ALTER TABLE "Counter"
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 9. Add the foreign key. ON DELETE RESTRICT prevents a provider from
--    being deleted while it still owns counters, matching the
--    Order.counterId convention. IF NOT EXISTS is not supported for
--    FK constraints in PostgreSQL, so we guard the addition with a
--    DO block that checks pg_constraint.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Counter_providerId_fkey'
    ) THEN
        ALTER TABLE "Counter"
            ADD CONSTRAINT "Counter_providerId_fkey"
            FOREIGN KEY ("providerId") REFERENCES "Provider"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
