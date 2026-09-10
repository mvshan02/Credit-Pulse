"use strict";
const {readLive} = require("../src/usage");
readLive(process.argv[2] || "codex").then(data => {
  console.log(JSON.stringify({source:data.source,windows:data.windows,credits:data.credits},null,2));
}).catch(error => {console.error(error.message);process.exitCode=1;});
