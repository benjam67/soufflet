// Optimise les PNG sources de raw/ vers public/assets/ (WebP) et écrit
// src/config/assets.json (tailles et points d'ancrage après recadrage).
//
// Combattants : toutes les poses d'un perso sont recadrées sur la même boîte
// (union des zones non transparentes de toutes les poses), pour garder une
// ligne de pieds et un ancrage communs. Bernard et Lola sont réduits avec le
// MÊME facteur pour conserver leur rapport de taille.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'raw');
const OUT = path.join(ROOT, 'public/assets');
const POSES = ['idle', 'windup', 'swing', 'slap', 'hit', 'dazed', 'victory', 'selfslap'];
const FIGHTERS = { bernard: [1300, 823], lola: [908, 772] };
// Bernard (le plus grand canevas) ramené à ~600 px de haut.
const FIGHTER_SCALE = 600 / 823;
const FEET_OFFSET = 10; // pieds à 10 px du bas de l'image source
const HABITUES = ['vieux_beret', 'fermier', 'grandmere', 'facteur', 'jeune_siffleur', 'mecano', 'boulanger', 'femme_cardigan'];
const PROP_SCALE = 1; // habitués : déjà petits, gardés en taille native
const PATRON_HEIGHT = 520;

fs.mkdirSync(OUT, { recursive: true });

async function alphaBox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

const manifest = { fighterScale: FIGHTER_SCALE, fighters: {}, props: {} };

for (const [name, [W, H]] of Object.entries(FIGHTERS)) {
  const dir = path.join(RAW, 'characters', name);
  let u = { x0: W, y0: H, x1: 0, y1: 0 };
  for (const p of POSES) {
    const b = await alphaBox(path.join(dir, `${p}.png`));
    u = { x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) };
  }
  // On garde le bas du canevas d'origine (ligne de pieds) et un peu de marge.
  const pad = 6;
  const left = Math.max(0, u.x0 - pad);
  const top = Math.max(0, u.y0 - pad);
  const right = Math.min(W, u.x1 + 1 + pad);
  const bottom = H;
  const cw = right - left, ch = bottom - top;
  const outW = Math.round(cw * FIGHTER_SCALE), outH = Math.round(ch * FIGHTER_SCALE);
  fs.mkdirSync(path.join(OUT, 'characters', name), { recursive: true });
  for (const p of POSES) {
    await sharp(path.join(dir, `${p}.png`))
      .extract({ left, top, width: cw, height: ch })
      .resize(outW, outH)
      .webp({ quality: 82, alphaQuality: 90, effort: 6 })
      .toFile(path.join(OUT, 'characters', name, `${p}.webp`));
  }
  // Ancrage : centre horizontal de l'image d'origine, pieds à 10 px du bas.
  // Silhouette idle mesurée depuis l'ancrage (en px de la texture optimisée),
  // pour placer les persos sans les couper ni les faire se chevaucher.
  const idle = await alphaBox(path.join(dir, 'idle.png'));
  manifest.fighters[name] = {
    width: outW,
    height: outH,
    originX: (W / 2 - left) / cw,
    originY: (H - FEET_OFFSET - top) / ch,
    idle: {
      height: Math.round((H - FEET_OFFSET - idle.y0) * FIGHTER_SCALE),
      left: Math.round((idle.x0 - W / 2) * FIGHTER_SCALE),
      right: Math.round((idle.x1 - W / 2) * FIGHTER_SCALE),
    },
  };
}

fs.mkdirSync(path.join(OUT, 'bar/habitues'), { recursive: true });
for (const h of HABITUES) {
  const src = path.join(RAW, 'bar/habitues', `${h}.png`);
  const m = await sharp(src).metadata();
  const w = Math.round(m.width * PROP_SCALE), hh = Math.round(m.height * PROP_SCALE);
  await sharp(src).resize(w, hh).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, 'bar/habitues', `${h}.webp`));
  manifest.props[`habitue_${h}`] = { width: w, height: hh };
}
{
  const src = path.join(RAW, 'bar/patron.png');
  const m = await sharp(src).metadata();
  const w = Math.round((m.width * PATRON_HEIGHT) / m.height);
  await sharp(src).resize(w, PATRON_HEIGHT).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(path.join(OUT, 'bar/patron.webp'));
  manifest.props.patron = { width: w, height: PATRON_HEIGHT };
}

// Décor : decor.png s'il est fourni, sinon le décor provisoire dessiné en SVG.
{
  const png = path.join(RAW, 'bar/decor.png');
  const svg = path.join(RAW, 'bar/decor-placeholder.svg');
  const src = fs.existsSync(png) ? png : svg;
  const img = sharp(src, { density: 96 });
  const m = await img.metadata();
  const targetH = Math.min(900, m.height);
  await sharp(src, { density: 96 }).resize({ height: targetH }).webp({ quality: 78, effort: 6 }).toFile(path.join(OUT, 'bar/decor.webp'));
  const out = await sharp(path.join(OUT, 'bar/decor.webp')).metadata();
  manifest.props.decor = { width: out.width, height: out.height, placeholder: src === svg };
}

fs.mkdirSync(path.join(ROOT, 'src/config'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/config/assets.json'), JSON.stringify(manifest, null, 2) + '\n');

let total = 0;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else total += fs.statSync(p).size;
});
walk(OUT);
console.log(`assets: ${(total / 1024).toFixed(0)} Ko`);
console.log(JSON.stringify(manifest.fighters, null, 1));
