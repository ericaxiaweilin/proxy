-- HANDLE-UNIQUE-001: handle uniqueness was only ever claimed in a comment.
--
-- 039_profile.sql created a PLAIN index on handle (idx_profiles_handle), never
-- a unique one, and neither repository checked for a conflict — while
-- initialProfileFor derives the handle from the email local-part, so
-- linh@gmail.com and linh@outlook.com reliably both ended up with @linh. A
-- profile QR / invite link is proxy.app/@linh and the client parser matches it
-- case-insensitively, so an ambiguous handle means scanning one person's code
-- can add a different person.
--
-- Case- and @-insensitive on purpose: '@Linh', 'linh' and '@linh' are the same
-- destination for the parser, so they must be the same row here.
--
-- THIS MIGRATION AUDITS BEFORE IT CONSTRAINS. If duplicates exist, a bare
-- CREATE UNIQUE INDEX fails with "could not create unique index", which tells
-- an operator nothing about what to clean up or how much of it there is.
-- Instead we raise first, naming the offending handles and their row counts,
-- and stop. Nothing is deleted and no handle is rewritten automatically:
-- which account keeps @linh is a product decision, not a migration's.

DO $$
DECLARE
    dup_groups integer;
    dup_list   text;
BEGIN
    SELECT count(*), string_agg(format('%s x%s', norm, n), ', ' ORDER BY n DESC, norm)
      INTO dup_groups, dup_list
      FROM (
        SELECT lower(ltrim(handle, '@')) AS norm, count(*) AS n
          FROM identity.profiles
         GROUP BY 1
        HAVING count(*) > 1
      ) d;

    IF dup_groups > 0 THEN
        RAISE EXCEPTION
            'HANDLE-UNIQUE-001: % duplicate handle group(s) block the unique index. Resolve these first (rename all but one row each, via UpdateProfile or a reviewed data fix), then re-run: %',
            dup_groups, dup_list;
    END IF;
END $$;

-- The plain index is superseded by the unique one below; keeping both would
-- leave a redundant index on the same expression.
DROP INDEX IF EXISTS identity.idx_profiles_handle;

-- The one index that makes the invariant real. Every read path
-- (GetProfileByHandle) and every write path (UpsertProfile) compares this same
-- normalized form, so a collision surfaces as a 23505 that the repository
-- translates into ErrProfileHandleTaken.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_unique
    ON identity.profiles (lower(ltrim(handle, '@')));
