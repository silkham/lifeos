// ============================================================================
//  dashboard.js — renders the merged signal stream.
//   metrics -> glanceable tiles ("how are things right now")
//   tasks   -> Today's actions (CTA deep-links into the source app)
//   nudges  -> the planning radar ("what's coming that has no plan yet")
// ============================================================================
import { state, subscribe, setStatus } from "./store.js";

const APPS = {
  strive:    { label: "Strive",    accent: "var(--mint)" },
  lexie:     { label: "Lexie",     accent: "var(--violet)" },
  household: { label: "Household", accent: "var(--blue)" },
  invest:    { label: "Invest",    accent: "var(--amber)" },
};
const appMeta = (a) => APPS[a] || { label: a, accent: "var(--text-dim)" };

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtValue(v, unit) {
  if (v == null || v === "") return "";
  const n = Number(v);
  switch (unit) {
    case "gbp": {
      const neg = n < 0;
      const a = Math.abs(n);
      const s = a >= 1000 ? "£" + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k"
                          : "£" + a.toFixed(0);
      return (neg ? "−" : "") + s;
    }
    case "kcal": return n.toFixed(0) + " kcal";
    case "kg":   return n.toFixed(1) + " kg";
    case "pct":  return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
    default:     return String(v);
  }
}

const stateColor = (st) =>
  st === "good" ? "var(--mint)" : st === "bad" ? "var(--coral)"
  : st === "warn" ? "var(--amber)" : "var(--text)";

function trendArrow(t) {
  if (t == null || t === 0) return "";
  const up = Number(t) > 0;
  return `<span class="tr ${up ? "up" : "dn"}">${up ? "▲" : "▼"} ${esc(fmtValue(Math.abs(t), ""))}</span>`;
}

// ---- freshness -------------------------------------------------------------
// Metrics publish on app-open (Invest also via an hourly server cron), so a tile
// is only as fresh as its last publish. Show the age, and grey the tile out once
// it's clearly stale so a dead value can't pass for a live one.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function ageMs(ts) {
  if (!ts) return null;
  const then = new Date(ts).getTime();
  return Number.isNaN(then) ? null : Math.max(0, Date.now() - then);
}
function fmtAge(ms) {
  if (ms == null) return "";
  const mins = ms / 60000;
  if (mins < 1.5) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ---- tiles -----------------------------------------------------------------
function tile(sig) {
  const m = appMeta(sig.app);
  const val = fmtValue(sig.value, sig.unit);
  const cta = sig.cta_url
    ? ` onclick="window.open('${esc(sig.cta_url)}','_blank')" role="link" tabindex="0"`
    : "";
  const age = ageMs(sig.updated_at);
  const stale = age != null && age > STALE_AFTER_MS;
  const ageTxt = age != null ? fmtAge(age) : "";
  const ageTitle = sig.updated_at ? new Date(sig.updated_at).toLocaleString("en-GB") : "";
  return `<div class="tile glass${stale ? " stale" : ""}"${cta} style="--accent:${m.accent}">
    <div class="tile-app">${esc(m.label)}</div>
    <div class="tile-title">${esc(sig.title)}</div>
    ${val ? `<div class="tile-val" style="color:${stateColor(sig.state)}">${esc(val)}</div>` : ""}
    <div class="tile-foot">
      ${sig.detail ? `<span class="tile-detail">${esc(sig.detail)}</span>` : ""}
      ${trendArrow(sig.trend)}
    </div>
    ${ageTxt ? `<div class="tile-age" title="${esc(ageTitle)}">updated ${esc(ageTxt)}</div>` : ""}
  </div>`;
}

// ---- action rows (tasks + nudges) ------------------------------------------
function actionRow(sig) {
  const m = appMeta(sig.app);
  const due = sig.due ? new Date(sig.due + "T00:00:00") : null;
  const dueTxt = due ? due.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
  const kindCls = sig.kind === "nudge" ? "nudge" : "task";
  return `<div class="arow glass" data-id="${esc(sig.id)}">
    <div class="arow-dot" style="background:${m.accent}"></div>
    <div class="arow-body">
      <div class="arow-title">${esc(sig.title)}
        <span class="arow-app">${esc(m.label)}</span>
        ${sig.kind === "nudge" ? `<span class="arow-tag">plan</span>` : ""}
      </div>
      ${sig.detail ? `<div class="arow-detail">${esc(sig.detail)}</div>` : ""}
      ${dueTxt ? `<div class="arow-due">${esc(dueTxt)}</div>` : ""}
    </div>
    <div class="arow-actions">
      ${sig.cta_url ? `<button class="btn-cta" data-cta="${esc(sig.cta_url)}">${esc(sig.cta_label || "Open")}</button>` : ""}
      <button class="btn-done" data-done="${esc(sig.id)}" title="Mark done">✓</button>
    </div>
  </div>`;
}

// ---- section builder -------------------------------------------------------
function todayISO() { return new Date().toISOString().slice(0, 10); }

export function renderDashboard(root) {
  const sigs = state.signals.slice().sort((a, b) => (a.sort_order - b.sort_order) || 0);
  const metrics = sigs.filter((s) => s.kind === "metric");
  const actions = sigs.filter((s) => s.kind !== "metric" && s.status === "open");
  const today = todayISO();
  const todayActions = actions.filter((s) => !s.due || s.due <= today);
  const upcoming = actions.filter((s) => s.due && s.due > today);

  const empty = !sigs.length;

  root.innerHTML = `
    <div class="dash">
      <div class="dash-head">
        <div>
          <h1>Today</h1>
          <div class="dash-sub">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
      </div>

      ${empty ? `<div class="glass empty">
        <div class="empty-title">No signals yet</div>
        <div class="empty-sub">Once your apps start publishing, their metrics and to-dos land here.</div>
      </div>` : ""}

      ${metrics.length ? `<div class="tiles">${metrics.map(tile).join("")}</div>` : ""}

      ${todayActions.length ? `<section class="asection">
        <h2>To do today</h2>
        ${todayActions.map(actionRow).join("")}
      </section>` : ""}

      ${upcoming.length ? `<section class="asection">
        <h2>Needs planning</h2>
        <div class="asection-hint">Coming up with nothing set — get ahead of it.</div>
        ${upcoming.map(actionRow).join("")}
      </section>` : ""}
    </div>`;

  // wire actions
  root.querySelectorAll("[data-cta]").forEach((b) =>
    b.onclick = () => window.open(b.dataset.cta, "_blank"));
  root.querySelectorAll("[data-done]").forEach((b) =>
    b.onclick = async () => {
      const sig = state.signals.find((s) => s.id === b.dataset.done);
      if (sig) { b.disabled = true; try { await setStatus(sig, "done"); } catch (e) { b.disabled = false; } }
    });
}

export function mountDashboard(root) {
  subscribe(() => renderDashboard(root));
  renderDashboard(root);
}
