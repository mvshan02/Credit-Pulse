"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const {createRequire}=require("node:module");
const root=path.resolve(__dirname,"..");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fixture=()=>[{id:"private-session-id",title:"PRIVATE_CLIENT_PLAN",workspace:"PRIVATE_PROJECT",requestCount:9,
  usage:{input_tokens:1000,cached_input_tokens:800,total_tokens:1200},
  requests:[{preview:"PRIVATE_REQUEST",startedAt:Date.now(),usage:{input_tokens:100,total_tokens:100}},{preview:"PRIVATE_REQUEST",startedAt:Date.now(),usage:{input_tokens:500,total_tokens:1000}}]}];

function harness({history=false,text=false,reader=async()=>fixture(),liveFails=false}={}){
  let listener,provider,messageHandler,clipboard="",historyReads=0,snapshotReads=0,cacheClears=0,overlay;
  const commands=new Map(),posted=[],updates=[],subscriptions=[];
  const values={historyEnabled:history,showRequestText:text};
  const disposable={dispose(){}};
  const status={...disposable};
  const config={get:(key,fallback)=>Object.hasOwn(values,key)?values[key]:fallback,
    update:async(key,value)=>{values[key]=value;updates.push(key);listener({affectsConfiguration:section=>section==="creditPulse"||section===`creditPulse.${key}`});}};
  class MarkdownString {constructor(){this.value="";}appendMarkdown(text){this.value+=text;}}
  class DesktopOverlay {constructor(){overlay=this;this.ready=false;this.latest=null;}publish(message){this.latest=JSON.parse(JSON.stringify(message));}async show(){this.ready=true;}stop(){this.ready=false;}dispose(){this.latest=null;}}
  const vscode={StatusBarAlignment:{Right:1},ConfigurationTarget:{Global:1},MarkdownString,
    ThemeColor:class {},Uri:{joinPath:(base,...parts)=>path.join(base,...parts)},
    window:{createStatusBarItem:()=>({...status,show(){}}),registerWebviewViewProvider:(id,value)=>{provider=value;return disposable;},
      showInformationMessage:async()=>{},showErrorMessage:async()=>{},showWarningMessage:async()=>{},setStatusBarMessage:()=>{}},
    workspace:{workspaceFolders:[],getConfiguration:()=>config,onDidChangeConfiguration:callback=>{listener=callback;return disposable;}},
    extensions:{getExtension:()=>null},commands:{registerCommand:(id,callback)=>{commands.set(id,callback);return disposable;},executeCommand:async id=>commands.get(id)?.()},
    env:{clipboard:{writeText:async value=>{clipboard=value;}}}};
  let bar;
  vscode.window.createStatusBarItem=()=>{bar={show(){},dispose(){}};return bar;};
  const localRequire=createRequire(path.join(root,"src/extension.js"));
  const exported={};
  vm.runInNewContext(fs.readFileSync(path.join(root,"src/extension.js"),"utf8"),{
    exports:exported,process,AbortController,setInterval:()=>1,clearInterval:()=>{},
    require:name=>name==="vscode"?vscode:name==="./desktop-overlay"?{DesktopOverlay}:
      name==="./privacy"?{...localRequire(name),resolveExecutable:()=>"trusted.exe"}:
      name==="./chat-history"?{readChatHistory:async(...args)=>{historyReads++;return reader(...args);},clearChatHistory:()=>{cacheClears++;}}:
      name==="./usage"?{...localRequire(name),readLive:async()=>{if(liveFails)throw new Error("offline");return {source:"live",observedAt:Date.now()/1000,windows:[{id:"primary",used:20}],plan:"PRIVATE_ACCOUNT"};},readSnapshot:async()=>{snapshotReads++;return null;}}:localRequire(name)
  },{filename:"extension.js"});
  exported.activate({subscriptions,extensionPath:root,extensionUri:root,globalState:{get:(key,fallback)=>fallback,update:async()=>{}}});
  provider.resolveWebviewView({webview:{options:{},cspSource:"vscode-resource:",asWebviewUri:uri=>uri,postMessage:message=>{posted.push(JSON.parse(JSON.stringify(message)));},onDidReceiveMessage:callback=>{messageHandler=callback;return disposable;}},onDidDispose:()=>{}});
  return {posted,updates,commands,config,receive:message=>messageHandler(message),
    get overlay(){return overlay;},get tooltip(){return bar.tooltip.value;},get clipboard(){return clipboard;},
    get counts(){return {historyReads,snapshotReads,cacheClears};},dispose:()=>subscriptions.forEach(item=>item.dispose())};
}

test("host defaults never read session logs, including offline snapshot fallback",async()=>{
  const host=harness({liveFails:true});
  try {await tick();assert.equal(host.counts.historyReads,0);assert.equal(host.counts.snapshotReads,0);assert.deepEqual(host.posted.at(-1).chats,[]);}
  finally {host.dispose();}
});

test("host keeps text in opted-in dashboard only, never desktop, hover or clipboard",async()=>{
  const host=harness({history:true,text:true});
  try {
    await tick();await host.receive({type:"ready"});
    assert.match(JSON.stringify(host.posted.at(-1)),/PRIVATE_CLIENT_PLAN/);
    assert.doesNotMatch(JSON.stringify(host.overlay.latest),/PRIVATE_/);
    assert.doesNotMatch(host.tooltip,/PRIVATE_/);
    await host.commands.get("creditPulse.copySnapshot")();
    assert.doesNotMatch(host.clipboard,/PRIVATE_/);assert.match(host.clipboard,/Processed tokens: 1200/);
    await host.config.update("showRequestText",false);await tick();
    assert.doesNotMatch(JSON.stringify(host.posted.at(-1)),/PRIVATE_/);
    await host.config.update("historyEnabled",false);await tick();
    assert.deepEqual(host.overlay.latest.chats,[]);
    assert.ok(host.counts.cacheClears>=2);
  } finally {host.dispose();}
});

test("enabling history and then excerpts completes both rescans in order",async()=>{
  const host=harness();
  try {
    await tick();
    await host.receive({type:"historyEnabled",value:true});await tick();await tick();
    assert.equal(host.config.get("historyEnabled"),true);
    assert.equal(host.posted.at(-1).historyBusy,false);
    assert.equal(host.posted.at(-1).historyError,"");
    assert.equal(host.posted.at(-1).chats[0].title,"Chat 1");
    assert.equal(host.posted.at(-1).chats[0].requests[0].preview,"Request 8");
    await host.receive({type:"showRequestText",value:true});await tick();await tick();
    assert.equal(host.config.get("showRequestText"),true);
    assert.equal(host.posted.at(-1).historyBusy,false);
    assert.equal(host.posted.at(-1).chats[0].title,"PRIVATE_CLIENT_PLAN");
    assert.equal(host.posted.at(-1).chats[0].requests[0].preview,"PRIVATE_REQUEST");
  } finally {host.dispose();}
});

test("late history results cannot repopulate a revoked history setting",async()=>{
  let complete;
  const pending=new Promise(resolve=>{complete=resolve;});
  const host=harness({history:true,text:true,reader:()=>pending});
  try {
    await tick();await host.config.update("historyEnabled",false);
    const boundary=host.posted.length;
    complete(fixture());await tick();await tick();
    for(const message of host.posted.slice(boundary))assert.doesNotMatch(JSON.stringify(message),/PRIVATE_/);
    assert.equal(host.posted.at(-1).chats.length,0);assert.equal(host.overlay.latest.chats.length,0);
  } finally {host.dispose();}
});

test("a failed history read degrades to empty analytics without failing quota refresh",async()=>{
  const host=harness({history:true,reader:async()=>{throw new Error("synthetic read failure");}});
  try {await tick();assert.equal(host.posted.at(-1).chats.length,0);assert.equal(host.posted.at(-1).historyBusy,false);assert.match(host.posted.at(-1).historyError,/Could not read/);assert.equal(host.posted.at(-1).data.windows[0].used,20);}
  finally {host.dispose();}
});

test("host rejects malformed settings, prototype keys and arbitrary command messages",async()=>{
  const host=harness();
  try {
    await tick();
    for(const message of [null,[],42,{type:"themePreset",value:"__proto__"},{type:"themePreset",value:"constructor"},
      {type:"appearance",value:[]},{type:"historyEnabled",value:"true"},{type:"threshold",value:999},
      {type:"desktop",mode:"exec"},{type:"executeCommand",command:"workbench.action.terminal.new"}])await host.receive(message);
    assert.deepEqual(host.updates,[]);assert.equal(host.overlay.ready,false);
  } finally {host.dispose();}
});
