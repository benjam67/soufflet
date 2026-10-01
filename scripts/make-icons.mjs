// Génère les icônes PWA à partir du visage de Bernard (pose idle).
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/icons');
fs.mkdirSync(OUT, { recursive: true });

// Zone du visage dans raw/characters/bernard/idle.png (1300 × 823).
const FACE = { left: 425, top: 40, width: 220, height: 220 };

const bg = (size, safe) => {
  const r = safe ? size * 0.5 : size * 0.46;
  const spikes = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const R = i % 2 ? r * 0.78 : r;
    return `${size / 2 + Math.cos(a) * R},${size / 2 + Math.sin(a) * R}`;
  }).join(' ');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${safe ? 0 : size * 0.18}" fill="#1A1020"/>
    <polygon points="${spikes}" fill="#E8304A"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r * 0.66}" fill="#FFC93C"/>
  </svg>`);
};

async function make(name, size, safe = false) {
  const faceSize = Math.round(size * (safe ? 0.56 : 0.7));
  const face = await sharp(path.join(ROOT, 'raw/characters/bernard/idle.png'))
    .extract(FACE)
    .resize(faceSize, faceSize)
    .composite([{
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${faceSize}" height="${faceSize}"><circle cx="${faceSize / 2}" cy="${faceSize / 2}" r="${faceSize / 2}" fill="#fff"/></svg>`),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();
  await sharp(bg(size, safe))
    .composite([{ input: face, left: Math.round((size - faceSize) / 2), top: Math.round((size - faceSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, name));
}

await make('icon-192.png', 192);
await make('icon-512.png', 512);
await make('icon-maskable-512.png', 512, true);
await make('apple-touch-icon.png', 180, true);
console.log('icônes générées');
