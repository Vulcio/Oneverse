-- No just-in-time compilation for this database's queries (issue #341).
-- The library's queries (songs someone can see, among 50,000) are planned
-- as costly enough to compile, which took 400 ms each time for a query
-- that runs in 20. Short queries like these don't gain from it. Taken on
-- new connections; skipped, with a notice, where the database's user
-- may not change it (then: ALTER DATABASE ... SET jit = off, by its owner).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'jit left on: % may not change the database''s settings', current_user;
END
$$;
