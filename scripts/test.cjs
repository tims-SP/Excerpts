const { execFileSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
mkdirSync(path.join(root,'.test-compiled'),{recursive:true});
// Tests rely only on Node and TypeScript, never an Obsidian runtime.
execFileSync('tsc',['--target','ES2022','--module','commonjs','--outDir','.test-compiled','src/model.ts','src/codec.ts'],{cwd:root,stdio:'inherit'});
execFileSync(process.execPath,['--test','tests/codec.test.cjs'],{cwd:root,stdio:'inherit'});
