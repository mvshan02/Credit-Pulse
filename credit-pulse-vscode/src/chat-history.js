"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createHash} = require("node:crypto");
const {redact,isMessage} = require("./privacy");

const cache = new Map();
let generation = 0;
const MAX_CHAT_BYTES = 8 * 1024 * 1024;
function clearChatHistory(){generation++;cache.clear();}
const TOKEN_FIELDS = ["input_tokens","cached_input_tokens","cache_write_input_tokens","output_tokens","reasoning_output_tokens","total_tokens"];

function tokens(raw) {
  if (!raw || typeof raw !== "object") return null;
  const result = {};
  for (const field of TOKEN_FIELDS) result[field] = Number.isFinite(raw[field]) ? raw[field] : 0;
  return Number.isFinite(raw.total_tokens) ? result : null;
}

function subtract(current, baseline) {
  if (!current) return null;
  const result = {};
  for (const field of TOKEN_FIELDS) result[field] = Math.max(0,current[field]-(baseline?.[field]??0));
  return result;
}

function promptPreview(message) {
  if (typeof message !== "string") return "Codex request";
  const marker = /#+\s*My request:\s*/gi;
  let match, start = 0;
  while ((match = marker.exec(message))) start = match.index + match[0].length;
  return message.slice(start).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g," ").replace(/[#>*`_\r\n]+/g," ").replace(/\s+/g," ").trim().slice(0,90) || "Codex request";
}

function responseText(payload) {
  if (!Array.isArray(payload?.content)) return "";
  return payload.content
    .filter(item=>isMessage(item) && item.type === "input_text" && typeof item.text === "string")
    .map(item=>item.text)
    .join("\n");
}

function parseChat(text, modifiedAt, fallbackId = "unknown", {includeText=false} = {}) {
  let meta = null, cumulative = null, contextWindow = null, active = null, firstPrompt = "", updatedAt = modifiedAt;
  const requests = [];
  for (const line of text.split("\n")) {
    let event;
    try {event = JSON.parse(line);} catch {continue;}
    if(!isMessage(event))continue;
    const stamp = Date.parse(event.timestamp);
    if (Number.isFinite(stamp)) updatedAt = Math.max(updatedAt,stamp);
    if (event.type === "session_meta" && event.payload && !meta) meta = event.payload;
    const payload = event.payload || {};
    if (event.type === "event_msg" && payload.type === "task_started") active = {startedAt:Number.isFinite(stamp)?stamp:updatedAt,baseline:cumulative,preview:"Codex request",usage:null,explicit:true,recorded:false};
    const legacyUser = event.type === "event_msg" && payload.type === "user_message";
    const currentUser = event.type === "response_item" && payload.type === "message" && payload.role === "user";
    if (legacyUser || currentUser) {
      const message = legacyUser ? payload.message : responseText(payload);
      const preview = includeText ? promptPreview(redact(message)) : "Request";
      if (!active || (active.recorded && !active.explicit)) active = {startedAt:Number.isFinite(stamp)?stamp:updatedAt,baseline:cumulative,preview,usage:null,explicit:false,recorded:false};
      else active.preview = preview;
      if (!active.recorded) { requests.push(active); active.recorded = true; }
      if (requests[0] === active) firstPrompt = preview;
    }
    if (event.type === "event_msg" && payload.type === "token_count") {
      const current = tokens(payload.info?.total_token_usage);
      if (current) {
        cumulative = current;
        contextWindow = Number.isFinite(payload.info?.model_context_window) ? payload.info.model_context_window : contextWindow;
        if (active) active.usage = subtract(current,active.baseline);
      }
    }
    if (event.type === "event_msg" && payload.type === "task_complete") active = null;
  }
  if (!meta && !cumulative) return null;
  if (meta?.parent_thread_id) return null;
  const id = createHash("sha256").update(String(meta?.id || meta?.session_id || fallbackId)).digest("hex").slice(0,24);
  const startedAt = Number.isFinite(Date.parse(meta?.timestamp)) ? Date.parse(meta.timestamp) : modifiedAt;
  return {id,title:firstPrompt || `Chat ${String(id).slice(0,8)}`,startedAt,updatedAt,
    requests:requests.slice(-8).map(request=>({
      startedAt:request.startedAt,preview:request.preview,usage:request.usage})),requestCount:requests.length,
    usage:cumulative,contextWindow};
}

async function collectFiles(directory, target, depth=0, budget={remaining:5000}) {
  if(depth>8||budget.remaining<=0)return;
  let entries;
  try {entries=await fs.readdir(directory,{withFileTypes:true});} catch {return;}
  for (const entry of entries) {
    if(--budget.remaining<0)return;
    const full=path.join(directory,entry.name);
    if (entry.isDirectory()&&!entry.isSymbolicLink()) await collectFiles(full,target,depth+1,budget);
    else if (entry.isFile()&&entry.name.endsWith(".jsonl")) {
      try {target.push({file:full,...await fs.stat(full)});} catch { /* Session may rotate during discovery. */ }
    }
  }
}

async function readChatHistory(home = process.env.CODEX_HOME || path.join(os.homedir(),".codex"), limit = 20, {includeText=false} = {}) {
  const revision=generation;
  const files=[];
  await collectFiles(path.join(home,"sessions"),files);
  const chats=[];
  for (const file of files.sort((a,b)=>b.mtimeMs-a.mtimeMs).slice(0,Math.max(limit,30))) {
    if(generation!==revision)return [];
    if(file.size>MAX_CHAT_BYTES)continue;
    const key=`${file.size}:${file.mtimeMs}:${includeText}`;
    let chat=cache.get(file.file);
    if (!chat || chat.key!==key) {
      try {
        const handle=await fs.open(file.file,"r");
        try {
          const buffer=Buffer.alloc(Math.min(file.size+1,MAX_CHAT_BYTES+1));
          const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
          chat={key,value:bytesRead>MAX_CHAT_BYTES?null:parseChat(buffer.subarray(0,bytesRead).toString("utf8"),file.mtimeMs,path.basename(file.file,".jsonl"),{includeText})};
        } finally {await handle.close();}
      }
      catch {chat={key,value:null};}
      if(generation!==revision)return [];
      cache.set(file.file,chat);
    }
    if (chat.value) chats.push(chat.value);
  }
  const unique=new Map();
  const activeFiles=new Set(files.slice(0,Math.max(limit,30)).map(file=>file.file));
  for(const key of cache.keys())if(!activeFiles.has(key))cache.delete(key);
  for (const chat of chats.sort((a,b)=>b.updatedAt-a.updatedAt)) if (!unique.has(chat.id)) unique.set(chat.id,chat);
  return [...unique.values()].slice(0,limit);
}

module.exports = {tokens,subtract,promptPreview,parseChat,readChatHistory,clearChatHistory};
