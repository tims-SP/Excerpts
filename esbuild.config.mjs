import esbuild from "esbuild";
await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  sourcemap: false,
  minify: false,
  logLevel: "info",
  // Obsidian expects the plugin class to be the direct CommonJS export.
  footer: { js: "module.exports = module.exports.default;" }
});
