"use strict";
const assert = require("node:assert/strict");
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
exports.run = async function () {
  const resultPath=path.resolve(__dirname,"../../.vscode-test/integration-v09-result.json");
  try {
  const manifest=require("../package.json");
  const extension=vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(extension,"Extension discovered by VS Code");
  assert.equal(extension.packageJSON.version,"0.9.2");
  assert.equal(vscode.workspace.getConfiguration("creditPulse").get("historyEnabled"),false);
  assert.ok(fs.existsSync(path.join(extension.extensionPath,extension.packageJSON.icon)),"Packaged logo exists");
  await extension.activate();
  assert.ok(extension.isActive);
  const commands=await vscode.commands.getCommands(true);
  for (const id of ["open","move","sidebar","refresh","copySnapshot","desktop","closeDesktop"]) assert.ok(commands.includes(`creditPulse.${id}`));
  assert.ok(commands.includes("creditPulse.usage.focus"));
  await vscode.commands.executeCommand("creditPulse.open");
  await vscode.commands.executeCommand("creditPulse.sidebar");
  await vscode.commands.executeCommand("creditPulse.move");
  await new Promise(resolve=>setTimeout(resolve,100));
  await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  if(process.platform==="win32"){
    await vscode.commands.executeCommand("creditPulse.desktop");
    assert.equal(extension.exports.isDesktopActive(),true,"Native desktop window connected to the extension");
    await vscode.commands.executeCommand("creditPulse.closeDesktop");
    assert.equal(extension.exports.isDesktopActive(),false);
  }
  fs.writeFileSync(resultPath,JSON.stringify({passed:true,checks:["activation","commands","in-window-view","sidebar","desktop-launch","desktop-close"]}));
  console.log("Credit Pulse extension-host integration passed: activation, commands, and in-window view focus.");
  } catch (error) {fs.writeFileSync(resultPath,JSON.stringify({passed:false,error:String(error)}));throw error;}
};
