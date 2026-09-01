-- Runtime app role may read/write module snapshots but cannot alter schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proxy') THEN
    GRANT USAGE ON SCHEMA runtime TO proxy;
    GRANT SELECT, INSERT, UPDATE, DELETE ON runtime.module_state TO proxy;
  END IF;
END $$;
