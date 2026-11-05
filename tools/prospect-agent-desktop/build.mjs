// Bundles the tray application into dist/: the main process, the preload script and the business-data update thread (each one CommonJS file),
// plus the window's page and the icons. The worker code is NOT copied or forked here: main.cjs bundles tools/prospect-agent/src/service.ts,
// the same module the command line runs. Usage: node build.mjs
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: { main: join(here, "src", "main.ts"), preload: join(here, "src", "preload.ts"), "update-worker": join(here, "src", "update-worker.ts") },
  outdir: dist,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  // The shared prospecting code imports "server-only"; the react-server condition resolves it to the empty module, exactly as `npm run prospect-agent` does.
  conditions: ["react-server"],
  tsconfig: join(here, "..", "..", "tsconfig.json"),
  external: ["electron", "node:sqlite"],
  legalComments: "none",
  logLevel: "info",
});

cpSync(join(here, "renderer"), join(dist, "renderer"), { recursive: true });
mkdirSync(join(dist, "assets"), { recursive: true });
for (const f of ["icon.png", "tray-green.png", "tray-green@2x.png", "tray-amber.png", "tray-amber@2x.png", "tray-red.png", "tray-red@2x.png", "tray-gray.png", "tray-gray@2x.png"]) cpSync(join(here, "assets", f), join(dist, "assets", f));
console.log("built", dist);
