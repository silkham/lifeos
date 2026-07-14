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
async function onSession(session) {
  const authed = !!session;
  $("authScreen").style.display = authed ? "none" : "flex";
  $("app").style.display = authed ? "flex" : "none";
  if (authed) {
    await resolveHousehold();
    mountDashboard($("dash-root"));
    await loadSignals();
  }
}

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
