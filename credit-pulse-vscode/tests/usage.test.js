"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {PassThrough,Writable} = require("node:stream");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {normalize,selectRateLimits,reconcileUsage,readLive,readSnapshot,warningKeys} = require("../src/usage");
const {tokens,subtract,promptPreview,parseChat,readChatHistory} = require("../src/chat-history");
const {usagePercent,pressurePercent,developerMetrics,recommendations,mascotState} = require("../src/insights");

test("missing, invalid and zero quota values stay distinct",()=>{
  assert.equal(normalize({}),null);
  for (const value of [null,undefined,true,"80",NaN,Infinity,-1]) assert.equal(normalize({primary:{usedPercent:value}}),null);
  assert.equal(normalize({primary:{used_percent:0}}).windows[0].used,0);
  assert.equal(normalize({credits:{balance:"0"}}).credits.balance,"0");
  assert.equal(normalize({credits:{unlimited:true}}).credits.unlimited,true);
});
test("live and snapshot schemas normalize identically",()=>{
  assert.deepEqual(normalize({primary:{usedPercent:50,windowDurationMins:300,resetsAt:1234},planType:"plus"}),
    normalize({primary:{used_percent:50,window_minutes:300,resets_at:1234},plan_type:"plus"}));
});
test("rate-limit selection fills a missing Codex session window from the account payload",()=>{
  const data=selectRateLimits({rateLimits:{primary:{usedPercent:4,windowDurationMins:300}},rateLimitsByLimitId:{codex:{secondary:{usedPercent:30,windowDurationMins:10080}}}});
  assert.deepEqual(data.windows.map(window=>[window.id,window.used]),[["primary",4],["secondary",30]]);
});
test("rollover reconciliation preserves or resets a temporarily omitted session window",()=>{
  const previous={source:"live",observedAt:900,windows:[{id:"primary",used:100,minutes:300,resetsAt:1000},{id:"secondary",used:20,minutes:10080,resetsAt:9000}]};
  const current={source:"live",observedAt:1001,windows:[{id:"secondary",used:21,minutes:10080,resetsAt:9000}]};
  const reconciled=reconcileUsage(current,previous,1001),primary=reconciled.windows[0];
  assert.equal(primary.id,"primary");
  assert.equal(primary.used,0);
  assert.equal(primary.resetsAt,19000);
  assert.equal(primary.estimated,true);
  const reported=reconcileUsage({...current,windows:[{id:"primary",used:3},{id:"secondary",used:21}]},reconciled,1010);
  assert.equal(reported.windows[0].used,3);
  assert.equal(reported.windows[0].estimated,undefined);
});
test("warnings exclude snapshots, expired windows and stale readings",()=>{
  const data = {source:"live",observedAt:1000,windows:[{id:"primary",used:80,resetsAt:2000}]};
  assert.equal(warningKeys(data,80,1000).length,1);
  assert.equal(warningKeys(data,85,1000).length,0);
  assert.equal(warningKeys({...data,source:"snapshot"},80,1000).length,0);
  assert.equal(warningKeys(data,80,1201).length,0);
  assert.equal(warningKeys({...data,observedAt:2100},80,2100).length,0);
  assert.notEqual(warningKeys(data,80,1000)[0].key,warningKeys({...data,windows:[{id:"primary",used:100,resetsAt:2000}]},80,1000)[0].key);
});
function fakeServer(onMessage) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => {child.killed=true;};
  child.stdin = new Writable({write(chunk,encoding,callback) {queueMicrotask(()=>onMessage(JSON.parse(chunk.toString()),child));callback();}});
  return child;
}
test("RPC handshake precedes rate lookup, ignores notifications and selects Codex bucket",async()=>{
  const methods=[];
  const child = fakeServer((message,child)=>{
    methods.push(message.method);
    if (message.id===1) child.stdout.write('{"id":1,"result":{}}\n');
    if (message.id===2) {
      child.stdout.write('{"method":"notification"}\n');
      child.stdout.write(JSON.stringify({id:2,result:{rateLimits:{primary:{usedPercent:90}},rateLimitsByLimitId:{codex:{primary:{usedPercent:22}}}}})+"\n");
    }
  });
  const result=await readLive("codex",{spawnProcess:()=>child});
  assert.deepEqual(methods,["initialize","initialized","account/rateLimits/read"]);
  assert.equal(result.windows[0].used,22);
  assert.equal(result.source,"live");
  assert.ok(child.killed);
});
test("RPC errors and timeouts stop the child",async()=>{
  const child=fakeServer((message,child)=>child.stdout.write(JSON.stringify({id:message.id,error:{message:"private error detail"}})+"\n"));
  await assert.rejects(readLive("codex",{spawnProcess:()=>child}),/could not report/);
  assert.ok(child.killed);
  const hung=fakeServer(()=>{});
  await assert.rejects(readLive("codex",{spawnProcess:()=>hung,timeout:10}),/timed out/);
  assert.ok(hung.killed);
});
test("cancellation stops the app server",async()=>{
  const child=fakeServer(()=>{}),controller=new AbortController();
  const read=readLive("codex",{spawnProcess:()=>child,signal:controller.signal});
  controller.abort();
  await assert.rejects(read,/cancelled/);
  assert.ok(child.killed);
});
test("snapshot selects event time, skips non-Codex data and partial JSON",async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),"pulse-test-"));
  try {
    await fs.mkdir(path.join(home,"sessions"));
    const event=(timestamp,used,id="codex")=>JSON.stringify({type:"event_msg",timestamp,payload:{type:"token_count",rate_limits:{limit_id:id,primary:{used_percent:used}}}});
    await fs.writeFile(path.join(home,"sessions/a.jsonl"),event("2026-09-07T10:00:00Z",45)+"\n"+event("2026-09-08T10:00:00Z",99,"other")+'\n{"partial":');
    await fs.writeFile(path.join(home,"sessions/b.jsonl"),event("2026-09-06T10:00:00Z",10));
    const result=await readSnapshot(home);
    assert.equal(result.windows[0].used,45);
    assert.equal(result.source,"snapshot");
  } finally {await fs.rm(home,{recursive:true,force:true});}
});
function line(type,payload,timestamp) {return JSON.stringify({type,payload,timestamp});}
function sessionFixture(overrides={}) {
  return [
    line("session_meta",{id:"chat-1",timestamp:"2026-09-07T09:00:00Z",cwd:"D:/work/pulse",source:"vscode",...overrides},"2026-09-07T09:00:00Z"),
    line("event_msg",{type:"task_started"},"2026-09-07T09:00:01Z"),
    line("event_msg",{type:"user_message",message:"# Context from my IDE setup:\nnoise\n\n## My request:\nBuild a quota dashboard"},"2026-09-07T09:00:02Z"),
    line("event_msg",{type:"token_count",info:{model_context_window:258000,total_token_usage:{input_tokens:1000,cached_input_tokens:600,output_tokens:200,reasoning_output_tokens:50,total_tokens:1200}}},"2026-09-07T09:00:03Z"),
    line("event_msg",{type:"task_complete"},"2026-09-07T09:00:04Z"),
    line("event_msg",{type:"task_started"},"2026-09-07T09:01:00Z"),
    line("event_msg",{type:"user_message",message:"Add request analytics"},"2026-09-07T09:01:01Z"),
    line("event_msg",{type:"token_count",info:{model_context_window:258000,total_token_usage:{input_tokens:1500,cached_input_tokens:900,output_tokens:350,reasoning_output_tokens:80,total_tokens:1850}}},"2026-09-07T09:01:03Z"),
    line("event_msg",{type:"task_complete"},"2026-09-07T09:01:04Z")
  ].join("\n");
}
test("token helpers preserve fields and clamp request deltas",()=>{
  const current=tokens({input_tokens:20,cached_input_tokens:10,total_tokens:25});
  assert.deepEqual(current,{input_tokens:20,cached_input_tokens:10,cache_write_input_tokens:0,output_tokens:0,reasoning_output_tokens:0,total_tokens:25});
  assert.equal(tokens({input_tokens:2}),null);
  assert.equal(subtract(current,{input_tokens:30,total_tokens:5}).input_tokens,0);
  assert.equal(subtract(current,{input_tokens:30,total_tokens:5}).total_tokens,20);
});
test("chat parser reports real chat and request token telemetry",()=>{
  const chat=parseChat(sessionFixture(),Date.parse("2026-09-07T09:00:00Z"),"unknown",{includeText:true});
  assert.match(chat.id,/^[a-f0-9]{24}$/);
  assert.equal(chat.title,"Build a quota dashboard");
  assert.equal(chat.workspace,undefined);
  assert.equal(chat.requestCount,2);
  assert.equal(chat.usage.total_tokens,1850);
  assert.equal(chat.requests[0].usage.total_tokens,1200);
  assert.equal(chat.requests[1].usage.total_tokens,650);
  assert.equal(chat.requests[1].usage.input_tokens,500);
  assert.equal(chat.contextWindow,258000);
  assert.equal(parseChat(sessionFixture({parent_thread_id:"parent"}),Date.now()),null);
});
test("prompt previews remove IDE wrappers without exposing markup",()=>{
  assert.equal(promptPreview("# IDE\nmeta\n## My request:\n**Make** the panel `fast`"),"Make the panel fast");
  assert.equal(promptPreview(null),"Codex request");
});
test("chat history discovers recent session files recursively",async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),"pulse-history-"));
  try {
    const directory=path.join(home,"sessions","2026","09","07");
    await fs.mkdir(directory,{recursive:true});
    await fs.writeFile(path.join(directory,"chat.jsonl"),sessionFixture());
    await fs.writeFile(path.join(directory,"subagent.jsonl"),sessionFixture({id:"sub",parent_thread_id:"chat-1"}));
    const chats=await readChatHistory(home,20,{includeText:true});
    assert.equal(chats.length,1);
    assert.equal(chats[0].title,"Build a quota dashboard");
  } finally {await fs.rm(home,{recursive:true,force:true});}
});
test("recommendations and mascot follow usage pressure and cache efficiency",()=>{
  const now=Date.parse("2026-09-07T09:00:00Z")/1000;
  const live={source:"live",windows:[{id:"primary",used:82,resetsAt:now+3600},{id:"secondary",used:91,resetsAt:now+86400}]};
  const chats=[parseChat(sessionFixture(),Date.now())];
  assert.equal(usagePercent(live),82);
  assert.equal(pressurePercent(live),91);
  assert.match(recommendations(live,chats,80,now)[0],/82% used with 18% headroom/);
  assert.match(recommendations(live,chats,80,now)[1],/long window is 91% used/);
  assert.match(recommendations(live,chats,80,now)[2],/reusing 60%/);
  assert.equal(developerMetrics(live,chats).cacheRatio,60);
  assert.equal(developerMetrics(live,chats).requestCount,2);
  assert.equal(mascotState({source:"live",windows:[{used:20}]},80).label,"SYSTEM NOMINAL");
  assert.equal(mascotState(live,80).label,"QUOTA RUNNING HOT");
  assert.equal(mascotState({source:"live",windows:[{used:100}]},80).label,"LIMIT CRITICAL");
  assert.equal(mascotState({source:"snapshot",windows:[{used:20}]},80).label,"SIGNAL LOST");
});
