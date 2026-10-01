// Textures générées une fois au chargement : textes à gros contour, chiffres de dégâts,
// éclairs, lignes de focus, trace de main, gouttes, dents, bulles, icônes.
// Tracer un texte avec un gros contour coûte cher : on ne le fait jamais pendant le combat.
import Phaser from 'phaser';
import { COMMENTS } from '../config/comments';
import { FIGHTERS } from '../config/balance';
import { COLORS, CSS, FONT_TITLE, FONT_UI } from '../ui/theme';

type Style = Phaser.Types.GameObjects.Text.TextStyle;

const title = (size: number, color: string, stroke = Math.round(size / 7)): Style => ({
  fontFamily: FONT_TITLE,
  fontSize: `${size}px`,
  color,
  stroke: CSS.ink,
  strokeThickness: stroke,
  padding: { x: stroke, y: stroke },
});

/** Bords horizontaux de l'encre (pixels non transparents) de chaque chiffre pré-rendu. */
const INK: Record<string, { left: number; right: number }> = {};

function inkBounds(c: HTMLCanvasElement) {
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let left = c.width;
  let right = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 24) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return right < 0 ? { left: 0, right: c.width } : { left, right: right + 1 };
}

/** Rend un texte dans sa propre texture (canvas copié), puis jette l'objet Text. */
export function bakeText(scene: Phaser.Scene, key: string, text: string, style: Style) {
  if (scene.textures.exists(key)) return;
  const t = scene.make.text({ x: 0, y: 0, text, style }, false);
  const c = document.createElement('canvas');
  c.width = Math.max(1, t.canvas.width);
  c.height = Math.max(1, t.canvas.height);
  c.getContext('2d', { willReadFrequently: key.startsWith('dig_') })!.drawImage(t.canvas, 0, 0);
  if (key.startsWith('dig_')) INK[key] = inkBounds(c);
  scene.textures.addCanvas(key, c);
  t.destroy();
}

function bakeGraphics(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

export const DIGIT_VARIANTS = {
  n: title(56, CSS.cream, 10),
  c: title(74, CSS.yellow, 12),
  r: title(56, CSS.red, 10),
} as const;
export type DigitVariant = keyof typeof DIGIT_VARIANTS;

export const LABELS = {
  crit: 'CRITIQUE ×2',
  grazed: 'EFFLEURÉE',
  missed: 'RATÉE…',
  limp: 'GIFLE MOLLE…',
  self: 'SURCHAUFFE !',
} as const;

export const ONOMATOPOEIA = {
  slap: { jp: 'バシッ！', fr: 'CLAAAC !' },
  crit: { jp: 'バシーン！', fr: 'CLAAAAAAC !' },
  limp: { jp: 'ペチ…', fr: 'PLOC…' },
  self: { jp: 'ピシャ！', fr: 'PAF !' },
} as const;

/** Clés des commentaires : com_<situation>_<n>. */
export const commentKey = (kind: keyof typeof COMMENTS, i: number) => `com_${kind}_${i}`;

export function bakeAll(scene: Phaser.Scene) {
  // Annonces
  for (const r of [1, 2, 3]) bakeText(scene, `ann_round_${r}`, `ROUND ${r}`, title(110, CSS.yellow, 16));
  bakeText(scene, 'ann_round_final', 'ROUND FINAL', title(110, CSS.yellow, 16));
  bakeText(scene, 'ann_fight', 'BAGARRE !', title(120, CSS.pink, 16));
  bakeText(scene, 'ann_ko', 'K.O. !', title(150, CSS.yellow, 18));
  for (const id of Object.keys(FIGHTERS) as (keyof typeof FIGHTERS)[]) {
    const name = FIGHTERS[id].short.toUpperCase();
    bakeText(scene, `ban_turn_${id}`, `À TOI, ${name} !`, title(52, CSS.cream, 10));
    bakeText(scene, `ann_roundfor_${id}`, `ROUND POUR ${name} !`, title(40, CSS.cream, 8));
    bakeText(scene, `ann_harder_${id}`, `PLUS FORT, VERS ${name} !`, title(34, CSS.cream, 8));
    bakeText(scene, `ann_special_${id}`, `${FIGHTERS[id].special.name.toUpperCase()} !`, title(96, CSS.pink, 15));
    bakeText(scene, `lbl_ready_${id}`, `${FIGHTERS[id].special.name.toUpperCase()} PRÊT !`, {
      fontFamily: FONT_TITLE,
      fontSize: '22px',
      color: CSS.cream,
      backgroundColor: CSS.pink,
      padding: { x: 10, y: 3 },
    });
  }

  // Chiffres de dégâts
  for (const [v, style] of Object.entries(DIGIT_VARIANTS)) {
    for (let d = 0; d <= 9; d++) bakeText(scene, `dig_${v}_${d}`, `${d}`, style);
  }

  // Étiquettes
  const tag = (bg: string): Style => ({
    fontFamily: FONT_TITLE,
    fontSize: '24px',
    color: CSS.cream,
    backgroundColor: bg,
    padding: { x: 10, y: 3 },
  });
  bakeText(scene, 'lbl_crit', LABELS.crit, tag(CSS.pink));
  bakeText(scene, 'lbl_grazed', LABELS.grazed, tag(CSS.red));
  bakeText(scene, 'lbl_missed', LABELS.missed, tag(CSS.red));
  bakeText(scene, 'lbl_limp', LABELS.limp, tag(CSS.red));
  bakeText(scene, 'lbl_self', LABELS.self, tag(CSS.red));
  bakeText(scene, 'lbl_stun', 'SONNÉ !', tag(CSS.cyan));
  bakeText(scene, 'lbl_special', 'SPÉCIALE !', tag(CSS.pink));
  bakeText(scene, 'lbl_ragemax', 'RAGE MAX !', {
    fontFamily: FONT_TITLE,
    fontSize: '15px',
    color: CSS.cream,
    backgroundColor: CSS.pink,
    padding: { x: 6, y: 1 },
  });
  // Étoile du perso sonné
  bakeGraphics(scene, 'fx_dizzy', 30, 30, (g) => {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 6 : 14;
      pts.push(new Phaser.Math.Vector2(15 + Math.cos(a) * r, 15 + Math.sin(a) * r));
    }
    g.fillStyle(COLORS.ink, 1);
    g.fillPoints(pts.map((p) => new Phaser.Math.Vector2(15 + (p.x - 15) * 1.15, 15 + (p.y - 15) * 1.15)), true);
    g.fillStyle(COLORS.yellow, 1);
    g.fillPoints(pts, true);
  });

  // Onomatopées : grosses lettres japonaises + sous-titre français
  for (const [k, o] of Object.entries(ONOMATOPOEIA)) {
    const big = k === 'crit';
    const color = k === 'crit' ? CSS.red : k === 'limp' ? CSS.cream : CSS.yellow;
    bakeText(scene, `ono_${k}_jp`, o.jp, title(big ? 104 : k === 'limp' ? 64 : 88, color, big ? 16 : 13));
    bakeText(scene, `ono_${k}_fr`, o.fr, {
      fontFamily: FONT_TITLE,
      fontSize: big ? '34px' : '28px',
      color: CSS.ink,
      backgroundColor: k === 'crit' ? CSS.yellow : CSS.cream,
      padding: { x: 10, y: 2 },
    });
  }

  // Commentateur
  const com: Style = { fontFamily: FONT_UI, fontStyle: '800', fontSize: '23px', color: CSS.cream };
  for (const [kind, list] of Object.entries(COMMENTS)) {
    list.forEach((text, i) => bakeText(scene, commentKey(kind as keyof typeof COMMENTS, i), text, com));
  }
  bakeText(scene, 'com_tag', 'COMMENTATEUR', {
    fontFamily: FONT_TITLE,
    fontSize: '16px',
    color: CSS.ink,
    backgroundColor: CSS.yellow,
    padding: { x: 8, y: 2 },
  });

  // Bulle du patron
  bakeText(scene, 'bub_whistle', 'PRRRT !', { fontFamily: FONT_TITLE, fontSize: '30px', color: CSS.red });
  bakeGraphics(scene, 'fx_bubble', 190, 96, (g) => {
    g.fillStyle(COLORS.ink, 1);
    g.fillRoundedRect(4, 4, 182, 70, 30);
    g.fillTriangle(40, 66, 70, 66, 30, 94);
    g.fillStyle(COLORS.cream, 1);
    g.fillRoundedRect(9, 9, 172, 60, 26);
    g.fillTriangle(44, 64, 66, 64, 34, 86);
  });

  // Éclairs en étoile (3 variantes)
  for (let v = 0; v < 3; v++) {
    bakeGraphics(scene, `fx_star_${v}`, 240, 240, (g) => {
      const star = (r: number, color: number, spikes: number, jitter: number) => {
        g.fillStyle(color, 1);
        const pts: Phaser.Math.Vector2[] = [];
        for (let i = 0; i < spikes * 2; i++) {
          const a = (i / (spikes * 2)) * Math.PI * 2 + (Math.random() - 0.5) * jitter;
          const rr = i % 2 ? r * 0.42 : r * (0.82 + Math.random() * 0.36);
          pts.push(new Phaser.Math.Vector2(120 + Math.cos(a) * rr, 120 + Math.sin(a) * rr));
        }
        g.fillPoints(pts, true);
      };
      star(112, COLORS.ink, 11, 0.12);
      star(104, COLORS.yellow, 11, 0.12);
      star(78, 0xff8a1f, 10, 0.2);
      star(46, 0xffffff, 8, 0.2);
    });
  }

  // Lignes de focus manga (anneau de traits convergents, centre vide)
  bakeGraphics(scene, 'fx_focus', 1024, 1024, (g) => {
    const cx = 512;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 + Math.random() * 0.04;
      const inner = 210 + Math.random() * 130;
      const w = 0.006 + Math.random() * 0.012;
      g.fillStyle(i % 3 === 0 ? COLORS.ink : 0xffffff, i % 3 === 0 ? 0.55 : 0.85);
      g.fillTriangle(
        cx + Math.cos(a) * inner,
        cx + Math.sin(a) * inner,
        cx + Math.cos(a - w) * 740,
        cx + Math.sin(a - w) * 740,
        cx + Math.cos(a + w) * 740,
        cx + Math.sin(a + w) * 740,
      );
    }
  });

  // Trace de main rouge (paume + doigts), vue de face
  bakeGraphics(scene, 'fx_hand', 80, 96, (g) => {
    g.fillStyle(0xd81e3a, 1);
    g.fillEllipse(40, 66, 50, 46);
    const finger = (x: number, y: number, h: number, angle: number) => {
      const r = 6.5;
      const dx = Math.sin(angle) * h;
      const dy = -Math.cos(angle) * h;
      for (let k = 0; k <= 8; k++) g.fillCircle(x + (dx * k) / 8, y + (dy * k) / 8, r);
    };
    finger(23, 52, 34, -0.18);
    finger(35, 48, 42, -0.05);
    finger(47, 48, 40, 0.06);
    finger(58, 54, 32, 0.18);
    finger(16, 70, 22, -0.95); // pouce
  });

  // Goutte (sueur / larme) et dent
  bakeGraphics(scene, 'fx_drop', 18, 26, (g) => {
    g.fillStyle(0x8fd8ff, 1);
    g.fillCircle(9, 17, 8);
    g.fillTriangle(1.5, 15, 16.5, 15, 9, 0);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(6, 15, 2.5);
  });
  bakeGraphics(scene, 'fx_tooth', 18, 22, (g) => {
    g.fillStyle(COLORS.ink, 1);
    g.fillRoundedRect(0, 0, 18, 22, 6);
    g.fillStyle(0xfffdf2, 1);
    g.fillRoundedRect(2.5, 2.5, 13, 17, 4);
  });
  bakeGraphics(scene, 'fx_spark', 12, 12, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 6, 6);
  });

  // Icônes son
  for (const on of [true, false]) {
    bakeGraphics(scene, on ? 'ico_sound_on' : 'ico_sound_off', 56, 56, (g) => {
      g.fillStyle(COLORS.ink, 0.85);
      g.fillCircle(28, 28, 27);
      g.lineStyle(3, COLORS.cream, 1);
      g.strokeCircle(28, 28, 25);
      g.fillStyle(COLORS.cream, 1);
      g.fillRect(14, 22, 8, 12);
      g.fillTriangle(20, 28, 31, 15, 31, 41);
      g.fillRect(20, 20, 4, 16);
      if (on) {
        g.lineStyle(3, COLORS.cream, 1);
        g.beginPath();
        g.arc(30, 28, 8, -0.8, 0.8);
        g.strokePath();
        g.beginPath();
        g.arc(30, 28, 14, -0.8, 0.8);
        g.strokePath();
      } else {
        g.lineStyle(4, COLORS.red, 1);
        g.lineBetween(36, 20, 46, 36);
        g.lineBetween(46, 20, 36, 36);
      }
    });
  }
}

/** Nombre composé de chiffres pré-rendus (aucun rendu de texte pendant le jeu). */
export function digitsImage(scene: Phaser.Scene, n: number, variant: DigitVariant) {
  const c = scene.add.container(0, 0);
  // Les contours des chiffres se touchent et se chevauchent légèrement, comme un texte d'un seul bloc.
  const stroke = DIGIT_VARIANTS[variant].strokeThickness ?? 0;
  const overlap = stroke * 0.45;
  const keys = `${Math.max(0, Math.round(n))}`.split('').map((d) => `dig_${variant}_${d}`);
  const inks = keys.map((k) => INK[k] ?? { left: 0, right: scene.textures.get(k).getSourceImage().width });
  const total = inks.reduce((w, ink) => w + (ink.right - ink.left) - overlap, overlap);
  let x = -total / 2;
  keys.forEach((k, i) => {
    c.add(scene.add.image(x - inks[i].left, 0, k).setOrigin(0, 0.5));
    x += inks[i].right - inks[i].left - overlap;
  });
  return c;
}
