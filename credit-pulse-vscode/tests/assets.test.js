"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname,"..");

test("extension logo is a packaged 256px PNG, not an unsupported SVG listing icon",()=>{
  const manifest = JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
  assert.equal(manifest.icon,"media/icon.png");
  const png = fs.readFileSync(path.join(root,manifest.icon));
  assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16),256);
  assert.equal(png.readUInt32BE(20),256);
  const packager = fs.readFileSync(path.join(root,"tools/package_vsix.py"),"utf8");
  assert.match(packager,/Microsoft\.VisualStudio\.Services\.Icons\.Default/);
  assert.match(packager,/<GalleryFlags>Public<\/GalleryFlags>/);
  assert.match(packager,/image\/png/);
});
