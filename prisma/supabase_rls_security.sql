-- ============================================================================
-- EARN STREET - ZERO-LEAK ROW LEVEL SECURITY (RLS) HARDENING MIGRATION
-- Enforces strict RLS on every table in the public schema and revokes direct
-- PostgREST client access (anon / authenticated roles) while preserving full
-- server-side access for the backend Prisma service connection.
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon;', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated;', t);
    END IF;
  END LOOP;
END $$;
