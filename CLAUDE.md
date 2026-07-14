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
- **`task`** → a to-do with a `cta_url` deep-link into the source app + a `due` date.
- **`nudge`** → the planning radar ("nothing planned Saturday") — a task with a future `due`.

The CTA deep-links into the source app; **the source app owns the truth and flips `status`** to `done`/`dismissed`. LifeOS reflects it. LifeOS never reaches into any app's own schema — only the `signals` contract. Table shape: see `supabase/migrations/20260714160000_lifeos_init.sql`.

`(household_id, app, key)` is unique → re-publishing upserts (no duplicates). `key` is a stable per-signal id chosen by each adapter.

## Backend — TWO Supabase projects (the key architectural fact)

- **Project A** `dgbbyijhabjozqrkokrq` (shared "household" DB) hosts Strive, Lexie, Household **and LifeOS itself**. Those three apps publish into `lifeos.signals` here as the shared household (same `household_memberships` identity). Strive/Household were already authed; **Lexie is the outlier — it ran anon and needed a login gate added** (see Adapters) before it could satisfy the RLS. LifeOS reads it via `supa.schema("lifeos")` — the `LO` handle. `supa.from()` would hit `public`.
- **Project B** `wqkhjbmsciuhwdqsdsni` (Investing's own DB) is the single outlier. It gets an identical **mirror `signals` table**; LifeOS reads it with a **second, read-only client** (`supaB`, isolated `storageKey`) and merges. **Dormant until the Investment adapter ships** — `loadFromB()` is best-effort (missing table / no session → `[]`). A Project-B signal is read-only from LifeOS (`setStatus` skips `app==='invest'`).

RLS on `lifeos.signals` gated on `household_id in (select lifeos.my_household_ids())` — same SECURITY-DEFINER pattern the `house_project` schema uses. Grants to `authenticated` (+ `anon` usage). **Anon keys in `js/store.js` are public client keys — RLS is the real gate; fine to commit.** No secrets in this repo.

## Applying SQL / exposing the schema (no Docker)

Migrations applied via the **Management API**: `POST https://api.supabase.com/v1/projects/<ref>/database/query` with the token from `security find-generic-password -s "Supabase CLI" -w`. Use **curl** (urllib gets Cloudflare-403'd). The `lifeos` schema must be **exposed to PostgREST** — `PATCH /v1/projects/<ref>/postgrest` with `db_schema` including `lifeos` (done for Project A: `public,graphql_public,house_project,lifeos`).

## File layout

`index.html` (shell + all CSS, ported design tokens) · `js/version.js` (single source of version) · `js/store.js` (both Supabase clients, household resolution, `loadSignals` merge, `setStatus` writeback) · `js/dashboard.js` (renders tiles + Today/Needs-planning) · `js/app.js` (boot/auth/theme/SW). Keep new features as `js/*.js` modules; no build step.

## Adapters (live in the SOURCE app's repo, not here)

An adapter is a thin "on save/boot, upsert my signals" function added to each source app. Pattern: `supa.schema("lifeos").from("signals").upsert(rows, { onConflict: "household_id,app,key" })`, called fire-and-forget on boot. **Three shipped:**
- **Household** — `js/lifeos.js` in the House Poject repo; publishes `month-net` + `cash` metrics from `currentForecast()`.
- **Strive** (Fitness, v4.13.0) — `lifeos.js` at the Fitness **repo root** (that app is a monolithic classic global `app.js`, NOT `js/` ES modules — the adapter is a classic `<script>` loaded after `app.js`, sharing its global scope; reuses `State`/`dayTotals`/`missedSlots`). Publishes `weight` + `calories-today` metrics and `log-food-today` + `workout-tomorrow` task/nudge, **flipping `status` open↔done every boot**. Sets the `state` column (`good|warn|bad`) for colour — see next point.
- **Lexie** (Lexie & Me, build 13) — inline in that app's single-file `index.html` (`publishToLifeOS()`). **The auth outlier:** Lexie used to run purely `anon` (shared-secret-string household), so it could NOT satisfy the signals RLS — the S26 assumption that "all three apps are already authed" was WRONG for Lexie. Fix: added a **login gate** so Lexie authenticates as the shared household (same JWT space as the others; its `household_state` sync still works under auth). Publishes one `nudge` per **day-of-week slot** for the next 7 days (`key='nothing-planned-<dow>'`, self-cleaning; booked days → `status='dismissed'`). `due` uses a **local** yyyy-mm-dd helper, not `toISOString()`/`dkey` (BST off-by-one). Violet accent, `state='warn'`.

**Trend colour is driven by the `state` column, not the trend sign** (`dashboard.js` colours by `state`). So metric adapters must set `state` per-signal (up = good for a portfolio, bad for spend; losing weight / under-budget calories = good). Strive already does this.

**Roadmap (remaining):** Invest (portfolio metric into Project B — lights up the dormant `supaB` bridge) · then the cross-domain scheduling brain (full Lexie day → nudge Strive to move the hard session).

## Design system

Ported from the family "living money-app" aesthetic (see House Poject `CLAUDE.md` › Design System): dark-first + light, Fraunces headings + Inter Tight body, mint/coral/amber/violet/blue state system, aurora background, glass surfaces, cardSettle motion. Per-app accent: Strive mint · Lexie violet · Household blue · Invest amber. No emoji in chrome (the header icon glyphs are a placeholder — swap for Lucide).

## Dev server (sandbox landmine)

`python3 -m http.server` fails in the assistant sandbox (blocked `getcwd`). Workaround: copy files to the scratchpad and serve with a getcwd-free Ruby socket server (see scratchpad `server.rb`). On a normal machine `python3 -m http.server 5174` in the repo root is fine (that's what `.claude/launch.json` uses).

## Deploy

New repo → GitHub Pages (same as the other apps). Bump `js/version.js` by hand each deploy; the SW is network-first + version-busted (`sw.js?v=<version>` → `lifeos-cache-<version>`), auto-reloads once on takeover.
