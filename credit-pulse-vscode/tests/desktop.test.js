"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {EventEmitter}=require("node:events");
const {Writable,PassThrough}=require("node:stream");
const {DesktopOverlay}=require("../src/desktop-overlay");

function fakeChild(){
  const child=new EventEmitter();child.writes=[];child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,encoding,callback){child.writes.push(JSON.parse(chunk.toString()));callback();}});
  child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit("exit",0));};
  child.message=message=>child.stdout.write(JSON.stringify(message)+"\n");
  return child;
}
test("desktop bridge reuses one process, queues telemetry, and accepts only known actions",async()=>{
  const child=fakeChild(),actions=[],positions=[];let launches=0;
  const desktop=new DesktopOverlay("native.exe",{spawnProcess:(...args)=>{launches++;assert.equal(args[2].shell,false);return child;},onAction:action=>actions.push(action),onPosition:value=>positions.push(value)});
  const usage={type:"usage",data:{windows:[{id:"primary",used:13}]}};
  desktop.publish(usage);
  const opening=desktop.show("bubble",{x:-500,y:120});
  const second=desktop.show("card");
  child.message({type:"ready"});await opening;await second;
  assert.equal(launches,1);
  assert.deepEqual(child.writes,[{type:"initialize",mode:"bubble",position:{x:-500,y:120}},usage,{type:"mode",mode:"card"}]);
  child.message({type:"action",action:"refresh"});child.message({type:"action",action:"arbitraryCommand"});
  child.message({type:"position",x:-350,y:150});child.message({type:"position",x:"invalid",y:0});
  assert.deepEqual(actions,["refresh"]);assert.deepEqual(positions,[{x:-350,y:150}]);
  desktop.dispose();assert.equal(child.killed,true);assert.equal(desktop.ready,false);
});
test("desktop startup failure rejects and clears the child",async()=>{
  const child=fakeChild();const desktop=new DesktopOverlay("missing.exe",{spawnProcess:()=>child});
  const opening=desktop.show();child.emit("error",new Error("ENOENT"));
  await assert.rejects(opening,/Cannot start/);assert.equal(desktop.child,null);
});
test("closing the native window allows it to be launched again",async()=>{
  const children=[];const desktop=new DesktopOverlay("native.exe",{spawnProcess:()=>{const child=fakeChild();children.push(child);return child;}});
  let opening=desktop.show();children[0].message({type:"ready"});await opening;
  children[0].emit("exit",0);assert.equal(desktop.ready,false);
  opening=desktop.show();children[1].message({type:"ready"});await opening;
  assert.equal(children.length,2);desktop.dispose();
});
