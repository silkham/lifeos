// ============================================================================
//  app.js — boot, auth gate, theme, service worker.
// ============================================================================
import { supa, resolveHousehold, loadSignals } from "./store.js";
import { mountDashboard } from "./dashboard.js";
import { APP_VERSION, BUILD_DATE } from "./version.js";

console.log(`LifeOS v${APP_VERSION} (${BUILD_DATE})`);

const $ = (id) => document.getElementById(id);

// ---- theme -----------------------------------------------------------------
const THEME_KEY = "lifeos-theme";
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
}
applyTheme(localStorage.getItem(THEME_KEY) || "dark");
$("themeBtn").onclick = () =>
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");

// ---- auth ------------------------------------------------------------------
let isAuthed = false;
async function onSession(session) {
  isAuthed = !!session;
  $("authScreen").style.display = isAuthed ? "none" : "flex";
  $("app").style.display = isAuthed ? "flex" : "none";
  if (isAuthed) {
    await resolveHousehold();
    mountDashboard($("dash-root"));
    await loadSignals();
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

// ---- auto-refresh ----------------------------------------------------------
// LifeOS is meant to sit open. Source apps publish on user action, so poll for
// new signals every 60s (paused while the tab's hidden) and refetch the moment
// the tab regains focus — so a value just published in a source app shows here
// without a manual reload. loadSignals only re-renders when data actually
// changed, so idle polls are cheap and flicker-free. All triggers are gated on
// being signed in (an anon read just hits RLS-denied).
const POLL_MS = 60000;
let pollTimer = null;
function refreshNow() { if (isAuthed && !document.hidden) loadSignals(); }
function startAutoRefresh() {
  stopAutoRefresh();
  pollTimer = setInterval(refreshNow, POLL_MS);
}
function stopAutoRefresh() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
document.addEventListener("visibilitychange", refreshNow);
window.addEventListener("focus", refreshNow);

$("signinForm").onsubmit = async (e) => {
  e.preventDefault();
  const err = $("authErr");
  err.textContent = "";
  const email = $("email").value.trim();
  const password = $("password").value;
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) err.textContent = error.message;
};
$("signoutBtn").onclick = () => supa.auth.signOut();
$("refreshBtn").onclick = () => loadSignals();

// ---- service worker --------------------------------------------------------
if ("serviceWorker" in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) location.reload();     // new version took over → refresh once
    hadController = true;
  });
}

// ---- go --------------------------------------------------------------------
$("verLabel").textContent = `v${APP_VERSION}`;
const { data: { session } } = await supa.auth.getSession();
onSession(session);
supa.auth.onAuthStateChange((_evt, s) => onSession(s));
