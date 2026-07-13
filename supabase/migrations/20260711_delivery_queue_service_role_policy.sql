-- delivery_queue already has RLS enabled (confirmed via
-- pg_class.relrowsecurity). This policy makes the intended
-- access model explicit: only the service-role key can read/write
-- this table. Previously, zero policies existed, meaning anon-key
-- access was implicitly denied by RLS default-deny — this makes
-- that explicit and auditable rather than relying on absence of
-- a policy.

CREATE POLICY "service_role_only" ON delivery_queue
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
