// ============================================================================
//  store.js — LifeOS data layer.
//  LifeOS is a read-mostly hub. Each source app publishes "signals" into a
//  `lifeos.signals` table; LifeOS merges them and renders the dashboard.
//
//  Project A (household, ref dgbbyijhabjozqrkokrq) hosts Strive, Lexie and
//  Household — and LifeOS itself. Those apps write signals here natively.
//  Project B (Investing, ref wqkhjbmsciuhwdqsdsni) is the one outlier; LifeOS
//  reads its mirror `signals` table with a second, read-only client and merges.
//  (Project-B read is wired but dormant until the Investment adapter ships.)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- Project A (home) ------------------------------------------------------
const A_URL  = "https://dgbbyijhabjozqrkokrq.supabase.co";
const A_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRnYmJ5aWpoYWJqb3pxcmtva3JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTA2ODgsImV4cCI6MjA5NDU4NjY4OH0.0VnZVRXNexVQBoYFrVXtGo9Ep-Gdv_04jGcX9NQLcE0";
export const supa = createClient(A_URL, A_ANON);
export const LO = supa.schema("lifeos");   // supa.from() would hit `public`
window.__supa = supa; window.__LO = LO;

// ---- Project B (Investment) — read-only bridge ----------------------------
// Its own DB + its own auth. Reads on B require an authenticated JWT (the mirror
// signals table is authenticated-only — nothing exposed to anon), so instead of
// running anonymous we reuse the Investing app's session: both apps are served
// from the same silkham.github.io origin, so we use supabase-js's DEFAULT
// storageKey (sb-<ref>-auth-token) to pick up the session Investing already
// persisted there. Different project ref → no collision with Project A's session.
// Reads stay best-effort: no Investing session (user hasn't opened it) → RLS
// denies → loadFromB() yields [] and the dashboard simply omits the invest tile.
const B_URL  = "https://wqkhjbmsciuhwdqsdsni.supabase.co";
const B_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxa2hqYm1zY2l1aHdkcXNkc25pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzkzMTMsImV4cCI6MjA5NzU1NTMxM30.cAWtGGE42k_GeSQRE1ZnFZIXK2EOat35-xnaF2Gczsc";
export const supaB = createClient(B_URL, B_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Known shared household ("Our household") — fallback only.
const FALLBACK_HOUSEHOLD = "13b5e642-3f21-403c-8336-56976f177269";

let householdId = null;
export function getHousehold() { return householdId; }

export async function resolveHousehold() {
  if (householdId) return householdId;
  const { data, error } = await LO.rpc("my_household_ids");
  householdId = (!error && Array.isArray(data) && data.length) ? data[0] : FALLBACK_HOUSEHOLD;
  return householdId;
}

// ---- state -----------------------------------------------------------------
export const state = { signals: [] };
const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { subs.forEach((fn) => fn(state)); }

// ---- signal loading --------------------------------------------------------
async function loadFromA() {
  const { data, error } = await LO.from("signals").select("*").neq("status", "dismissed");
  if (error) { console.error("load signals (A):", error.message); return []; }
  return data || [];
}

// Project B: dormant until the Investment adapter + its signals table exist.
// Best-effort so a missing table / no session just yields nothing.
async function loadFromB() {
  try {
    const { data, error } = await supaB.schema("lifeos").from("signals").select("*").neq("status", "dismissed");
    if (error) return [];
    return data || [];
  } catch { return []; }
}

export async function loadSignals() {
  const [a, b] = await Promise.all([loadFromA(), loadFromB()]);
  state.signals = [...a, ...b];
  emit();
  return state.signals;
}

// ---- status writeback (done / dismiss) -------------------------------------
// Only Project-A signals are writable from here today; a B signal is read-only
// until we add a write path for it.
export async function setStatus(signal, status) {
  if (signal.app === "invest") return;   // Project B — read-only for now
  const { error } = await LO.from("signals").update({ status }).eq("id", signal.id);
  if (error) throw error;
  await loadSignals();
}

// ---- calendar acknowledgements (LifeOS-owned) ------------------------------
// The 7-day calendar shows each day's Lexie activity + Strive workout. An empty
// day can be *acknowledged* as intentional ("Rest day" / "No activity") so it
// stops reading as unplanned. LifeOS owns these rows (app='lifeos') rather than
// the source app, so Strive's every-boot republish can't resurrect a rest day.
// dow-keyed to match the source adapters' self-cleaning weekly pattern.
//   lane 'lexie'  → key 'lexie-ack-<dow>',  label "No activity"
//   lane 'strive' → key 'strive-ack-<dow>', label "Rest day"
// on=true opens the ack; on=false dismisses it (loadFromA filters dismissed out).
export async function setAck(lane, dow, dueISO, on) {
  const hid = await resolveHousehold();
  const row = {
    household_id: hid, app: "lifeos", kind: "task",
    key: `${lane}-ack-${dow}`,
    title: lane === "strive" ? "Rest day" : "No activity",
    due: dueISO, status: on ? "open" : "dismissed", sort_order: 0,
  };
  const { error } = await LO.from("signals").upsert(row, { onConflict: "household_id,app,key" });
  if (error) throw error;
  await loadSignals();
}
