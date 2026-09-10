"use strict";
const {spawn} = require("node:child_process");
const {isMessage} = require("./privacy");

// Private redirected pipes keep usage data off network listeners and temporary files.
class DesktopOverlay {
  constructor(executable, {spawnProcess=spawn,onAction=()=>{},onPosition=()=>{},onError=()=>{},onChange=()=>{}}={}) {
    Object.assign(this,{executable,spawnProcess,onAction,onPosition,onError,onChange});
    this.child=null;this.ready=false;this.latest=null;this.starting=null;
  }
  publish(message) {this.latest=message;if(this.ready)this.send(message);}
  send(message) {
    if(this.child?.stdin.writable)this.child.stdin.write(JSON.stringify(message)+"\n");
  }
  async show(mode="bubble",position) {
    if(!["bubble","card"].includes(mode))throw new Error("Unknown desktop overlay mode.");
    if(this.child){await this.starting;this.send({type:"mode",mode});return;}
    const child=this.spawnProcess(this.executable,[],{windowsHide:true,stdio:["pipe","pipe","pipe"],shell:false});
    this.child=child;
    this.starting=new Promise((resolve,reject)=>{
      let buffer="",settled=false;
      const fail=error=>{
        if(!settled){settled=true;clearTimeout(timer);reject(error);}
        else if(this.child===child)this.onError(error);
        if(this.child===child)this.stop();
      };
      const timer=setTimeout(()=>fail(new Error("Desktop overlay did not start. Reinstall Credit Pulse or check Windows .NET Framework support.")),15000);
      child.once("error",()=>fail(new Error("Cannot start the desktop overlay. Reinstall the packaged Windows extension.")));
      child.stdin.on("error",()=>fail(new Error("The desktop overlay connection closed.")));
      child.stderr.resume();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data",chunk=>{
        buffer+=chunk;
        if(buffer.length>65536)return fail(new Error("Invalid desktop overlay response."));
        let newline;
        while((newline=buffer.indexOf("\n"))>=0){
          const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
          let message;try{message=JSON.parse(line);}catch{continue;}
          if(!isMessage(message))continue;
          if(message.type==="ready"&&!settled){
            settled=true;clearTimeout(timer);this.ready=true;
            this.send({type:"initialize",mode,position});
            if(this.latest)this.send(this.latest);
            this.onChange(true);resolve();
          } else if(message.type==="position"&&Number.isFinite(message.x)&&Number.isFinite(message.y)) {
            this.onPosition({x:message.x,y:message.y});
          } else if(message.type==="action"&&["refresh","open"].includes(message.action)) {
            this.onAction(message.action);
          } else if(message.type==="error")fail(new Error("The desktop overlay could not render. Reinstall the extension."));
        }
      });
      child.once("exit",()=>{
        clearTimeout(timer);
        if(!settled){settled=true;reject(new Error("Desktop overlay exited before startup completed."));}
        if(this.child===child){this.child=null;this.ready=false;this.starting=null;this.onChange(false);}
      });
    });
    await this.starting;
  }
  stop() {
    const child=this.child;this.child=null;this.ready=false;this.starting=null;
    if(child){child.stdin.end();child.kill();this.onChange(false);}
  }
  dispose(){this.stop();this.latest=null;}
}
module.exports={DesktopOverlay};
