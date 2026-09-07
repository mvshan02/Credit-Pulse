"use strict";
const $ = (selector) => document.querySelector(selector);
const storage = {get(key, fallback) {try {return localStorage.getItem(key) ?? fallback;} catch {return fallback;}}, set(key,value) {try {localStorage.setItem(key,String(value));} catch { /* Private browsing may disable storage. */ }}};
const savedThreshold = Number(storage.get("pulse-threshold", 80));
let threshold = Number.isFinite(savedThreshold) && savedThreshold >= 50 && savedThreshold <= 95 ? savedThreshold : 80;
let snapshot = null;
let busy = false;
let disconnected = false;
const notified = new Set();
let notifications = storage.get("pulse-notifications", "false") === "true";
const percent = (value) => `${Math.round(value)}%`;
const duration = (minutes) => minutes == null ? "Duration unknown" : minutes >= 1440 ? `${+(minutes / 1440).toFixed(1)}-day window` : `${+(minutes / 60).toFixed(1)}-hour window`;

function resetLabel(stamp) {
  if (!stamp) return "Reset unknown";
  const seconds = stamp - Date.now() / 1000;
  if (seconds <= 0) return "Reset passed; awaiting update";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `Resets in ${minutes}m`;
  if (minutes < 1440) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
}

function render() {
  if (!snapshot) return;
  const data = snapshot;
  const age = data.observedAt ? Date.now() / 1000 - data.observedAt : Infinity;
  const fresh = !disconnected && data.source === "live" && age < 120;
  $("#connection").textContent = disconnected ? "Tracker disconnected" : fresh ? "Connected to Codex" : data.source === "snapshot" ? "Historical local snapshot" : data.source === "live" ? "Last live reading is stale" : "Usage unavailable";
  $("#observed").textContent = data.observedAt ? `Observed ${new Date(data.observedAt * 1000).toLocaleString()}` : "No usage observation yet";
  $("#notice").hidden = !data.notice && !disconnected;
  $("#notice").textContent = disconnected ? "Cannot reach the local tracker. Start Credit Pulse again. Displayed values are from the last successful check." : data.notice || "";
  const windows = data.windows || [];
  const highest = windows.length ? Math.max(...windows.map(w => w.used)) : null;
  const warning = highest !== null && highest >= threshold;
  const expired = windows.some(w => w.resetsAt && w.resetsAt <= Date.now() / 1000);
  $(".hero").classList.toggle("danger", warning);
  $("#pressure").textContent = highest === null ? "--" : percent(highest);
  $("#arc").style.strokeDashoffset = 628.319 * (1 - Math.min(highest ?? 0, 100) / 100);
  $("#health").textContent = highest === null ? "Unknown" : !fresh || expired ? "Last observed" : highest >= 100 ? "Limit reached" : warning ? "Approaching limit" : "Room to build";
  $("#guidance").textContent = highest === null ? "No quota data has been reported." : !fresh || expired ? "Historical reading. Refresh before relying on it." : highest >= 100 ? "A quota window is exhausted. Check its reset time." : warning ? "You're nearing a quota limit. Plan your next tasks." : "Your reported windows have room remaining.";
  for (const id of ["primary", "secondary"]) {
    const card = $(`#${id}`), window = windows.find(w => w.id === id);
    card.querySelector(".duration").textContent = window ? duration(window.minutes) : "Not reported";
    card.querySelector(".used").textContent = window ? percent(window.used) : "--";
    const bar = card.querySelector(".bar");
    bar.firstElementChild.style.width = `${Math.min(window?.used ?? 0, 100)}%`;
    if (window) bar.setAttribute("aria-valuenow", Math.min(window.used, 100));
    else bar.removeAttribute("aria-valuenow");
    card.querySelector(".remaining").textContent = window ? `${percent(Math.max(0,100-window.used))} remaining${fresh ? "" : " (observed)"}` : "No data available";
    const reset = card.querySelector(".reset");
    reset.textContent = resetLabel(window?.resetsAt);
    reset.title = window?.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : "";
    if (fresh && window && window.used >= threshold && (!window.resetsAt || window.resetsAt > Date.now()/1000)) {
      const key = `${id}:${window.resetsAt}:${threshold}:${window.used >= 100 ? "limit" : "warning"}`;
      if (notifications && "Notification" in windowSelf && Notification.permission === "granted" && !notified.has(key)) {
        try {new Notification("Credit Pulse: quota warning", {body:`${id === "primary" ? "Primary" : "Secondary"} window is ${percent(window.used)} used. ${resetLabel(window.resetsAt)}.`, tag:`pulse-${id}`}); notified.add(key);} catch {$("#notification-help").textContent = "Notifications could not be delivered by this browser.";}
      }
    }
  }
  $("#plan").textContent = data.plan ? `${data.plan} plan` : "Codex";
  $("#balance").textContent = data.credits?.unlimited ? "Unlimited" : data.credits?.balance ?? "--";
  $("#credit-description").textContent = data.credits?.unlimited ? "Codex reports unlimited credits." : data.credits?.balance != null ? "Credits reported by Codex, not a currency amount." : "Credit balance is not reported for this account.";
}
const windowSelf = window;
async function refresh() {
  if (busy) return;
  busy = true;
  $("#refresh").disabled = true;
  $("#refresh").textContent = "Checking...";
  try {
    const response = await fetch("/api/usage", {signal:AbortSignal.timeout(25000)});
    if (!response.ok) throw new Error("Unavailable");
    snapshot = await response.json();
    disconnected = false;
    render();
  } catch {
    disconnected = true;
    render();
    $("#notice").hidden = false;
    $("#notice").textContent = "Cannot reach the local tracker. Start Credit Pulse again. Any displayed values are from the last successful check.";
    $("#connection").textContent = "Tracker disconnected";
    $("#health").textContent = "Last observed";
  } finally {busy = false; $("#refresh").disabled = false; $("#refresh").textContent = "Refresh now";}
}
function notificationLabel() {
  $("#notifications").textContent = notifications && "Notification" in window && Notification.permission === "granted" ? "Disable notifications" : "Enable notifications";
}
$("#notifications").addEventListener("click", async () => {
  if (!("Notification" in window)) {$("#notification-help").textContent = "This browser does not support desktop notifications."; return;}
  if (notifications && Notification.permission === "granted") notifications = false;
  else {try {notifications = (await Notification.requestPermission()) === "granted";} catch {notifications = false;}}
  storage.set("pulse-notifications", notifications);
  $("#notification-help").textContent = notifications ? "Enabled while this tab is open. Stale data never triggers alerts." : Notification.permission === "denied" ? "Notifications blocked. Allow them in your browser site settings." : "Notifications are off. On-page warnings remain active.";
  notificationLabel(); render();
});
$("#threshold").value = threshold;
$("#threshold-value").textContent = percent(threshold);
$("#threshold").addEventListener("input", (event) => {threshold = Number(event.target.value); storage.set("pulse-threshold",threshold); $("#threshold-value").textContent = percent(threshold); render();});
function compact(enabled) {document.body.classList.toggle("compact",enabled); $("#compact").setAttribute("aria-pressed",String(enabled)); $("#compact").textContent = enabled ? "Full view" : "Compact view"; storage.set("pulse-compact",enabled);}
compact(storage.get("pulse-compact","false") === "true");
$("#compact").addEventListener("click", () => compact(!document.body.classList.contains("compact")));
$("#refresh").addEventListener("click", refresh);
$("#export").addEventListener("click", () => {
  if (!snapshot) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)], {type:"application/json"}));
  const link = document.createElement("a"); link.href = url; link.download = "credit-pulse-snapshot.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
notificationLabel();
refresh();
setInterval(refresh,60000);
setInterval(render,1000);
