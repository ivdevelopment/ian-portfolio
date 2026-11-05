// Generates the app icon (PNG + ICO) and the four tray status icons from the site's own "IV" mark (src/app/icon.svg).
// Run once with:  node make-icons.mjs   (uses the `sharp` package that the website already depends on). The outputs are committed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const sharp = createRequire(join(root, "package.json"))("sharp");
const svg = readFileSync(join(root, "src", "app", "icon.svg"), "utf8");
const out = join(here, "assets");
mkdirSync(out, { recursive: true });

const png = (size, overlay) => {
  let s = sharp(Buffer.from(svg), { density: Math.max(72, size * 3) }).resize(size, size);
  if (overlay) s = s.composite([{ input: Buffer.from(overlay(size)) }]);
  return s.png().toBuffer();
};

// A status dot in the bottom-right corner with a dark ring so it reads on light and dark taskbars. Colour is never the only signal:
// the tray tooltip and menu carry the words.
const dot = (color) => (size) => {
  const r = Math.round(size * 0.19);
  const c = size - r - Math.max(1, Math.round(size * 0.04));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${r + Math.max(1, size * 0.05)}" fill="#0a0e1b"/><circle cx="${c}" cy="${c}" r="${r}" fill="${color}"/></svg>`;
};

const levels = { green: "#34d399", amber: "#fbbf24", red: "#f87171", gray: "#9ca3af" };

writeFileSync(join(out, "icon.png"), await png(256));
for (const [name, color] of Object.entries(levels)) {
  writeFileSync(join(out, `tray-${name}.png`), await png(32, dot(color)));
  writeFileSync(join(out, `tray-${name}@2x.png`), await png(64, dot(color)));
}

// ICO container with PNG-compressed images (supported by Windows Vista and later).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map((s) => png(s)));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = 6 + 16 * images.length;
const entries = images.map((img, i) => {
  const e = Buffer.alloc(16);
  const s = sizes[i];
  e.writeUInt8(s >= 256 ? 0 : s, 0);
  e.writeUInt8(s >= 256 ? 0 : s, 1);
  e.writeUInt8(0, 2);
  e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
writeFileSync(join(out, "icon.ico"), Buffer.concat([header, ...entries, ...images]));
console.log("icons written to", out);
