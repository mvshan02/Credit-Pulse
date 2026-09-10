"use strict";
const host=acquireVsCodeApi(),$=selector=>document.querySelector(selector);
let state={openChats:[],openChatsInitialized:false},data=null,chats=[],advice=[],metrics={},busy=false,historyBusy=false,historyError="",desktopActive=false;
// Do not persist search text, prompt excerpts, or obsolete floating layouts.
host.setState(state);
let settings={threshold:80,notifications:true,emojiAnimations:true,historyEnabled:false,showRequestText:false,themePreset:"matrix",appearance:{safeColor:"#6dff8b",warningColor:"#ffd166",dangerColor:"#ff4d6d",panelBackground:"#050a07",panelSurface:"#0a1710",glowIntensity:90}};
const APPEARANCE_IDS={safeColor:"safe-color",warningColor:"warning-color",dangerColor:"danger-color",panelBackground:"panel-background",panelSurface:"panel-surface",glowIntensity:"glow"};
const PRESETS={
  matrix:{safeColor:"#6dff8b",warningColor:"#ffd166",dangerColor:"#ff4d6d",panelBackground:"#050a07",panelSurface:"#0a1710",glowIntensity:90},
  cyberpunk:{safeColor:"#00f5ff",warningColor:"#ffe66d",dangerColor:"#ff2bd6",panelBackground:"#080817",panelSurface:"#12122b",glowIntensity:95},
  operator:{safeColor:"#f5c451",warningColor:"#ff8a3d",dangerColor:"#ff3b30",panelBackground:"#0b0906",panelSurface:"#20150a",glowIntensity:72},
  ice:{safeColor:"#77e6ff",warningColor:"#bbd7ff",dangerColor:"#ff6584",panelBackground:"#071019",panelSurface:"#102637",glowIntensity:62},
  glass:{safeColor:"#7ff7df",warningColor:"#ffd27d",dangerColor:"#ff6685",panelBackground:"#0a1220",panelSurface:"#20344c",glowIntensity:68}
};

function formatTokens(value){if(!Number.isFinite(value))return "--";if(value>=1_000_000)return `${(value/1_000_000).toFixed(1)}M`;if(value>=1_000)return `${Math.round(value/1_000)}k`;return String(value);}
function resetTime(stamp){if(!stamp)return "RESET UNKNOWN";const minutes=Math.ceil((stamp-Date.now()/1000)/60);if(minutes<=0)return "RESET PASSED // SYNCING";return minutes>=1440?`RESET ${Math.floor(minutes/1440)}D ${Math.floor(minutes%1440/60)}H`:minutes>=60?`RESET ${Math.floor(minutes/60)}H ${minutes%60}M`:`RESET ${minutes}M`;}
function rgb(hex){return [1,3,5].map(index=>parseInt(hex.slice(index,index+2),16));}
function mix(a,b,amount){const right=rgb(b);return `#${rgb(a).map((value,index)=>Math.round(value+(right[index]-value)*amount).toString(16).padStart(2,"0")).join("")}`;}
function rgba(hex,alpha){const [r,g,b]=rgb(hex);return `rgba(${r},${g},${b},${alpha})`;}
function accentFor(used){const a=settings.appearance;if(used==null)return a.safeColor;if(used<=settings.threshold)return mix(a.safeColor,a.warningColor,Math.min(1,used/settings.threshold));return mix(a.warningColor,a.dangerColor,Math.min(1,(used-settings.threshold)/(100-settings.threshold)));}

function applyAppearance(pressure){
  const a=settings.appearance,accent=accentFor(pressure),glow=a.glowIntensity/100,root=document.documentElement.style;
  document.body.dataset.theme=settings.themePreset;
  root.setProperty("--accent",accent);root.setProperty("--accent-soft",rgba(accent,.22*glow));root.setProperty("--accent-glow",rgba(accent,.68*glow));root.setProperty("--panel",a.panelBackground);root.setProperty("--surface",a.panelSurface);root.setProperty("--ramp",`linear-gradient(90deg,${a.safeColor},${a.warningColor} 60%,${a.dangerColor})`);
  $("#theme-name").textContent=settings.themePreset.toUpperCase();
  for(const button of document.querySelectorAll(".themes button"))button.classList.toggle("active",button.dataset.theme===settings.themePreset);
}
function mascot(pressure,fresh){if(!fresh||pressure==null)return {face:"🤖",label:"SIGNAL LOST",mode:"quiet"};if(pressure>=100)return {face:"🤯",label:"LIMIT CRITICAL",mode:"limit"};if(pressure>=settings.threshold)return {face:"😬",label:"QUOTA RUNNING HOT",mode:"warning"};if(pressure>=55)return {face:"😎",label:"FLOW LOCKED",mode:"steady"};return {face:"🤖",label:"SYSTEM NOMINAL",mode:"cheer"};}
function robotFace(){
  return $("#robot-template").content.firstElementChild.cloneNode(true);
}
$("#mascot-face").replaceChildren(robotFace());
function applyMascot(status){
  $("#mascot-face").setAttribute("aria-label",status.label);$("#mascot-label").textContent=status.label;$("#console").dataset.mode=status.mode;
  document.body.classList.toggle("no-animation",!settings.emojiAnimations);
  const mouth=status.mode==="warning"||status.mode==="limit"?"M15 28Q20 23 25 28":"M15 25Q20 29 25 25";
  for(const path of document.querySelectorAll(".agent-face .bubble-mouth"))path.setAttribute("d",mouth);
  const lane=$("#cheer");
  if(!settings.emojiAnimations||status.mode==="quiet"){lane.replaceChildren();lane.hidden=true;return;}
  lane.hidden=false;if(lane.dataset.mode===status.mode&&lane.children.length)return;lane.dataset.mode=status.mode;
  lane.replaceChildren(...[0,1,2].map(index=>{const span=document.createElement("span");span.append(robotFace());span.style.setProperty("--delay",`${-(.6+index*1.3)}s`);return span;}));
}
function cachePercent(usage){return usage?.input_tokens>0?Math.round(usage.cached_input_tokens/usage.input_tokens*100):0;}

function renderAdvice(){
  const target=$("#advice");target.replaceChildren(...advice.map((text,index)=>{const item=document.createElement("article"),number=document.createElement("span"),copy=document.createElement("p");number.textContent=String(index+1).padStart(2,"0");copy.textContent=text;item.append(number,copy);return item;}));
  if(!advice.length){const item=document.createElement("article");item.innerHTML="<span>00</span><p>Gathering quota and chat telemetry for tailored guidance.</p>";target.append(item);}
}
function renderMetrics(){
  $("#metric-session").textContent=Number.isFinite(metrics.sessionRemaining)?`${Math.round(metrics.sessionRemaining)}%`:"--";
  $("#metric-cache").textContent=Number.isFinite(metrics.cacheRatio)?`${metrics.cacheRatio}%`:"--";
  $("#metric-average").textContent=formatTokens(metrics.averageRequestTokens);
  $("#metric-depth").textContent=metrics.requestCount?`${metrics.requestCount} REQ`:"--";
  $("#score-label").textContent=Number.isFinite(metrics.efficiencyScore)?`SCORE ${metrics.efficiencyScore}`:"SCORE --";
  $("#score-bar").style.width=`${metrics.efficiencyScore||0}%`;
}
function requestMatches(chat,query){return !query||chat.title.toLowerCase().includes(query)||chat.requests?.some(request=>request.preview.toLowerCase().includes(query));}
function setChatOpen(id,open){const ids=new Set(state.openChats||[]);open?ids.add(id):ids.delete(id);state.openChats=[...ids].slice(-20);state.openChatsInitialized=true;}
function renderChats(){
  const target=$("#chats"),query=$("#chat-filter").value.trim().toLowerCase();target.replaceChildren();
  if(!settings.historyEnabled){$("#chat-count").textContent="OFF";const empty=document.createElement("p");empty.className="empty";empty.textContent="CHAT HISTORY DISABLED IN CONFIG";target.append(empty);return;}
  if(historyBusy){$("#chat-count").textContent="SCANNING";const empty=document.createElement("p");empty.className="empty scanning";empty.textContent=settings.showRequestText?"LOADING PROMPT EXCERPTS...":"ANALYZING LOCAL HISTORY...";target.append(empty);return;}
  if(historyError){$("#chat-count").textContent="ERROR";const empty=document.createElement("p");empty.className="empty error";empty.textContent=historyError;target.append(empty);return;}
  const visible=chats.filter(chat=>requestMatches(chat,query)).slice(0,16);$("#chat-count").textContent=query?`${visible.length}/${chats.length}`:`${chats.length} CHATS`;
  if(!visible.length){const empty=document.createElement("p");empty.className="empty";empty.textContent=query?"NO MATCHING CHATS OR REQUESTS":"NO LOCAL CODEX CHAT TELEMETRY FOUND";target.append(empty);return;}
  if(!state.openChatsInitialized){state.openChats=[visible[0].id];state.openChatsInitialized=true;}
  for(const [index,chat] of visible.entries()){
    const card=document.createElement("article");card.className="chat";
    const toggle=document.createElement("button"),chevron=document.createElement("span"),head=document.createElement("span"),title=document.createElement("strong"),meta=document.createElement("small"),total=document.createElement("b"),body=document.createElement("div");
    const bodyId=`chat-body-${index}`,open=(state.openChats||[]).includes(chat.id);toggle.className="chat-toggle";toggle.type="button";toggle.setAttribute("aria-expanded",String(open));toggle.setAttribute("aria-controls",bodyId);chevron.className="chevron";chevron.textContent="›";title.textContent=chat.title;meta.textContent=`${new Date(chat.updatedAt).toLocaleString()} · ${chat.requestCount} REQUEST${chat.requestCount===1?"":"S"}`;total.textContent=formatTokens(chat.usage?.total_tokens);head.append(title,meta);toggle.append(chevron,head,total);
    body.id=bodyId;body.className="chat-body";body.hidden=!open;
    const stats=[["INPUT",formatTokens(chat.usage?.input_tokens)],["CACHE",`${cachePercent(chat.usage)}%`],["OUTPUT",formatTokens(chat.usage?.output_tokens)],["REASON",formatTokens(chat.usage?.reasoning_output_tokens)]];const grid=document.createElement("div");grid.className="chat-stats";
    for(const [label,value] of stats){const stat=document.createElement("span"),small=document.createElement("small"),strong=document.createElement("strong");small.textContent=label;strong.textContent=value;stat.append(small,strong);grid.append(stat);}body.append(grid);
    if(chat.workspace){const workspace=document.createElement("p");workspace.className="workspace";workspace.textContent=`WORKSPACE · ${chat.workspace}`;body.append(workspace);}
    const requestList=document.createElement("div");requestList.className="requests";const recent=[...(chat.requests||[])].reverse().slice(0,8);
    for(const [requestIndex,request] of recent.entries()){const row=document.createElement("article"),number=document.createElement("span"),content=document.createElement("div"),prompt=document.createElement("strong"),detail=document.createElement("small"),usage=request.usage||{};number.textContent=String(chat.requestCount-requestIndex).padStart(2,"0");prompt.textContent=request.preview;detail.textContent=`${new Date(request.startedAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} · ${formatTokens(usage.total_tokens)} TOTAL · ${formatTokens(usage.input_tokens)} IN · ${formatTokens(usage.output_tokens)} OUT`;content.append(prompt,detail);row.append(number,content);requestList.append(row);}body.append(requestList);
    toggle.addEventListener("click",()=>{const next=toggle.getAttribute("aria-expanded")!=="true";toggle.setAttribute("aria-expanded",String(next));body.hidden=!next;setChatOpen(chat.id,next);});
    card.append(toggle,body);target.append(card);
  }
}

function renderCore(){
  const quotaWindows=data?.windows||[],primary=quotaWindows.find(window=>window.id==="primary"),secondary=quotaWindows.find(window=>window.id==="secondary"),pressure=quotaWindows.length?Math.max(...quotaWindows.map(window=>window.used)):null,display=primary||secondary,fresh=data?.source==="live"&&Date.now()/1000-data.observedAt<=120;
  applyAppearance(pressure);applyMascot(mascot(pressure,fresh));
  $("#usage").textContent=display?`${Math.round(display.used)}%`:"--";$("#gauge-kind").textContent=primary?"5H SESSION":"LONG WINDOW";$("#estimate-badge").hidden=!primary?.estimated;$("#ring").style.strokeDashoffset=521.505*(1-Math.min(display?.used??0,100)/100);$("#ring").style.stroke=accentFor(display?.used);
  $("#source").textContent=!data?"CONNECTING":fresh?"LINK · LIVE":data.source==="unavailable"?"LINK · DOWN":"LINK · ARCHIVE";$("#health").textContent=pressure==null?"UNKNOWN":!fresh?"LAST OBSERVED":pressure>=100?"LIMIT":pressure>=settings.threshold?"HOT":pressure>=55?"ACTIVE":"NOMINAL";
  $("#pressure-copy").textContent=`SESSION ${primary?Math.round(primary.used)+"%":"--"} · LONG ${secondary?Math.round(secondary.used)+"%":"--"}`;
  for(const id of ["primary","secondary"]){const window=quotaWindows.find(item=>item.id===id),root=$(`#${id}`);$(`#${id}-used`).textContent=window?`${Math.round(window.used)}%`:"--";$(`#${id}-duration`).textContent=!window?.minutes?"":window.minutes>=1440?`· ${+(window.minutes/1440).toFixed(1)}D`:`· ${+(window.minutes/60).toFixed(1)}H`;const bar=root.querySelector(".bar");bar.firstElementChild.style.width=`${Math.min(window?.used??0,100)}%`;bar.firstElementChild.style.background=accentFor(window?.used);window?bar.setAttribute("aria-valuenow",Math.min(window.used,100)):bar.removeAttribute("aria-valuenow");root.querySelector(".reset").textContent=resetTime(window?.resetsAt);const estimate=root.querySelector(".estimate");if(estimate)estimate.hidden=!window?.estimated;}
  $("#credits").textContent=data?.credits?.unlimited?"∞":data?.credits?.balance??"--";$("#notice").hidden=!data?.notice;$("#notice").textContent=data?.notice||"";$("#observed").textContent=data?.observedAt?`${fresh?"SYNC":"OBS"} · ${new Date(data.observedAt*1000).toLocaleTimeString()}`:"WAITING FOR CODEX";$("#refresh").disabled=busy;$("#refresh span").textContent=busy?"SYNCING":"REFRESH";
  if(document.activeElement!==$("#threshold"))$("#threshold").value=settings.threshold;$("#threshold-value").textContent=`${settings.threshold}%`;$("#notifications").checked=settings.notifications;$("#emoji-animations").checked=settings.emojiAnimations;$("#history-enabled").checked=settings.historyEnabled;
  $("#show-request-text").checked=settings.showRequestText;$("#show-request-text").disabled=!settings.historyEnabled;
  const historyState=$("#history-state");
  historyState.classList.toggle("error",Boolean(historyError));
  historyState.textContent=!settings.historyEnabled?"History analysis is off. Enable it before revealing excerpts.":historyBusy?(settings.showRequestText?"Reading and masking recent prompt excerpts...":"Reading numeric history from local Codex sessions..."):historyError||(!chats.length?"History is enabled, but no compatible local Codex sessions were found.":settings.showRequestText?`Prompt excerpts are visible for ${chats.length} recent chat${chats.length===1?"":"s"}.`:`${chats.length} chat${chats.length===1?"":"s"} analyzed privately. Prompt excerpts remain hidden.`);
  for(const [key,id] of Object.entries(APPEARANCE_IDS))if(document.activeElement!==$(`#${id}`)&&settings.appearance[key]!=null)$(`#${id}`).value=settings.appearance[key];$("#glow-value").textContent=`${settings.appearance.glowIntensity}%`;
}
function render(){renderCore();renderMetrics();renderAdvice();renderChats();}

window.addEventListener("message",event=>{const message=event.data;if(message?.type!=="usage")return;data=message.data;settings=message.settings;chats=message.chats||[];advice=message.advice||[];metrics=message.metrics||{};busy=message.busy;historyBusy=Boolean(message.historyBusy);historyError=message.historyError||"";
  desktopActive=Boolean(message.desktopActive);
  const button=$("#desktop-toggle");button.disabled=!message.desktopSupported||Boolean(message.desktopStarting);
  button.setAttribute("aria-pressed",String(desktopActive));
  button.setAttribute("aria-label",desktopActive?"Hide desktop overlay":"Show desktop overlay");
  button.firstChild.nodeValue=desktopActive?"HIDE OVERLAY ":"DESKTOP ";
  $("#desktop-note").textContent=message.desktopError||(!message.desktopSupported?"Desktop overlay is available on Windows.":message.desktopStarting?"Starting desktop overlay...":desktopActive?"Drag the robot anywhere. Click it to expand.":"Desktop opens an always-on-top robot. Your dashboard stays here.");
  $("#desktop-note").classList.toggle("error",Boolean(message.desktopError));
  render();});
$("#desktop-toggle").addEventListener("click",()=>host.postMessage(desktopActive?{type:"closeDesktop"}:{type:"desktop",mode:"bubble"}));
$("#chat-filter").addEventListener("input",renderChats);
$("#threshold").addEventListener("input",event=>{$("#threshold-value").textContent=`${event.target.value}%`;});$("#threshold").addEventListener("change",event=>{settings.threshold=Number(event.target.value);renderCore();host.postMessage({type:"threshold",value:settings.threshold});});
$("#notifications").addEventListener("change",event=>{settings.notifications=event.target.checked;host.postMessage({type:"notifications",value:event.target.checked});});$("#emoji-animations").addEventListener("change",event=>{settings.emojiAnimations=event.target.checked;renderCore();host.postMessage({type:"emojiAnimations",value:event.target.checked});});
for(const [id,key] of [["history-enabled","historyEnabled"],["show-request-text","showRequestText"]])$(`#${id}`).addEventListener("change",event=>{
  settings[key]=event.target.checked;historyBusy=settings.historyEnabled;historyError="";chats=[];advice=[];metrics={};state.openChats=[];state.openChatsInitialized=false;$("#chat-filter").value="";render();
  host.postMessage({type:key,value:event.target.checked});
});
for(const button of document.querySelectorAll(".themes button"))button.addEventListener("click",()=>{settings.themePreset=button.dataset.theme;settings.appearance={...PRESETS[button.dataset.theme]};renderCore();host.postMessage({type:"themePreset",value:button.dataset.theme});});
function sendAppearance(){const value={};for(const [key,id] of Object.entries(APPEARANCE_IDS))value[key]=id==="glow"?Number($(`#${id}`).value):$(`#${id}`).value;settings.themePreset="custom";settings.appearance={...settings.appearance,...value};renderCore();host.postMessage({type:"appearance",value});}
for(const id of Object.values(APPEARANCE_IDS))$(`#${id}`).addEventListener("change",sendAppearance);$("#glow").addEventListener("input",event=>{$("#glow-value").textContent=`${event.target.value}%`;});$("#reset-colors").addEventListener("click",()=>{settings.themePreset="matrix";settings.appearance={...PRESETS.matrix};renderCore();host.postMessage({type:"resetAppearance"});});
$("#refresh").addEventListener("click",()=>host.postMessage({type:"refresh"}));$("#copy-snapshot").addEventListener("click",()=>host.postMessage({type:"copySnapshot"}));
render();
host.postMessage({type:"ready"});setInterval(renderCore,15000);
