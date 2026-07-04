/**
 * Regenerates the PWA/app icon set in apps/mobile/public/icons/ from a
 * programmatic SVG master (tilted card + exclamation glyph on the dark theme
 * color). Run from apps/mobile:
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
const SURFACE = '#2d3748';
const PRIMARY = '#4299e1';

/**
 * 1024x1024 master. `scale` shrinks the card toward the center: 1 for regular
 * icons, 0.72 for the maskable variant so the card stays inside the ~80%
 * circular safe zone. The background always bleeds to the edges.
 */
function masterSvg(scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${BG}"/>
  <g transform="translate(512 512) scale(${scale}) rotate(-8) translate(-512 -512)">
    <rect x="292" y="202" width="440" height="620" rx="48"
          fill="${SURFACE}" stroke="${PRIMARY}" stroke-width="24"/>
    <rect x="467" y="330" width="90" height="280" rx="45" fill="${PRIMARY}"/>
    <circle cx="512" cy="700" r="55" fill="${PRIMARY}"/>
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
