-- Database-level security hardening for Transformer DNA.
--
-- PREFER THE SCRIPT: npx tsx scripts/apply-security-hardening.mts
-- It applies exactly this, needs no psql, skips what does not apply to your
-- database, and then PROVES the result by attempting a tamper and a delete.
-- This file exists for a DBA who wants to read or apply the statements by hand.
--
--
-- WHY THE TRIGGERS ARE THE CONTROL, NOT THE GRANTS
--
-- PostgreSQL does not apply table privileges to a table's OWNER. On Neon the
-- single role you are given owns every table, so REVOKE UPDATE, DELETE against
-- it is accepted and then ignored — the file runs clean, reports success, and
-- changes nothing. A trigger applies to everybody including the owner, so that
-- is what actually holds. The grants below matter only once KPLC moves the
-- application onto its own non-owner role.
--
--
-- WHY THESE TABLES ARE APPEND-ONLY BUT NOT FULLY FROZEN
--
-- Two legitimate writes touch these rows after insert, and blocking them would
-- have broken working features:
--
--   LifecycleEvent.linkedEventId — the replace flow closes the cross-reference
--   both ways so the old unit's story reads "replaced by ...". It is not part
--   of the chain hash.
--
--   SecurityEvent location/country/city/isp — geolocation is resolved after
--   the event is written, deliberately, so a third-party lookup never sits
--   inside the sign-in path.
--
-- Those columns may go from NULL to a value exactly once. Everything else in
-- the row is frozen at insert and DELETE is refused outright.


-- 1. The guard function.
--
-- Compares the row as jsonb with the permitted columns removed, so it protects
-- every column including any added by a future migration. A hand-written list
-- of columns to compare would silently stop covering whatever came next.
CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger AS $BODY$
DECLARE
  allowed text[] := COALESCE(TG_ARGV[0], '{}')::text[];
  old_rest jsonb;
  new_rest jsonb;
  col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Table % is append-only. Rows may not be deleted.', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  old_rest := to_jsonb(OLD);
  new_rest := to_jsonb(NEW);

  FOREACH col IN ARRAY allowed LOOP
    IF (old_rest -> col) IS DISTINCT FROM (new_rest -> col)
       AND jsonb_typeof(old_rest -> col) <> 'null' THEN
      RAISE EXCEPTION 'Table % is append-only. Column "%" was already set and may not be changed.',
        TG_TABLE_NAME, col USING ERRCODE = 'check_violation';
    END IF;
    old_rest := old_rest - col;
    new_rest := new_rest - col;
  END LOOP;

  IF old_rest IS DISTINCT FROM new_rest THEN
    RAISE EXCEPTION 'Table % is append-only. Only these columns may be filled in after insert: %.',
      TG_TABLE_NAME, COALESCE(array_to_string(allowed, ', '), 'none')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;


-- 2. The triggers.
DROP TRIGGER IF EXISTS securityevent_immutable ON "SecurityEvent";
CREATE TRIGGER securityevent_immutable
  BEFORE UPDATE OR DELETE ON "SecurityEvent"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation('{location,country,city,isp}');

DROP TRIGGER IF EXISTS auditlog_immutable ON "AuditLog";
CREATE TRIGGER auditlog_immutable
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation('{}');

DROP TRIGGER IF EXISTS lifecycleevent_immutable ON "LifecycleEvent";
CREATE TRIGGER lifecycleevent_immutable
  BEFORE UPDATE OR DELETE ON "LifecycleEvent"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation('{linkedEventId}');


-- 3. Privilege layer. Only meaningful once the application connects as a role
--    that does NOT own these tables. On Neon today this is a no-op.
--
--    CREATE ROLE transformer_app LOGIN PASSWORD '...';
--    GRANT CONNECT ON DATABASE <db> TO transformer_app;
--    GRANT USAGE ON SCHEMA public TO transformer_app;
--    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO transformer_app;
--    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO transformer_app;
--
-- REVOKE DELETE ON "SecurityEvent"  FROM transformer_app;
-- REVOKE DELETE ON "AuditLog"       FROM transformer_app;
-- REVOKE DELETE ON "LifecycleEvent" FROM transformer_app;


-- 4. Verify. Both statements must FAIL with "is append-only".
--
--    UPDATE "AuditLog" SET action = action || '-tampered'
--    WHERE id = (SELECT id FROM "AuditLog" LIMIT 1);
--
--    DELETE FROM "AuditLog" WHERE id = (SELECT id FROM "AuditLog" LIMIT 1);


-- 5. Retention. Immutable and unbounded are different problems: an append-only
--    table nobody prunes eventually fills the disk, which is its own outage.
--    Deletion is reserved to the owner and should be scheduled, not granted to
--    the application. HIGH and CRITICAL rows are kept — those are the ones
--    somebody asks about a year later.
--
--    ALTER TABLE "SecurityEvent" DISABLE TRIGGER securityevent_immutable;
--    DELETE FROM "SecurityEvent"
--    WHERE "createdAt" < now() - interval '180 days'
--      AND severity IN ('LOW', 'MEDIUM');
--    ALTER TABLE "SecurityEvent" ENABLE TRIGGER securityevent_immutable;
