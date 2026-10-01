import Phaser from 'phaser';
import { CSS, FONT_TITLE } from './theme';

/** Chiffre de dégâts qui jaillit puis s'envole, avec étiquette « CRITIQUE ×2 » éventuelle. */
export function popDamage(
  scene: Phaser.Scene,
  x: number,
  y: number,
  damage: number,
  opts: { critical?: boolean; label?: string; color?: string } = {},
) {
  const items: Phaser.GameObjects.Text[] = [];
  const num = scene.add
    .text(x, y, `${damage}`, {
      fontFamily: FONT_TITLE,
      fontSize: opts.critical ? '72px' : '56px',
      color: opts.color ?? (opts.critical ? CSS.yellow : CSS.cream),
      stroke: CSS.ink,
      strokeThickness: 10,
    })
    .setOrigin(0.5)
    .setDepth(50);
  items.push(num);
  const tag = opts.label ?? (opts.critical ? 'CRITIQUE ×2' : undefined);
  if (tag) {
    items.push(
      scene.add
        .text(x, y + (opts.critical ? 48 : 40), tag, {
          fontFamily: FONT_TITLE,
          fontSize: '24px',
          color: CSS.cream,
          backgroundColor: opts.critical ? CSS.pink : CSS.red,
          padding: { x: 10, y: 2 },
        })
        .setOrigin(0.5)
        .setAngle(-6)
        .setDepth(50),
    );
  }
  for (const t of items) {
    t.setScale(0.2);
    scene.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.Out' });
    scene.tweens.add({
      targets: t,
      y: t.y - 70,
      alpha: 0,
      delay: 650,
      duration: 450,
      ease: 'Quad.In',
      onComplete: () => t.destroy(),
    });
  }
}

/** Petit texte d'info centré (annonces simples). */
export function flashText(scene: Phaser.Scene, x: number, y: number, text: string, color = CSS.yellow, size = 64) {
  const t = scene.add
    .text(x, y, text, {
      fontFamily: FONT_TITLE,
      fontSize: `${size}px`,
      color,
      stroke: CSS.ink,
      strokeThickness: 12,
    })
    .setOrigin(0.5)
    .setAngle(-5)
    .setDepth(60)
    .setScale(2.2)
    .setAlpha(0);
  scene.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 180, ease: 'Back.Out' });
  scene.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
  return t;
}
