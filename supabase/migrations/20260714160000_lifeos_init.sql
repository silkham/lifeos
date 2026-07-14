-- LifeOS — cross-app hub. Lives in a dedicated `lifeos` schema inside the shared
-- `household` Supabase DB (Project A, ref dgbbyijhabjozqrkokrq), so it stays
-- isolated from the meal/workout/house_project apps that share this DB.
--
-- The publish/consume contract: each source app upserts a small set of "signals"
-- (metrics, tasks, nudges) into lifeos.signals. LifeOS reads them. RLS is gated on
-- public.household_memberships, so it shares the same household row as the other
-- Project-A apps (Strive, Lexie, Household) with no separate invite flow.
--
-- Project B (Investment, ref wqkhjbmsciuhwdqsdsni) gets an identical mirror table
-- in its own DB; LifeOS reads it with a second, read-only client and merges.

create schema if not exists lifeos;

-- ---------------------------------------------------------------------------
-- Helper: household ids the current auth user belongs to.
-- SECURITY DEFINER so policies don't depend on RLS/grants of household_memberships.
-- ---------------------------------------------------------------------------
create or replace function lifeos.my_household_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select household_id
  from public.household_memberships
  where user_id = auth.uid()
$$;

revoke all on function lifeos.my_household_ids() from public;
grant execute on function lifeos.my_household_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- signals — the whole integration contract in one table.
--   kind = 'metric' -> dashboard tile (glanceable, not actionable)
--        = 'task'    -> an action with a CTA deep-link + due date
--        = 'nudge'   -> a planning-radar prompt ("nothing planned Saturday")
-- Each source app owns its rows (app + key is stable, so re-publish upserts).
-- ---------------------------------------------------------------------------
create table lifeos.signals (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  app          text not null,          -- 'strive' | 'lexie' | 'household' | 'invest'
  kind         text not null default 'metric',
  key          text not null,          -- stable per-signal id within an app
  title        text not null,
  detail       text,
  value        numeric,                -- metrics: portfolio £, calories, net-vs-forecast
  unit         text,                   -- e.g. 'gbp' | 'kcal' | 'kg' | 'pct'
  trend        numeric,                -- optional signed delta for an up/down arrow
  state        text,                   -- 'good' | 'warn' | 'bad' — colour hint from source
  cta_url      text,                   -- deep link into the source app
  cta_label    text,
  due          date,                   -- tasks/nudges; null for metrics
  sort_order   int not null default 0,
  status       text not null default 'open',   -- 'open' | 'done' | 'dismissed'
  updated_at   timestamptz not null default now(),
  unique (household_id, app, key)
);

create index idx_lifeos_signals_household on lifeos.signals (household_id);

create or replace function lifeos.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_touch_signals on lifeos.signals;
create trigger trg_touch_signals before update on lifeos.signals
  for each row execute function lifeos.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Grants + RLS. supabase-js connects as `authenticated` for signed-in users.
-- ---------------------------------------------------------------------------
grant usage on schema lifeos to authenticated, anon;
grant all on all tables in schema lifeos to authenticated;
alter default privileges in schema lifeos grant all on tables to authenticated;

alter table lifeos.signals enable row level security;
drop policy if exists lo_rw on lifeos.signals;
create policy lo_rw on lifeos.signals
  using (household_id in (select lifeos.my_household_ids()))
  with check (household_id in (select lifeos.my_household_ids()));
