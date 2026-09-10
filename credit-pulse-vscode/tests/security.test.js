"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const os=require("node:os");
const path=require("node:path");
const {PassThrough,Writable}=require("node:stream");
const {EventEmitter}=require("node:events");
const {redact,displayChats,resolveExecutable}=require("../src/privacy");
const {parseChat,readChatHistory,clearChatHistory}=require("../src/chat-history");
const {readLive}=require("../src/usage");
const {DesktopOverlay}=require("../src/desktop-overlay");

test("private transport drops prompts, paths, source metadata and arbitrary fields",()=>{
  const raw=[{id:"opaque",title:"Private client strategy",workspace:"confidential-project",source:{apiKey:"secret"},requestCount:1,usage:{total_tokens:100,extra:"Private raw field"},requests:[{preview:"Secret prompt",usage:{total_tokens:100,extra:"Secret field"},raw:"password"}]}];
  const safe=displayChats(raw);
  assert.equal(safe[0].title,"Chat 1");assert.equal(safe[0].requests[0].preview,"Request 1");
  assert.doesNotMatch(JSON.stringify(safe),/Private|Secret|confidential|apiKey|password/);
  assert.equal(safe[0].usage.total_tokens,100);
});

test("opted-in excerpts redact common credential patterns before truncating",()=>{
  const sensitive=["sk-proj-"+"X".repeat(50),"ghp_"+"X".repeat(36),"password=veryPrivate","Bearer abcdefg","eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature"];
  for(const sample of sensitive)assert.ok(!redact(sample).includes(sample));
  const parsed=parseChat([null,{}, {type:"session_meta",payload:{id:"private-id",cwd:"C:/secret"}}, {type:"event_msg",payload:{type:"user_message",message:sensitive.join(" ")}}].map(JSON.stringify).join("\n"),Date.now(),"fallback",{includeText:true});
  assert.doesNotMatch(parsed.title,/sk-proj|ghp_|veryPrivate|abcdefg|eyJ/);
  assert.match(parsed.id,/^[a-f0-9]{24}$/);assert.equal(parsed.workspace,undefined);
});

test("current response-item sessions expose opted-in prompt excerpts once per task",()=>{
  const events=[
    {type:"session_meta",payload:{id:"current-schema"}},
    {type:"event_msg",payload:{type:"task_started"}},
    {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"# Context from my IDE setup:\nprivate context"}]}},
    {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"# My request:\nShow the actual content"}]}},
    {type:"event_msg",payload:{type:"token_count",info:{total_token_usage:{total_tokens:42,input_tokens:30,output_tokens:12}}}},
    {type:"event_msg",payload:{type:"task_complete"}}
  ];
  const hidden=parseChat(events.map(JSON.stringify).join("\n"),Date.now(),"fallback");
  assert.equal(hidden.requestCount,1);assert.equal(hidden.title,"Request");assert.equal(hidden.requests[0].preview,"Request");
  const visible=parseChat(events.map(JSON.stringify).join("\n"),Date.now(),"fallback",{includeText:true});
  assert.equal(visible.requestCount,1);assert.equal(visible.title,"Show the actual content");
  assert.equal(visible.requests[0].preview,"Show the actual content");assert.equal(visible.usage.total_tokens,42);
});

test("history text is not extracted by default and oversized logs are skipped",async()=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),"pulse-security-"));
  try {
    await fs.mkdir(path.join(home,"sessions"));
    const contents=[{type:"session_meta",payload:{id:"client-secret-id"}},{type:"event_msg",payload:{type:"user_message",message:"Private customer and password=do-not-emit"}}].map(JSON.stringify).join("\n");
    await fs.writeFile(path.join(home,"sessions","normal.jsonl"),contents);
    const huge=await fs.open(path.join(home,"sessions","huge.jsonl"),"w");
    await huge.truncate(9*1024*1024);await huge.close();
    const chats=await readChatHistory(home);assert.equal(chats.length,1);
    assert.doesNotMatch(JSON.stringify(chats),/Private|customer|do-not-emit|client-secret-id/);
    const pending=readChatHistory(home);clearChatHistory();
    assert.deepEqual(await pending,[],"Revoked in-flight reads cannot return cached results");
  } finally {clearChatHistory();await fs.rm(home,{recursive:true,force:true});}
});

test("automatic executable lookup ignores current/workspace and relative PATH entries",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"pulse-executable-"));
  const workspace=path.join(root,"workspace"),trusted=path.join(root,"trusted");
  try {
    await fs.mkdir(workspace);await fs.mkdir(trusted);
    const name=process.platform==="win32"?"codex.exe":"codex";
    await fs.writeFile(path.join(workspace,name),"not executed");await fs.writeFile(path.join(trusted,name),"not executed");
    assert.equal(resolveExecutable({pathValue:[".",workspace,trusted].join(path.delimiter),excluded:[workspace]}),path.join(trusted,name));
    assert.throws(()=>resolveExecutable({pathValue:workspace,excluded:[workspace]}),/not launched automatically/);
    const linked=path.join(root,"linked-workspace");
    await fs.symlink(workspace,linked,process.platform==="win32"?"junction":"dir");
    assert.throws(()=>resolveExecutable({pathValue:linked,excluded:[workspace]}),/not launched automatically/);
    assert.throws(()=>resolveExecutable({configured:"./codex.exe"}),/absolute/);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

function child(){
  const fake=new EventEmitter();fake.stdout=new PassThrough();fake.stderr=new PassThrough();fake.sent=[];
  fake.stdin=new Writable({write(chunk,encoding,callback){fake.sent.push(JSON.parse(chunk));callback();}});
  fake.kill=()=>{fake.killed=true;};return fake;
}

test("RPC rejects oversized output and ignores primitive JSON without shell execution",async()=>{
  const fake=child();
  const reading=readLive("trusted.exe",{spawnProcess:(binary,args,options)=>{assert.equal(options.shell,false);assert.deepEqual(args,["app-server"]);return fake;}});
  fake.stdout.write('null\n[]\n"x"\n');
  fake.stdout.write("x".repeat(2_000_001));
  await assert.rejects(reading,/oversized/);assert.equal(fake.killed,true);
});

test("desktop pipe ignores primitive JSON and rejects arbitrary actions",async()=>{
  const fake=child(),actions=[];
  const overlay=new DesktopOverlay("trusted.exe",{spawnProcess:()=>fake,onAction:action=>actions.push(action)});
  const opening=overlay.show();fake.stdout.write('null\n[]\n42\n{"type":"ready"}\n');await opening;
  fake.stdout.write('{"type":"action","action":"executeCommand"}\n');assert.deepEqual(actions,[]);
  overlay.publish({secret:"test"});overlay.dispose();assert.equal(overlay.latest,null);
});
