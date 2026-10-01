import Phaser from 'phaser';
import { COLORS, CSS, FONT_TITLE } from './theme';

/** Bouton incliné à gros contour ; le libellé est réduit s'il le faut pour tenir dans le cadre. */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  color: number,
  onClick: () => void,
  size: { w?: number; h?: number; font?: number } = {},
) {
  const W = size.w ?? 290;
  const H = size.h ?? 66;
  const c = scene.add.container(x, y);
  const shadow = scene.add.rectangle(6, 7, W, H, COLORS.ink, 0.55).setAngle(-3);
  const bg = scene.add.rectangle(0, 0, W, H, color).setStrokeStyle(6, COLORS.ink).setAngle(-3);
  const t = scene.add
    .text(0, 0, label, { fontFamily: FONT_TITLE, fontSize: `${size.font ?? 28}px`, color: CSS.ink })
    .setOrigin(0.5)
    .setAngle(-3);
  const maxW = W - 40;
  if (t.width > maxW) t.setScale(maxW / t.width);
  c.add([shadow, bg, t]);
  c.setSize(W, H).setInteractive({ useHandCursor: true });
  c.on('pointerdown', () => c.setScale(0.94));
  c.on('pointerout', () => c.setScale(1));
  c.on('pointerup', () => {
    c.setScale(1);
    onClick();
  });
  c.setName(`btn-${label}`);
  return c;
}
