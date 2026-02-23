/**
 * Generate PWA icons for Enclave Mail.
 *
 * Produces 192x192, 512x512, and 180x180 (Apple Touch) PNG icons
 * using an SVG template rendered through sharp.
 *
 * Usage: bun run scripts/generate-icons.ts
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const BACKGROUND = '#0F1117';
const ACCENT = '#4A9BAE';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'apps', 'web', 'public', 'icons');

interface IconSpec {
  size: number;
  filename: string;
  /** Corner radius as fraction of size (0 = square) */
  radiusFraction: number;
}

const icons: IconSpec[] = [
  { size: 192, filename: 'icon-192.png', radiusFraction: 0.15 },
  { size: 512, filename: 'icon-512.png', radiusFraction: 0.15 },
  // Apple applies its own mask — no rounded corners needed
  { size: 180, filename: 'apple-touch-icon.png', radiusFraction: 0 },
];

function buildSvg(size: number, radiusFraction: number): string {
  const radius = Math.round(size * radiusFraction);
  const fontSize = Math.round(size * 0.48);
  // Shift baseline slightly below center for optical balance
  const yOffset = '53%';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BACKGROUND}"/>
  <text x="50%" y="${yOffset}" dominant-baseline="middle" text-anchor="middle"
        font-family="Inter, system-ui, -apple-system, sans-serif" font-weight="700"
        font-size="${fontSize}" fill="${ACCENT}">E</text>
</svg>`;
}

async function generate(): Promise<void> {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const icon of icons) {
    const svg = buildSvg(icon.size, icon.radiusFraction);
    const outputPath = join(OUTPUT_DIR, icon.filename);

    await sharp(Buffer.from(svg)).png().toFile(outputPath);

    console.log(`  [OK] ${icon.filename} (${icon.size}x${icon.size})`);
  }
}

console.log('Generating Enclave Mail PWA icons...\n');
await generate();
console.log('\nDone.');
