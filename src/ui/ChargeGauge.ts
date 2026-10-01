import Phaser from 'phaser';
import { COLORS, CSS, FONT_TITLE } from './theme';

/**
 * Jauge de charge verticale (à gauche de l'écran) : zone dorée encadrée de blanc,
 * zone de surchauffe rouge en haut, libellé CHARGE… / PARFAIT ! / SURCHAUFFE !
 */
export class ChargeGauge extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private pct: Phaser.GameObjects.Text;
  private value = 0;
  private zone: [number, number] = [80, 90];
  private overheat = false;
  readonly gaugeW = 34;
  private h = 360;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.g = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, 'CHARGE…', {
        fontFamily: FONT_TITLE,
        fontSize: '22px',
        color: CSS.cream,
        stroke: CSS.ink,
        strokeThickness: 6,
      })
      .setOrigin(0, 1)
      .setAngle(-6);
    this.pct = scene.add
      .text(0, 0, '0%', {
        fontFamily: FONT_TITLE,
        fontSize: '18px',
        color: CSS.cream,
        stroke: CSS.ink,
        strokeThickness: 5,
      })
      .setOrigin(0.5, 0);
    this.add([this.g, this.label, this.pct]);
    scene.add.existing(this);
    this.setAlpha(0);
  }

  layout(x: number, top: number, height: number) {
    this.h = height;
    this.setPosition(x, top);
    this.label.setPosition(-4, -10);
    this.pct.setPosition(this.gaugeW / 2, height + 8);
    this.redraw();
  }

  setZone(zone: [number, number]) {
    this.zone = zone;
    this.redraw();
  }

  setValue(charge: number, overheat = false) {
    this.value = charge;
    this.overheat = overheat;
    const golden = charge >= this.zone[0] && charge <= this.zone[1];
    const text = overheat ? 'SURCHAUFFE !' : golden ? 'PARFAIT !' : 'CHARGE…';
    if (this.label.text !== text) {
      this.label.setText(text);
      this.label.setColor(overheat ? CSS.red : golden ? CSS.yellow : CSS.cream);
      if (golden || overheat) {
        this.scene.tweens.add({ targets: this.label, scale: { from: 1.35, to: 1 }, duration: 160, ease: 'Back.Out' });
      }
    }
    this.pct.setText(`${Math.round(charge)}%`);
    this.redraw();
  }

  show(visible: boolean) {
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({ targets: this, alpha: visible ? 1 : 0, duration: visible ? 80 : 220 });
  }

  /** y (local) correspondant à un pourcentage. */
  private yOf(p: number) {
    return this.h * (1 - p / 100);
  }

  private redraw() {
    const g = this.g;
    const w = this.gaugeW;
    g.clear();
    // Ombre portée + fond
    g.fillStyle(COLORS.ink, 0.6);
    g.fillRoundedRect(5, 5, w, this.h, 6);
    g.fillStyle(COLORS.ink, 0.92);
    g.fillRoundedRect(0, 0, w, this.h, 6);
    // Zone de surchauffe (rouge en haut)
    g.fillStyle(COLORS.red, 0.55);
    g.fillRect(3, 3, w - 6, this.yOf(96) - 3);
    // Remplissage
    const golden = this.value >= this.zone[0] && this.value <= this.zone[1];
    const color = this.overheat || this.value >= 100 ? COLORS.red : golden ? COLORS.yellow : COLORS.cyan;
    const top = this.yOf(this.value);
    if (this.value > 0) {
      g.fillStyle(color, 1);
      g.fillRect(4, Math.max(4, top), w - 8, this.h - 4 - Math.max(4, top));
      g.fillStyle(0xffffff, 0.35);
      g.fillRect(7, Math.max(4, top), 5, this.h - 4 - Math.max(4, top));
    }
    // Zone dorée encadrée de blanc
    const zy0 = this.yOf(this.zone[1]);
    const zy1 = this.yOf(this.zone[0]);
    g.fillStyle(COLORS.yellow, golden ? 0.35 : 0.22);
    g.fillRect(2, zy0, w - 4, zy1 - zy0);
    g.lineStyle(3, COLORS.cream, 1);
    g.strokeRect(-3, zy0, w + 6, zy1 - zy0);
    // Graduations
    g.lineStyle(2, COLORS.cream, 0.35);
    for (const p of [25, 50, 75]) g.lineBetween(w - 10, this.yOf(p), w - 3, this.yOf(p));
    // Contour
    g.lineStyle(4, COLORS.ink, 1);
    g.strokeRoundedRect(0, 0, w, this.h, 6);
  }
}
