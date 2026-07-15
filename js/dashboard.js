// ============================================================================
//  dashboard.js — renders the merged signal stream.
//   metrics -> glanceable tiles ("how are things right now")
//   tasks   -> Today's actions (CTA deep-links into the source app)
//   nudges  -> the planning radar ("what's coming that has no plan yet")
// ============================================================================
import { state, subscribe, setStatus, setAck } from "./store.js";

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
// The Household "This month" tile is a spend-vs-budget PROGRESS tile: its adapter
// carries spend-so-far in `value` and the budget in `trend` (it opts out of the
// up/down arrow — pace is conveyed by `state`/the bar). Everything else is a
// plain metric tile.
const isSpendTile = (s) => s.app === "household" && s.key === "month-net" && s.trend != null;

function tileHead(sig) {
  const m = appMeta(sig.app);
  const cta = sig.cta_url
    ? ` onclick="window.open('${esc(sig.cta_url)}','_blank')" role="link" tabindex="0"`
    : "";
  const age = ageMs(sig.updated_at);
  const stale = age != null && age > STALE_AFTER_MS;
  const ageTxt = age != null ? fmtAge(age) : "";
  const ageTitle = sig.updated_at ? new Date(sig.updated_at).toLocaleString("en-GB") : "";
  const ageEl = ageTxt ? `<div class="tile-age" title="${esc(ageTitle)}">updated ${esc(ageTxt)}</div>` : "";
  return { m, cta, stale, ageEl };
}

function spendTile(sig) {
  const { m, cta, stale, ageEl } = tileHead(sig);
  const spent = Number(sig.value) || 0;
  const budget = Number(sig.trend) || 0;
  const pct = budget > 0 ? Math.min(100, Math.max(0, (spent / budget) * 100)) : 0;
  const col = stateColor(sig.state);
  return `<div class="tile glass${stale ? " stale" : ""}"${cta} style="--accent:${m.accent}">
    <div class="tile-app">${esc(m.label)}</div>
    <div class="tile-title">${esc(sig.title)}</div>
    <div class="tile-val">${esc(fmtValue(spent, "gbp"))}${budget ? ` <span class="tile-of">/ ${esc(fmtValue(budget, "gbp"))}</span>` : ""}</div>
    <div class="pbar"><span style="width:${pct.toFixed(0)}%;background:${col}"></span></div>
    <div class="tile-foot">
      ${sig.detail ? `<span class="tile-detail" style="color:${col}">${esc(sig.detail)}</span>` : ""}
    </div>
    ${ageEl}
  </div>`;
}

function tile(sig) {
  if (isSpendTile(sig)) return spendTile(sig);
  const { m, cta, stale, ageEl } = tileHead(sig);
  const val = fmtValue(sig.value, sig.unit);
  return `<div class="tile glass${stale ? " stale" : ""}"${cta} style="--accent:${m.accent}">
    <div class="tile-app">${esc(m.label)}</div>
    <div class="tile-title">${esc(sig.title)}</div>
    ${val ? `<div class="tile-val" style="color:${stateColor(sig.state)}">${esc(val)}</div>` : ""}
    <div class="tile-foot">
      ${sig.detail ? `<span class="tile-detail">${esc(sig.detail)}</span>` : ""}
      ${trendArrow(sig.trend)}
    </div>
    ${ageEl}
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

// ---- 7-day calendar --------------------------------------------------------
// Two lanes per day — Lexie activity + Strive workout. Each source app publishes
// dow-keyed `day-<dow>` rows for planned days (open + title); an absent open row
// means unplanned. LifeOS owns `<lane>-ack-<dow>` rows for acknowledged-empty
// days ("Rest day" / "No activity"). Local yyyy-mm-dd (not toISOString) so the
// day boundary matches the adapters and survives BST.
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const LANES = {
  lexie:  { label: "Activity", accent: "var(--violet)", planUrl: "https://silkham.github.io/lexie-and-me/#calendar", ackLabel: "No activity" },
  strive: { label: "Workout",  accent: "var(--mint)",   planUrl: "https://silkham.github.io/Fitnesstracker/",       ackLabel: "Rest day" },
};

function buildWeek(sigs) {
  const open = (app, key) => sigs.find((s) => s.app === app && s.key === key && s.status === "open");
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    const dow = DOW[d.getDay()];
    days.push({
      date: d, iso: localISO(d), dow, isToday: i === 0,
      lexie:  { plan: open("lexie",  `day-${dow}`), ack: open("lifeos", `lexie-ack-${dow}`) },
      strive: { plan: open("strive", `day-${dow}`), ack: open("lifeos", `strive-ack-${dow}`) },
    });
  }
  return days;
}

function laneCell(iso, dow, laneKey, cell) {
  const L = LANES[laneKey];
  const head = `<span class="lane-label">${esc(L.label)}</span>`;
  let body;
  if (cell.plan) {
    const s = cell.plan;
    const cta = s.cta_url || L.planUrl;
    body = `<button class="lane-plan" data-cta="${esc(cta)}">
      <span class="lane-plan-title">${esc(s.title)}</span>
      ${s.detail ? `<span class="lane-plan-sub">${esc(s.detail)}</span>` : ""}
    </button>`;
  } else if (cell.ack) {
    body = `<span class="lane-ack">${esc(L.ackLabel)}</span>
      <button class="lane-undo" data-ack-off="${laneKey}|${dow}|${iso}">undo</button>`;
  } else {
    body = `<button class="lane-btn plan" data-plan="${esc(L.planUrl)}">Plan</button>
      <button class="lane-btn ack" data-ack-on="${laneKey}|${dow}|${iso}">${esc(L.ackLabel)}</button>`;
  }
  return `<div class="lane" style="--accent:${L.accent}">${head}<div class="lane-body">${body}</div></div>`;
}

function dayCard(day) {
  const wd = day.isToday ? "Today" : day.date.toLocaleDateString("en-GB", { weekday: "long" });
  const dm = day.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `<div class="day-card glass${day.isToday ? " today" : ""}">
    <div class="day-head">
      <span class="day-wd">${esc(wd)}</span>
      <span class="day-dm">${esc(dm)}</span>
    </div>
    <div class="day-lanes">
      ${laneCell(day.iso, day.dow, "lexie", day.lexie)}
      ${laneCell(day.iso, day.dow, "strive", day.strive)}
    </div>
  </div>`;
}

// ---- invest holdings (grouped under the portfolio tile) --------------------
const isHolding = (s) => s.app === "invest" && String(s.key).startsWith("holding-");

function holdingsCard(rows) {
  const sorted = rows.slice().sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  return `<section class="asection">
    <div class="holdings-card glass" style="--accent:var(--amber)">
      <div class="hc-head">Holdings</div>
      <div class="hc-list">
        ${sorted.map((h) => `<div class="hc-row"${h.cta_url ? ` data-cta="${esc(h.cta_url)}" role="link" tabindex="0"` : ""}>
          <span class="hc-tk">${esc(h.title)}</span>
          <span class="hc-val">${esc(fmtValue(h.value, h.unit))}</span>
          <span class="hc-pl" style="color:${stateColor(h.state)}">${esc(h.detail || "")}</span>
        </div>`).join("")}
      </div>
    </div>
  </section>`;
}

export function renderDashboard(root) {
  const sigs = state.signals.slice().sort((a, b) => (a.sort_order - b.sort_order) || 0);
  const metrics = sigs.filter((s) => s.kind === "metric" && !isHolding(s));
  const holdings = sigs.filter((s) => s.kind === "metric" && isHolding(s));
  const week = buildWeek(sigs);
  // Loose tasks — real to-dos not tied to a calendar day (e.g. log today's food).
  // Excludes the dow day-rows and LifeOS's own ack rows.
  const loose = sigs.filter((s) =>
    s.kind === "task" && s.status === "open" &&
    !String(s.key).startsWith("day-") && s.app !== "lifeos");

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

      ${holdings.length ? holdingsCard(holdings) : ""}

      <section class="asection">
        <h2>Next 7 days</h2>
        <div class="asection-hint">Lexie's activity + your workout, each day. Plan the gaps or mark them off.</div>
        <div class="week">${week.map(dayCard).join("")}</div>
      </section>

      ${loose.length ? `<section class="asection">
        <h2>Also today</h2>
        ${loose.map(actionRow).join("")}
      </section>` : ""}
    </div>`;

  // wire deep-links (planned chips + empty-day Plan buttons)
  root.querySelectorAll("[data-cta]").forEach((b) =>
    b.onclick = () => window.open(b.dataset.cta, "_blank"));
  root.querySelectorAll("[data-plan]").forEach((b) =>
    b.onclick = () => window.open(b.dataset.plan, "_blank"));

  // wire calendar acknowledgements (set / undo a rest day / no-activity)
  const wireAck = (attr, on) => root.querySelectorAll(`[${attr}]`).forEach((b) =>
    b.onclick = async () => {
      const [lane, dow, iso] = b.getAttribute(attr).split("|");
      b.disabled = true;
      try { await setAck(lane, dow, iso, on); } catch (e) { b.disabled = false; }
    });
  wireAck("data-ack-on", true);
  wireAck("data-ack-off", false);

  // wire loose-task actions
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
