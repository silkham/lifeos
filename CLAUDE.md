# LifeOS — the cross-app hub

> One screen that answers "what do I need to do today, and what's coming that I haven't planned?" — pulling from four separate life apps.

## What this is

A single-file-style PWA (vanilla JS ES modules, no build step, Tailwind-free — hand-rolled CSS matching the family aesthetic). It is a **read-mostly hub**: it does not own domain data. Each source app **publishes signals**; LifeOS merges and renders them.

The four source apps:
- **Strive** (Fitness) — workouts, weight, calorie/food logging
- **Lexie** (Lexie & Me) — daughter activity planning
- **Household** (House Poject) — home finance / cashflow forecast
- **Invest** (Investing) — portfolio tracking

## The integration contract (the whole design)

Each app upserts rows into a `lifeos.signals` table. LifeOS only reads them. Three `kind`s:
- **`metric`** → a glanceable dashboard tile (weight, calories, spend-vs-forecast, portfolio £).
- **`task`** → a to-do with a `cta_url` deep-link into the source app + a `due` date. This now also carries the **7-day calendar** rows (see next section).
- **`nudge`** → *(legacy — the old "planning radar"; the calendar replaced it. `dashboard.js` no longer renders nudges. Old `nothing-planned-*` / `workout-tomorrow` rows may linger in the table, harmless/invisible.)*

The CTA deep-links into the source app; **the source app owns the truth and flips `status`** to `done`/`dismissed`. LifeOS reflects it. LifeOS never reaches into any app's own schema — only the `signals` contract. Table shape: see `supabase/migrations/20260714160000_lifeos_init.sql`.

`(household_id, app, key)` is unique → re-publishing upserts (no duplicates). `key` is a stable per-signal id chosen by each adapter.

**LANDMINE — the republish-overwrite race (fixed 2026-07-19, Fitness v4.14.1 / Lexie build 17).** The every-boot republish is **last-writer-wins** over `(household_id, app, key)`. It is only safe if the publishing device holds the *complete, authoritative* state at publish time. A device that publishes an empty/partial snapshot (fresh localStorage, cloud fetch not yet done, or the wrong active-member resolved) **clobbers the good signals another device wrote** — and the self-cleaning "empty day → `dismissed`" makes calendar wipes silent. Two invariants every adapter must hold: **(1) publish only *after* the source app's own cloud data has fully loaded** (Fitness bug: `loadMealLogs` ran before `activeMemberId` was resolved → wrong member → wrong calories). **(2) never publish an all-empty snapshot unless you *know* the state is authoritative** — guard against wiping the hub when you merely failed to load (Lexie bug: a module-load `save()`→`cloudSave` fired before `cloudLoad`, uploading the empty seed and wiping `household_state` cloud-wide; fixed with `_origSave` + a `_cloudEverLoaded` publish guard).

## The 7-day calendar (replaces Today/Needs-planning)

`dashboard.js` renders a rolling week (today + 6), two lanes per day — **Lexie Activity** + **Strive Workout** — plus the metric tiles on top and an "Also today" list for loose tasks (e.g. `log-food-today`). The contract for it:
- Each source app (`lexie`, `strive`) publishes **7 dow-keyed rows** `key='day-<dow>'` (`dow` = `['sun','mon','tue','wed','thu','fri','sat'][getDay()]`), `kind='task'`, `due`=that date, **self-cleaning weekly** like Lexie's original pattern: a **planned** day → `status='open'` + `title`/`detail`; an **empty** day → `status='dismissed'` (filtered out by `loadFromA`'s `.neq("status","dismissed")`, so LifeOS sees no row → renders it unplanned).
- LifeOS **owns the acknowledgements**: `store.js`'s `setAck(lane,dow,dueISO,on)` upserts an `app='lifeos'`, `key='<lane>-ack-<dow>'` row (`open`=acked / `dismissed`=undone). So a **"Rest day" / "No activity" survives the source app's every-boot republish** (the source app never sees the ack) — **no rest-day logic needed in Strive.**
- Three render states per lane: **planned** (chip → `cta_url`), **acknowledged** ("Rest day" | "No activity" + undo), **unplanned** (Plan deep-link + ack button). Both lanes writing `day-<dow>` don't collide — unique key is `(household_id, app, key)` and `app` differs.
- "Plan" deep-links are app-home for v1 (per-date routing = a later follow-up in the source apps).

## Backend — TWO Supabase projects (the key architectural fact)

- **Project A** `dgbbyijhabjozqrkokrq` (shared "household" DB) hosts Strive, Lexie, Household **and LifeOS itself**. Those three apps publish into `lifeos.signals` here as the shared household (same `household_memberships` identity). Strive/Household were already authed; **Lexie is the outlier — it ran anon and needed a login gate added** (see Adapters) before it could satisfy the RLS. LifeOS reads it via `supa.schema("lifeos")` — the `LO` handle. `supa.from()` would hit `public`.
- **Project B** `wqkhjbmsciuhwdqsdsni` (Investing's own DB) is the single outlier. It has an identical **mirror `lifeos.signals` table** (migration `0002_lifeos_signals_mirror.sql` in the Investing repo; `lifeos` exposed to PostgREST there too). **B has NO `household_memberships`**, so it can't reuse Project A's household-RLS; its RLS is simply **authenticated-only** (`for all to authenticated using(true)`), nothing granted to `anon` — the portfolio value is NOT readable by the public anon key. LifeOS reads it with `supaB`, which now **reuses the Investing app's Project-B session** (same silkham.github.io origin → supabase-js **default** `storageKey`; different project ref, so no clash with Project A's session). `loadFromB()` stays best-effort: no Investing session → RLS denies → `[]` and the invest tile is simply absent. A Project-B signal is read-only from LifeOS (`setStatus` skips `app==='invest'`).

RLS on `lifeos.signals` gated on `household_id in (select lifeos.my_household_ids())` — same SECURITY-DEFINER pattern the `house_project` schema uses. Grants to `authenticated` (+ `anon` usage). **Anon keys in `js/store.js` are public client keys — RLS is the real gate; fine to commit.** No secrets in this repo.

## Applying SQL / exposing the schema (no Docker)

Migrations applied via the **Management API**: `POST https://api.supabase.com/v1/projects/<ref>/database/query` with the token from `security find-generic-password -s "Supabase CLI" -w`. Use **curl** (urllib gets Cloudflare-403'd). The `lifeos` schema must be **exposed to PostgREST** — `PATCH /v1/projects/<ref>/postgrest` with `db_schema` including `lifeos` (done for Project A: `public,graphql_public,house_project,lifeos`).

## File layout

`index.html` (shell + all CSS, ported design tokens) · `js/version.js` (single source of version) · `js/store.js` (both Supabase clients, household resolution, `loadSignals` merge, `setStatus` writeback, `setAck` calendar-ack writeback) · `js/dashboard.js` (renders metric tiles — incl. the Household spend-vs-budget **progress tile** and the Invest **Holdings card** — + the 7-day calendar + "Also today") · `js/app.js` (boot/auth/theme/SW). Keep new features as `js/*.js` modules; no build step.

## Adapters (live in the SOURCE app's repo, not here)

An adapter is a thin "on save/boot, upsert my signals" function added to each source app. Pattern: `supa.schema("lifeos").from("signals").upsert(rows, { onConflict: "household_id,app,key" })`, called fire-and-forget on boot. **All four shipped:**
- **Household** — `js/lifeos.js` in the House Poject repo. Publishes `cash` (Projected cash) from `currentForecast()`, and `month-net` ("This month") as a **spend-vs-budget progress tile**: `value`=discretionary spend so far (General Expenses group from `reconcileMonth()` over the Emma feed, `await fetchEmma()`), `trend`=the monthly budget (`settings.forecast_budgets["General Expenses"]`), `state` **pace-aware** (over budget→bad; ahead of straight-line pace `budget × dayOfMonth/daysInMonth`→warn; else good). Feed unavailable → budget-only tile (spend 0). LifeOS renders this as a progress bar (see below) — it reads `value`/`trend` and **suppresses the up/down arrow** for this tile.
- **Strive** (Fitness, v4.14.0) — `lifeos.js` at the Fitness **repo root** (that app is a monolithic classic global `app.js`, NOT `js/` ES modules — the adapter is a classic `<script>` loaded after `app.js`, sharing its global scope; reuses `State`/`dayTotals`/`missedSlots`/`formatWorkoutDisplay`/`todayISO`/`isoDateAddDays`). Publishes `weight` + `calories-today` metrics, the `log-food-today` task (**flips `status` open↔done every boot**), and the **calendar** via `lifeosWeekSignals(hid,mid)` → 7 `day-<dow>` rows from `State.workouts` (`member_id`, `planned_for===iso`, `status!=='cancelled'`; title/detail from `formatWorkoutDisplay(w).primary`/`.secondary`; open when a session exists else `dismissed`). Sets the `state` column (`good|warn|bad`) for colour. Fitness has **no service worker** — only `app.js` `APP_VERSION` to bump.
- **Lexie** (Lexie & Me, build 16) — inline in that app's single-file `index.html` (`publishToLifeOS()`). **The auth outlier:** Lexie used to run purely `anon` (shared-secret-string household), so it could NOT satisfy the signals RLS — the S26 assumption that "all three apps are already authed" was WRONG for Lexie. Fix: added a **login gate** so Lexie authenticates as the shared household (same JWT space as the others; its `household_state` sync still works under auth). Publishes the **calendar**: 7 `day-<dow>` task rows for today+6, from **`eventsForDay(d)[0]`** = "planned" — this is the SAME unified list the app's calendar/Coming-up shows, merging **`S.commitments`** (booked calendar entries) **and `S.dayPlace[k]`** (a place pinned to a day via Discover; e.g. "Chartwell"). `title=e.name`(+"+N more"), `detail=[e.time,e.sub]`; empty day → `status='dismissed'`/"No activity". *(Earlier it read `commitmentsFor(d)` only → planned places never reached the hub — build 16 fix.)* The app's random Today-screen auto-suggestions are still ignored (they're not in `S.commitments`/`S.dayPlace`). `due` uses a **local** yyyy-mm-dd helper (`dkey`), not `toISOString()` (BST off-by-one). **Republish is wired into `cloudSave()`** (after the `household_state` upsert), so a new booking/place propagates without an app reload — not just on boot. Bump `APP_VERSION` build N + `sw.js` `VERSION`. Violet accent.
- **Invest** (Investing) — inline `publishToLifeOS()` in that app's single-file ES-module `index.html`, called fire-and-forget at the end of `loadPortfolio()`. **The only Project-B app** (writes to B's mirror table, authed as the Investing user). Publishes the `portfolio` `metric` (`value`=total £, `unit='gbp'`, `state='good'` when unrealised P/L ≥ 0 else `'bad'` (up = good), `detail`=P/L string, `cta_url` back to the app) **plus one `metric` per holding** (`key='holding-<ticker>'`, sanitized lowercase; `value`=holding £, `state` good/bad by that holding's P/L, `detail`=signed P/L). **Self-cleaning:** on each publish it reads its own `holding-*` keys on Project B and `status='dismissed'`-es any no longer held (update-in-place, avoids the NOT NULL insert path) — a sold stock's row would otherwise linger forever. LifeOS renders the holdings in a compact **Holdings card** grouped under the portfolio tile (excluded from the main tile grid by `app==='invest' && key startsWith 'holding-'`). The **hourly Project-B cron refreshes only `portfolio`** — per-stock rows refresh on app-open only. No trend arrow. No SW/version bump (Investing has neither). Amber accent.

**Trend colour is driven by the `state` column, not the trend sign** (`dashboard.js` colours by `state`). So metric adapters must set `state` per-signal (up = good for a portfolio, bad for spend; losing weight / under-budget calories = good). Strive already does this.

## Freshness (tile staleness cue)

Every adapter publishes **client-side, on app-open**, so a tile is only as fresh as the last time that source app was opened signed-in — a stale value used to look identical to a live one. `dashboard.js` renders an **"updated Xh ago"** line on each metric tile (from the row's `updated_at`, which `select("*")` already carries, stamped as `data-ts`), and **greys the tile out** (`.tile.stale`, opacity .55, amber age text) once it's **>24h old**. `fmtAge`/`ageMs` + `STALE_AFTER_MS` live in `dashboard.js`. *(The `.tile.stale` opacity needs `!important` — the `settle` entrance animation's fill-mode `both` holds opacity:1 and would otherwise win the cascade, so the fade never showed until v0.5.0.)*

**Auto-refresh (v0.5.0):** LifeOS is meant to sit open, so it doesn't rely on a manual reload. `app.js` polls `loadSignals()` every **60s** (paused while the tab is hidden) and refetches on **`focus`/`visibilitychange`** — so a value just published in a source app appears here within a tab-switch. All triggers are gated on `isAuthed` (a signed-out read just hits RLS-denied). `loadSignals` (`store.js`) **coalesces** overlapping calls (`inFlight`) and only `emit()`s when a cheap **fingerprint** (`id:status:value:trend:updated_at`) changed — so idle polls don't re-render / replay entrance animations; writebacks pass `{force:true}` to bypass the in-flight coalesce. Separately, `dashboard.js` runs a 60s **`tickAges()`** that rewrites the "updated Xh ago" text **in place** (no re-render) so the age keeps advancing and crosses into stale even when no new data arrives. `mountDashboard` is now guarded to subscribe/time **once** (onAuthStateChange can re-fire). *(No realtime subscription — polling + focus is simpler and uniform across both projects; realtime is a possible future upgrade.)*

**Invest is the exception that also refreshes server-side** (markets move while the app is closed): a **pg_cron job on Project B** POSTs hourly to an Edge Function that re-publishes the portfolio row — so the Invest tile stays live without anyone opening the Investing app. The in-app adapter still runs too; both write the same `(household_id, app='invest', key='portfolio')` row. Strive/Lexie/Household change ONLY on user action, so their publish-on-open is correct as-is — no server refresh needed. Server path details live in the **Investing** repo (`lifeos-invest-refresh` function + migration `0003_lifeos_invest_cron.sql`).

**Roadmap (remaining):** (1) the cross-domain scheduling brain (full Lexie day → nudge Strive to move the hard session). *(All four source adapters shipped; 7-day calendar live across LifeOS+Lexie+Strive; `supaB` Project-B bridge live; Invest tile server-refreshed hourly. **Shipped:** Invest per-stock — Holdings card under the portfolio tile; Household "This month" — spend-vs-budget progress/pace tile.)*

## Design system

Ported from the family "living money-app" aesthetic (see House Poject `CLAUDE.md` › Design System): dark-first + light, Fraunces headings + Inter Tight body, mint/coral/amber/violet/blue state system, aurora background, glass surfaces, cardSettle motion. Per-app accent: Strive mint · Lexie violet · Household blue · Invest amber. No emoji in chrome (the header icon glyphs are a placeholder — swap for Lucide).

## Dev server (sandbox landmine)

`python3 -m http.server` fails in the assistant sandbox (blocked `getcwd`). Workaround: copy files to the scratchpad and serve with a getcwd-free Ruby socket server (see scratchpad `server.rb`). On a normal machine `python3 -m http.server 5174` in the repo root is fine (that's what `.claude/launch.json` uses).

## Deploy

New repo → GitHub Pages (same as the other apps). Bump `js/version.js` by hand each deploy; the SW is network-first + version-busted (`sw.js?v=<version>` → `lifeos-cache-<version>`), auto-reloads once on takeover.
