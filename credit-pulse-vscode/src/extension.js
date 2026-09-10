"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const {randomBytes} = require("node:crypto");
const {readLive,readSnapshot,reconcileUsage,warningKeys} = require("./usage");
const {readChatHistory,clearChatHistory} = require("./chat-history");
const {displayChats,resolveExecutable,isMessage} = require("./privacy");
const {DesktopOverlay} = require("./desktop-overlay");
const {recommendations,usagePercent,pressurePercent,developerMetrics,mascotState} = require("./insights");

const DEFAULT_COLORS = {
  safeColor:"#79ff9b",warningColor:"#ffe66d",dangerColor:"#ff6b72",
  panelBackground:"#0d1712",panelSurface:"#17271f",glowIntensity:75
};
const COLOR_KEYS = ["safeColor","warningColor","dangerColor","panelBackground","panelSurface"];
const validColor = value => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const PRESETS = {
  matrix:{safeColor:"#6dff8b",warningColor:"#ffd166",dangerColor:"#ff4d6d",panelBackground:"#050a07",panelSurface:"#0a1710",glowIntensity:90},
  cyberpunk:{safeColor:"#00f5ff",warningColor:"#ffe66d",dangerColor:"#ff2bd6",panelBackground:"#080817",panelSurface:"#12122b",glowIntensity:95},
  operator:{safeColor:"#f5c451",warningColor:"#ff8a3d",dangerColor:"#ff3b30",panelBackground:"#0b0906",panelSurface:"#20150a",glowIntensity:72},
  ice:{safeColor:"#77e6ff",warningColor:"#bbd7ff",dangerColor:"#ff6584",panelBackground:"#071019",panelSurface:"#102637",glowIntensity:62},
  glass:{safeColor:"#7ff7df",warningColor:"#ffd27d",dangerColor:"#ff6685",panelBackground:"#0a1220",panelSurface:"#20344c",glowIntensity:68}
};
const escapeMarkdown = value => String(value??"").replace(/[\\`*_{}\[\]()#+\-.!|>]/g,"\\$&");
const tokenLabel = value => !Number.isFinite(value) ? "--" : value>=1000000 ? `${(value/1000000).toFixed(1)}M` : value>=1000 ? `${Math.round(value/1000)}k` : String(value);

function activate(context) {
  const webviews = new Set();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = "Credit Pulse";
  status.command = "creditPulse.open";
  status.text = "$(pulse) Codex --";
  status.show();
  let data = null, chats = [], busy = false, disposed = false, timer, lastAttempt = 0, abort;
  let desktopStarting = false, desktopError = "";
  let historyGeneration = 0, historyBusy = false, historyError = "";
  const desktop = new DesktopOverlay(path.join(context.extensionPath,"desktop","bin","CreditPulse.Desktop.exe"),{
    onAction(action){
      if(action==="refresh")void refresh();
      if(action==="open")void vscode.commands.executeCommand("creditPulse.open");
    },
    onPosition(position){void context.globalState.update("desktopOverlayPosition",position);},
    onError(error){desktopError=error.message;broadcast();void vscode.window.showErrorMessage(`Credit Pulse: ${error.message}`);},
    onChange(){broadcast();}
  });
  let seen = new Set(context.globalState.get("warningKeys", []));
  const config = () => vscode.workspace.getConfiguration("creditPulse");
  const settings = () => {
    const source = config();
    const selected=source.get("themePreset","matrix");
    const themePreset=selected==="custom"||Object.hasOwn(PRESETS,selected) ? selected : "matrix";
    const appearance=themePreset==="custom" ? {} : {...PRESETS[themePreset]};
    if (themePreset==="custom") {
      for (const key of COLOR_KEYS) {
        const value=source.get(key,DEFAULT_COLORS[key]);
        appearance[key]=validColor(value)?value:DEFAULT_COLORS[key];
      }
      appearance.glowIntensity=Math.min(100,Math.max(0,Number(source.get("glowIntensity",75))||0));
    }
    return {threshold:source.get("warningThreshold",80),notifications:source.get("notifications",true),
      emojiAnimations:source.get("emojiAnimations",true),historyEnabled:source.get("historyEnabled",false),
      showRequestText:source.get("showRequestText",false),themePreset,appearance};
  };

  function tooltipFor(currentSettings) {
    const mascot=mascotState(data,currentSettings.threshold);
    const primary=data?.windows?.find(window=>window.id==="primary"),secondary=data?.windows?.find(window=>window.id==="secondary");
    const privateChats=currentSettings.historyEnabled?displayChats(chats):[];
    const advice=recommendations(data,privateChats,currentSettings.threshold)[0];
    const tooltip=new vscode.MarkdownString(undefined,true);
    tooltip.supportThemeIcons=true;
    tooltip.appendMarkdown(`### $(hubot) CREDIT PULSE · ${mascot.label}\n\n`);
    tooltip.appendMarkdown(`$(pulse) **Session:** ${primary?Math.round(primary.used)+"%":"--"} &nbsp; $(history) **Long:** ${secondary?Math.round(secondary.used)+"%":"--"}\n\n`);
    if (privateChats[0]) tooltip.appendMarkdown(`$(comment-discussion) **Latest chat:** ${escapeMarkdown(privateChats[0].title)}  \n$(request-changes) ${privateChats[0].requestCount} requests · ${tokenLabel(privateChats[0].usage?.total_tokens)} tokens processed\n\n`);
    tooltip.appendMarkdown(`$(lightbulb) ${escapeMarkdown(advice)}\n\n_Click to open the in-window console._`);
    return tooltip;
  }

  function broadcast() {
    if (disposed) return;
    const currentSettings=settings();
    const privateChats=currentSettings.historyEnabled?displayChats(chats):[];
    const visibleChats=currentSettings.historyEnabled?displayChats(chats,currentSettings.showRequestText):[];
    const metrics=developerMetrics(data,privateChats);
    const payload={type:"usage",data:data?{source:data.source,observedAt:data.observedAt,windows:data.windows,credits:data.credits,notice:data.notice}:null,busy,historyBusy,historyError,settings:currentSettings,metrics};
    desktop.publish({...payload,chats:privateChats,advice:recommendations(data,privateChats,currentSettings.threshold)});
    Object.assign(payload,{chats:visibleChats,advice:recommendations(data,visibleChats,currentSettings.threshold)});
    for (const webview of webviews) void webview.postMessage({...payload,desktopSupported:process.platform==="win32",desktopActive:desktop.ready,desktopStarting,desktopError});
    const session=usagePercent(data),pressure=pressurePercent(data),mascot=mascotState(data,currentSettings.threshold);
    const primary=data?.windows?.find(window=>window.id==="primary"),secondary=data?.windows?.find(window=>window.id==="secondary");
    const fresh = data?.source === "live" && Date.now()/1000-data.observedAt <= 120;
    status.text = `$(pulse) S ${primary?Math.round(primary.used)+"%":"--"} · L ${secondary?Math.round(secondary.used)+"%":"--"}${data && !fresh ? " ~" : ""}`;
    status.tooltip=tooltipFor(currentSettings);
    status.accessibilityInformation={label:`Credit Pulse. Codex session usage ${session===null?"unknown":Math.round(session)+" percent"}. ${mascot.label}.`};
    status.backgroundColor = fresh && pressure >= currentSettings.threshold ? new vscode.ThemeColor(pressure>=100 ? "statusBarItem.errorBackground" : "statusBarItem.warningBackground") : undefined;
  }

  async function showDesktop(mode="bubble") {
    if(desktopStarting)return;
    if(process.platform!=="win32"){
      void vscode.window.showInformationMessage("Desktop overlay requires Windows. The usage dashboard works inside VS Code on this platform.");return;
    }
    desktopStarting=true;desktopError="";broadcast();
    try {await desktop.show(mode==="card"?"card":"bubble",context.globalState.get("desktopOverlayPosition"));}
    catch(error){desktopError=error.message;void vscode.window.showErrorMessage(`Credit Pulse: ${error.message}`);}
    finally{desktopStarting=false;broadcast();}
  }

  async function copySnapshot() {
    const primary=data?.windows?.find(window=>window.id==="primary"),secondary=data?.windows?.find(window=>window.id==="secondary"),latest=settings().historyEnabled?displayChats(chats)[0]:null;
    const lines=["Credit Pulse snapshot",`Observed: ${data?.observedAt?new Date(data.observedAt*1000).toISOString():"unavailable"}`,
      `Session: ${primary?Math.round(primary.used)+"%":"--"}${primary?.estimated?" (estimated after reset)":""}`,
      `Long window: ${secondary?Math.round(secondary.used)+"%":"--"}`];
    if (latest) lines.push(`Latest chat: ${latest.title}`,`Requests: ${latest.requestCount}`,`Processed tokens: ${latest.usage?.total_tokens??"--"}`);
    await vscode.env.clipboard.writeText(lines.join("\n"));
    void vscode.window.setStatusBarMessage("$(check) Credit Pulse snapshot copied",2500);
  }

  function binary() {
    const configured = config().get("codexPath", "").trim();
    const codex = vscode.extensions.getExtension("openai.chatgpt");
    const bundled=codex&&process.platform==="win32"?path.join(codex.extensionPath,"bin",`windows-${process.arch === "arm64" ? "aarch64" : "x86_64"}`,"codex.exe"):"";
    return resolveExecutable({configured,bundled,excluded:[process.cwd(),...(vscode.workspace.workspaceFolders||[]).map(folder=>folder.uri.fsPath)]});
  }

  async function refresh() {
    if (disposed || busy || Date.now()-lastAttempt < 5000) return;
    lastAttempt = Date.now();
    const revision=historyGeneration,currentSettings=settings();
    busy = true;historyBusy=currentSettings.historyEnabled;historyError="";broadcast();abort = new AbortController();
    const chatPromise=currentSettings.historyEnabled
      ? readChatHistory(undefined,20,{includeText:currentSettings.showRequestText}).then(value=>({value,error:""}),()=>({value:[],error:"Could not read local Codex history. Check CODEX_HOME and file permissions."}))
      : Promise.resolve({value:[],error:""});
    try {
      data = reconcileUsage(await readLive(binary(), {signal:abort.signal}),data);
    }
    catch (error) {
      if (disposed) return;
      const snapshot = settings().historyEnabled ? await readSnapshot() : null;
      data = snapshot && revision===historyGeneration && settings().historyEnabled ? {...snapshot,notice:`${error.message} Historical snapshot; it may belong to a previous account.`} : {
        source:"unavailable",observedAt:null,windows:[],credits:null,notice:error.message,plan:null};
    } finally {
      const result=await chatPromise;
      if(revision===historyGeneration){
        chats=settings().historyEnabled?result.value:[];
        historyError=settings().historyEnabled?result.error:"";
        historyBusy=false;
      }
      busy = false; broadcast();
      if(!disposed&&revision!==historyGeneration){lastAttempt=0;void refresh();}
    }
    if (disposed || !settings().notifications) return;
    for (const warning of warningKeys(data,settings().threshold)) {
      if (seen.has(warning.key)) continue;
      seen.add(warning.key);
      seen = new Set([...seen].slice(-100));
      await context.globalState.update("warningKeys", [...seen]);
      void vscode.window.showWarningMessage(warning.message,"Open widget").then(choice => {
        if (choice && !disposed) void vscode.commands.executeCommand("creditPulse.open");
      });
    }
  }

  function attach(webview, owner) {
    webview.options = {enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,"media")]};
    const nonce = randomBytes(18).toString("base64");
    const uri = name => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,"media",name)).toString();
    webview.html = fs.readFileSync(path.join(context.extensionPath,"media/widget.html"),"utf8")
      .replaceAll("{{CSP}}",webview.cspSource).replaceAll("{{NONCE}}",nonce)
      .replaceAll("{{STYLE}}",uri("widget.css")).replaceAll("{{SCRIPT}}",uri("widget.js"));
    webviews.add(webview);
    const messages = webview.onDidReceiveMessage(async message => {
      if (!isMessage(message)) return;
      if (message.type === "ready") broadcast();
      if (message.type === "refresh") await refresh();
      if (message.type === "move") await vscode.commands.executeCommand("creditPulse.move");
      if (message.type === "desktop" && ["card","bubble"].includes(message.mode)) await showDesktop(message.mode);
      if (message.type === "closeDesktop") desktop.stop();
      if (message.type === "copySnapshot") await copySnapshot();
      if (message.type === "sidebar") await vscode.commands.executeCommand("creditPulse.sidebar");
      if (message.type === "threshold" && Number.isFinite(message.value) && message.value>=50 && message.value<=95) await config().update("warningThreshold",message.value,vscode.ConfigurationTarget.Global);
      if (message.type === "notifications" && typeof message.value === "boolean") await config().update("notifications",message.value,vscode.ConfigurationTarget.Global);
      if (message.type === "emojiAnimations" && typeof message.value === "boolean") await config().update("emojiAnimations",message.value,vscode.ConfigurationTarget.Global);
      if (message.type === "historyEnabled" && typeof message.value === "boolean") await config().update("historyEnabled",message.value,vscode.ConfigurationTarget.Global);
      if (message.type === "showRequestText" && typeof message.value === "boolean") await config().update("showRequestText",message.value,vscode.ConfigurationTarget.Global);
      if (message.type === "themePreset" && typeof message.value === "string" && (message.value==="custom"||Object.hasOwn(PRESETS,message.value))) await config().update("themePreset",message.value,vscode.ConfigurationTarget.Global);
      if (message.type === "appearance" && isMessage(message.value)) {
        for (const key of COLOR_KEYS) if (validColor(message.value[key])) await config().update(key,message.value[key],vscode.ConfigurationTarget.Global);
        if (Number.isFinite(message.value.glowIntensity) && message.value.glowIntensity>=0 && message.value.glowIntensity<=100) await config().update("glowIntensity",message.value.glowIntensity,vscode.ConfigurationTarget.Global);
        await config().update("themePreset","custom",vscode.ConfigurationTarget.Global);
      }
      if (message.type === "resetAppearance") {
        for (const [key,value] of Object.entries(DEFAULT_COLORS)) await config().update(key,value,vscode.ConfigurationTarget.Global);
        await config().update("themePreset","matrix",vscode.ConfigurationTarget.Global);
      }
    });
    owner.onDidDispose(() => {webviews.delete(webview);messages.dispose();});
  }

  context.subscriptions.push(status,
    vscode.window.registerWebviewViewProvider("creditPulse.usage",{resolveWebviewView(view) {attach(view.webview,view);}}),
    vscode.commands.registerCommand("creditPulse.open",() => vscode.commands.executeCommand("creditPulse.usage.focus")),
    vscode.commands.registerCommand("creditPulse.sidebar",() => vscode.commands.executeCommand("creditPulse.usage.focus")),
    vscode.commands.registerCommand("creditPulse.refresh",refresh),
    vscode.commands.registerCommand("creditPulse.copySnapshot",copySnapshot),
    vscode.commands.registerCommand("creditPulse.desktop",()=>showDesktop("bubble")),
    vscode.commands.registerCommand("creditPulse.closeDesktop",()=>desktop.stop()),
    vscode.commands.registerCommand("creditPulse.move",async () => {
      const commands = await vscode.commands.getCommands(true);
      if (commands.includes("workbench.action.moveFocusedView")) await vscode.commands.executeCommand("workbench.action.moveFocusedView","creditPulse.usage");
      else void vscode.window.showInformationMessage("Drag the Credit Pulse view header to the primary sidebar, secondary sidebar, or panel.");
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if(event.affectsConfiguration("creditPulse.historyEnabled")||event.affectsConfiguration("creditPulse.showRequestText")){
        historyGeneration++;chats=[];historyError="";historyBusy=settings().historyEnabled;clearChatHistory();
        if(!settings().historyEnabled&&data?.source==="snapshot")data=null;
        if(!busy){lastAttempt=0;void refresh();}
      }
      if (event.affectsConfiguration("creditPulse")) {schedule(); broadcast();}
    }),
    {dispose() {disposed=true;historyGeneration++;chats=[];historyBusy=false;historyError="";clearChatHistory();clearInterval(timer);abort?.abort();desktop.dispose();}}
  );
  function schedule() {clearInterval(timer);timer=setInterval(()=>void refresh(),Math.max(30,config().get("refreshSeconds",60))*1000);}
  schedule(); void refresh();
  return {refresh,isDesktopActive:()=>desktop.ready};
}
exports.activate = activate;
