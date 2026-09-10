"use strict";
const path = require("node:path");
const fs = require("node:fs");
const {createHash} = require("node:crypto");
const TOKEN_FIELDS=["input_tokens","cached_input_tokens","cache_write_input_tokens","output_tokens","reasoning_output_tokens","total_tokens"];
const number=value=>Number.isFinite(value)&&value>=0?value:null;
function tokenSummary(raw){
  if(!isMessage(raw)||number(raw.total_tokens)===null)return null;
  return Object.fromEntries(TOKEN_FIELDS.map(key=>[key,number(raw[key])??0]));
}

function redact(text) {
  return String(text ?? "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,"[private key hidden]")
    .replace(/\b(?:sk-[\w-]+|gh[pousr]_[\w]+|github_pat_[\w]+|AKIA[A-Z0-9]{16})\b/g,"[credential hidden]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,"[token hidden]")
    .replace(/\b(Bearer)\s+[^\s,;]+/gi,"$1 [hidden]")
    .replace(/\b(password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*["']?[^\s,"';]+/gi,"$1=[hidden]");
}

function displayChats(chats, includeText = false) {
  return chats.filter(isMessage).slice(0,20).map((chat,index)=>({
    id:/^[a-f0-9]{24}$/.test(chat.id)?chat.id:createHash("sha256").update(String(chat.id)).digest("hex").slice(0,24),
    title:includeText ? redact(chat.title).slice(0,90) : `Chat ${index+1}`,
    startedAt:number(chat.startedAt),updatedAt:number(chat.updatedAt),requestCount:number(chat.requestCount)??0,
    usage:tokenSummary(chat.usage),contextWindow:number(chat.contextWindow),
    requests:(Array.isArray(chat.requests)?chat.requests:[]).filter(isMessage).slice(-8).map((request,index)=>({
      startedAt:number(request.startedAt),usage:tokenSummary(request.usage),
      preview:includeText ? redact(request.preview).slice(0,90) : `Request ${Math.max(1,(number(chat.requestCount)??0)-(chat.requests||[]).length+index+1)}`
    }))
  }));
}

function resolveExecutable({configured="",bundled="",pathValue=process.env.PATH||"",platform=process.platform,excluded=[]}) {
  const api=platform==="win32"?path.win32:path.posix;
  const available=file=>{try{return fs.statSync(file).isFile();}catch{return false;}};
  const canonical=file=>{try{return fs.realpathSync(file);}catch{return api.resolve(file);}};
  if(configured){
    if(!api.isAbsolute(configured)||!available(configured))throw new Error("Set Codex Path to an existing absolute executable path.");
    return canonical(configured);
  }
  if(bundled&&api.isAbsolute(bundled)&&available(bundled))return canonical(bundled);
  const inside=(directory,root)=>{
    const relative=api.relative(root,directory);
    return relative===""||(!relative.startsWith(".."+api.sep)&&relative!==".."&&!api.isAbsolute(relative));
  };
  for(const entry of pathValue.split(platform==="win32"?";":":")){
    const directory=entry.replace(/^"|"$/g,"");
    if(!api.isAbsolute(directory)||excluded.some(root=>inside(directory,root)))continue;
    const candidate=canonical(api.join(directory,platform==="win32"?"codex.exe":"codex"));
    if(excluded.some(root=>inside(candidate,canonical(root))))continue;
    if(available(candidate))return candidate;
  }
  throw new Error("Install the Codex extension or set an absolute Codex Path. Workspace executables are not launched automatically.");
}

function isMessage(value) {return value!==null&&typeof value==="object"&&!Array.isArray(value);}
module.exports={redact,displayChats,resolveExecutable,isMessage,tokenSummary};
