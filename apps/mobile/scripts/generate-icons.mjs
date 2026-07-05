/**
 * Regenerates the PWA/app icon set in apps/mobile/public/icons/ from a
 * programmatic SVG master (bold "T!" lettermark on the dark theme color).
 * Run from apps/mobile:
 *
 *   node scripts/generate-icons.mjs
 *
 * The PNGs are committed; rerun only when the design changes. The glyph is
 * drawn with shapes (never <text>) so output does not depend on installed
 * fonts.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(appRoot, 'public', 'icons');

// Mirrors src/lib/theme.ts (colors.bg / surface / primary). Kept literal so the
// script runs without the TS toolchain; pwa.test.ts guards the manifest side.
const BG = '#1a202c';
const PRIMARY = '#4299e1';

// Type color for the "T" (theme text color, kept literal like the others).
const TYPE = '#e2e8f0';

/**
 * 1024x1024 master: bold "T!" lettermark (spec decision 5) — the T in the
 * theme text color, the exclamation in primary blue, drawn with rects/circles
 * (never <text>) so output does not depend on installed fonts. `scale`
 * shrinks the mark toward the center: 1 for regular icons, 0.72 for the
 * maskable variant's ~80% circular safe zone.
 */
function masterSvg(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${BG}"/>
  <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
    <rect x="238" y="290" width="380" height="100" rx="24" fill="${TYPE}"/>
    <rect x="378" y="290" width="100" height="444" rx="24" fill="${TYPE}"/>
    <rect x="678" y="290" width="104" height="330" rx="52" fill="${PRIMARY}"/>
    <circle cx="730" cy="686" r="62" fill="${PRIMARY}"/>
  </g>
</svg>`;
}

const regular = Buffer.from(masterSvg(1));
const maskable = Buffer.from(masterSvg(0.72));

const outputs = [
  { src: regular, size: 1024, file: 'icon-1024.png' },
  { src: regular, size: 512, file: 'icon-512.png' },
  { src: regular, size: 192, file: 'icon-192.png' },
  { src: maskable, size: 512, file: 'icon-maskable-512.png' },
  { src: regular, size: 180, file: 'apple-touch-icon.png' },
  { src: regular, size: 48, file: 'favicon.png' },
];

await mkdir(outDir, { recursive: true });
for (const { src, size, file } of outputs) {
  await sharp(src).resize(size, size).png().toFile(path.join(outDir, file));
  console.log(`wrote public/icons/${file} (${size}x${size})`);
}
