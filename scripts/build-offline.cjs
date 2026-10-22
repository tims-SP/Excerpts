/* Offline-compatible zero-dependency bundler for this project, using installed global TypeScript.
 * The canonical release build is esbuild via GitHub Actions. */
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const ts = require(path.join(cp.execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "typescript"));
const root = path.resolve(__dirname, "..");
const paths = ["model", "codec", "repository", "settings", "view", "main"];
const entries = paths.map(name => {
  const source = fs.readFileSync(path.join(root, "src", `${name}.ts`), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  return `${JSON.stringify(name)}: function(module, exports, require) {\n${compiled.outputText}\n}`;
});
const bundle = `(function(){\n"use strict";\nconst modules = {${entries.join(",\n")}};\nconst cache = {};\nfunction load(id){\n if(cache[id]) return cache[id].exports;\n const factory=modules[id];\n if(!factory) throw Error("Unknown module: "+id);\n const module={exports:{}};cache[id]=module;\n factory(module,module.exports,(name)=>name==="obsidian"?require("obsidian"):load(name.replace(/^\\.\\//,"")));\n return module.exports;\n}\nmodule.exports=load("main").default;\n})();\n`;
fs.writeFileSync(path.join(root, "main.js"), bundle);
console.log("Wrote main.js (offline TypeScript bundle, " + bundle.length + " chars)");
