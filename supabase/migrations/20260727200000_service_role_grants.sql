-- Grant the backend service role access to the lifeos schema.
--
-- The init migration granted only `authenticated` and `anon`, because every
-- adapter published client-side from the browser. Stride's `lifeos-med-refresh`
-- Edge Function is the first SERVER-side publisher (a once-daily medication has
-- to be right on the hub even when nobody has opened the source app), and it
-- runs with SUPABASE_SERVICE_ROLE_KEY. service_role bypasses RLS but still needs
-- ordinary schema/table privileges — without these it gets
-- `42501 permission denied for schema lifeos`.
--
-- This widens nothing for anon or authenticated: service_role is the trusted
-- backend key that already has the equivalent on `public`, and it is never
-- shipped to a client. Reversible with the matching REVOKEs.

grant usage on schema lifeos to service_role;
grant all on all tables in schema lifeos to service_role;
alter default privileges in schema lifeos grant all on tables to service_role;
