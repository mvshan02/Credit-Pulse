"use strict";
const {spawn} = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {isMessage} = require("./privacy");
const {version} = require("../package.json");

const numeric = value => typeof value === "number" && Number.isFinite(value);
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const windows = [];
  for (const id of ["primary", "secondary"]) {
    const w = raw[id];
    if (!w) continue;
    const used = w.usedPercent ?? w.used_percent;
    if (!numeric(used) || used < 0) continue;
    const minutes = w.windowDurationMins ?? w.window_minutes;
    const reset = w.resetsAt ?? w.resets_at;
    windows.push({id, used, minutes: numeric(minutes) && minutes > 0 ? minutes : null,
      resetsAt: numeric(reset) && reset > 0 ? reset : null});
  }
  const c = raw.credits;
  const credits = c && typeof c === "object" ? {
    balance: (typeof c.balance === "string" && /^-?\d+(?:\.\d+)?$/.test(c.balance) && c.balance.length<=32) || numeric(c.balance) ? String(c.balance) : null,
    unlimited: c.unlimited === true
  } : null;
  return windows.length || credits ? {windows, credits, plan: typeof (raw.planType ?? raw.plan_type) === "string" ? raw.planType ?? raw.plan_type : null} : null;
}

function selectRateLimits(result) {
  if (!result || typeof result !== "object") return null;
  const fallback = result.rateLimits && typeof result.rateLimits === "object" ? result.rateLimits : {};
  const preferred = result.rateLimitsByLimitId?.codex;
  if (!preferred || typeof preferred !== "object") return normalize(fallback);
  return normalize({...fallback,...preferred,
    primary:preferred.primary ?? fallback.primary,
    secondary:preferred.secondary ?? fallback.secondary,
    credits:preferred.credits ?? fallback.credits});
}

function reconcileUsage(current, previous, now = Date.now()/1000) {
  if (current?.source !== "live" || previous?.source !== "live") return current;
  const windows = new Map(current.windows.map(window=>[window.id,window]));
  for (const old of previous.windows || []) {
    if (windows.has(old.id)) continue;
    let resetsAt=old.resetsAt, used=old.used;
    if (numeric(resetsAt) && resetsAt <= now && numeric(old.minutes) && old.minutes > 0) {
      const duration=old.minutes*60;
      resetsAt += (Math.floor((now-resetsAt)/duration)+1)*duration;
      used=0;
    }
    windows.set(old.id,{...old,used,resetsAt,estimated:true});
  }
  return {...current,windows:[...windows.values()].sort((a,b)=>["primary","secondary"].indexOf(a.id)-["primary","secondary"].indexOf(b.id))};
}

function readLive(binary, {timeout = 15000, signal, spawnProcess = spawn} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Usage check cancelled."));
    const child = spawnProcess(binary, ["app-server"], {windowsHide:true, stdio:["pipe","pipe","ignore"], shell:false});
    let done = false, buffer = "", stage = 1;
    const timer = setTimeout(() => finish(new Error("Codex usage check timed out.")), timeout);
    const cancel = () => finish(new Error("Usage check cancelled."));
    signal?.addEventListener("abort", cancel, {once:true});
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      child.kill();
      error ? reject(error) : resolve(value);
    }
    function send(message) {child.stdin.write(JSON.stringify(message) + "\n");}
    child.on("error", () => finish(new Error("Cannot start Codex. Install its extension or set Credit Pulse: Codex Path.")));
    child.on("exit", () => finish(new Error("Codex exited before reporting usage.")));
    child.stdin.on("error", () => finish(new Error("Codex usage connection closed.")));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 2_000_000) return finish(new Error("Codex returned an oversized response."));
      let newline;
      while (!done && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try {message = JSON.parse(line);} catch {continue;}
        if (!isMessage(message) || message.id !== stage) continue;
        if (message.error) return finish(new Error("Codex could not report usage. Check your sign-in and network connection."));
        if (stage === 1) {
          stage = 2;
          send({method:"initialized",params:{}});
          send({id:2,method:"account/rateLimits/read",params:{}});
        } else {
          const result = message.result || {};
          const data = selectRateLimits(result);
          if (!data) return finish(new Error("No quota or credit data was reported for this account."));
          finish(null, {...data,source:"live",observedAt:Date.now()/1000,notice:null});
        }
      }
    });
    send({id:1,method:"initialize",params:{clientInfo:{name:"credit_pulse_vscode",title:"Credit Pulse",version}}});
  });
}

async function readSnapshot(home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex")) {
  const files = [];
  const budget={remaining:5000};
  async function walk(directory,depth=0) {
    if(depth>8||budget.remaining<=0)return;
    let entries;
    try {entries = await fs.readdir(directory, {withFileTypes:true});} catch {return;}
    for (const entry of entries) {
      if(--budget.remaining<0)return;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()&&!entry.isSymbolicLink()) await walk(file,depth+1);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {files.push({file,...await fs.stat(file)});} catch { /* A session may disappear during a scan. */ }
      }
    }
  }
  await walk(path.join(home, "sessions"));
  let latest = null;
  for (const file of files.sort((a,b) => b.mtimeMs-a.mtimeMs).slice(0,30)) {
    let handle;
    try {
      handle = await fs.open(file.file, "r");
      const buffer = Buffer.alloc(Math.min(file.size,2_000_000));
      const {bytesRead} = await handle.read(buffer,0,buffer.length,Math.max(0,file.size-buffer.length));
      for (const line of buffer.subarray(0,bytesRead).toString("utf8").split("\n")) {
        try {
          const event = JSON.parse(line);
          if(!isMessage(event))continue;
          const raw = event.payload?.rate_limits;
          if (event.type !== "event_msg" || event.payload?.type !== "token_count" || !raw || (raw.limit_id && raw.limit_id !== "codex")) continue;
          const data = normalize(raw), observedAt = Date.parse(event.timestamp)/1000;
          if (data && Number.isFinite(observedAt) && (!latest || observedAt > latest.observedAt)) latest = {...data,observedAt,source:"snapshot"};
        } catch { /* Ignore unrelated or partially written JSON lines. */ }
      }
    } catch { /* A locked log must not break the live monitor. */ }
    finally {await handle?.close();}
  }
  return latest;
}

function warningKeys(data, threshold, now = Date.now()/1000) {
  if (data?.source !== "live" || !numeric(data.observedAt) || now-data.observedAt > 120 || data.observedAt > now+30) return [];
  return data.windows.filter(w => w.used >= threshold && (!w.resetsAt || w.resetsAt > now)).map(w => ({
    key:`${w.id}:${w.resetsAt ?? Math.floor(now/3600)}:${threshold}:${w.used>=100?"limit":"warning"}`,
    message:`Codex ${w.id} window is ${Math.round(w.used)}% used.`
  }));
}
module.exports = {normalize,selectRateLimits,reconcileUsage,readLive,readSnapshot,warningKeys};
