import Phaser from 'phaser';
import { COLORS, CSS, FONT_TITLE, FONT_UI } from './theme';

/**
 * Barre de vie inclinée façon jeu de baston, contour noir épais.
 * Côté gauche : la barre se vide vers la gauche (bord extérieur) ; côté droit : en miroir.
 */
export class HealthBar extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private kanaText: Phaser.GameObjects.Text;
  private shown = 1; // part affichée (jaune)
  private trail = 1; // part « dégâts récents » (rouge), rattrape le jaune
  private target = 1;
  private trailPx = -1;
  private barW = 400;
  private readonly barH = 30;
  /** Jauge de rage, fine, sous la barre de vie. */
  private rage = 0;
  private rageFull = false;
  private rageG: Phaser.GameObjects.Graphics;
  private rageGlow: Phaser.GameObjects.Graphics;
  private rageTag: Phaser.GameObjects.Image | null = null;
  private readonly rageY = 37;
  private readonly rageH = 8;
  private readonly rageFrac = 0.6;
  private readonly slant = 16;

  constructor(
    scene: Phaser.Scene,
    readonly side: 'left' | 'right',
    name: string,
    katakana: string,
  ) {
    super(scene, 0, 0);
    this.g = scene.add.graphics();
    this.rageGlow = scene.add.graphics().setAlpha(0);
    this.rageG = scene.add.graphics();
    this.nameText = scene.add
      .text(0, 0, name.toUpperCase(), {
        fontFamily: FONT_TITLE,
        fontSize: '26px',
        color: CSS.cream,
        stroke: CSS.ink,
        strokeThickness: 6,
      })
      .setOrigin(side === 'left' ? 0 : 1, 0);
    this.kanaText = scene.add
      .text(0, 0, katakana, {
        fontFamily: FONT_UI,
        fontStyle: '800',
        fontSize: '18px',
        color: CSS.yellow,
        stroke: CSS.ink,
        strokeThickness: 5,
      })
      .setOrigin(side === 'left' ? 0 : 1, 0);
    this.add([this.g, this.rageGlow, this.rageG, this.nameText, this.kanaText]);
    scene.add.existing(this);
    this.addToUpdateList();
  }

  /** Place la barre : x = bord extérieur, largeur disponible jusqu'au centre. */
  layout(outerX: number, y: number, width: number) {
    this.barW = width;
    this.setPosition(outerX, y);
    const dir = this.side === 'left' ? 1 : -1;
    this.nameText.setPosition(dir * (this.slant + 4), this.rageY + this.rageH + 4);
    this.kanaText.setPosition(dir * (this.slant + 10 + this.nameText.width), this.rageY + this.rageH + 10);
    this.redraw();
    this.redrawRage();
  }

  setValue(ratio: number, instant = false) {
    this.target = Phaser.Math.Clamp(ratio, 0, 1);
    this.shown = this.target;
    if (instant || this.target > this.trail) this.trail = this.target;
    this.redraw();
  }

  /** Rage de 0 à 1 ; pleine = spéciale prête (la jauge clignote, étiquette « RAGE MAX ! »). */
  setRage(ratio: number) {
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    const full = r >= 1;
    if (r === this.rage && full === this.rageFull) return;
    this.rage = r;
    if (full !== this.rageFull) {
      this.rageFull = full;
      this.scene.tweens.killTweensOf(this.rageGlow);
      this.rageGlow.setAlpha(0);
      this.rageTag?.destroy();
      this.rageTag = null;
      if (full) {
        this.scene.tweens.add({ targets: this.rageGlow, alpha: { from: 0.2, to: 0.9 }, duration: 280, yoyo: true, repeat: -1 });
        const dir = this.side === 'left' ? 1 : -1;
        const x = dir * (this.slant + this.barW * this.rageFrac + 10);
        this.rageTag = this.scene.add.image(x, this.rageY + this.rageH / 2, 'lbl_ragemax').setOrigin(this.side === 'left' ? 0 : 1, 0.5).setAngle(-4);
        this.add(this.rageTag);
        this.rageTag.setScale(1.6);
        this.scene.tweens.add({ targets: this.rageTag, scale: 1, duration: 220, ease: 'Back.Out' });
      }
    }
    this.redrawRage();
  }

  get rageIsFull() {
    return this.rageFull;
  }

  private redrawRage() {
    const dir = this.side === 'left' ? 1 : -1;
    const w = this.barW * this.rageFrac;
    const x0 = dir * (this.slant * 0.5);
    const rect = (g: Phaser.GameObjects.Graphics, frac: number, pad: number) => {
      const x = dir === 1 ? x0 - pad : x0 - frac * w - pad;
      g.fillRect(x, this.rageY - pad, frac * w + pad * 2, this.rageH + pad * 2);
    };
    const g = this.rageG;
    g.clear();
    g.fillStyle(COLORS.ink, 0.9);
    rect(g, 1, 2);
    if (this.rage > 0) {
      g.fillStyle(this.rageFull ? COLORS.pink : COLORS.red, 1);
      rect(g, this.rage, 0);
      g.fillStyle(0xffffff, 0.3);
      const x = dir === 1 ? x0 : x0 - this.rage * w;
      g.fillRect(x, this.rageY + 1, this.rage * w, 2);
    }
    const glow = this.rageGlow;
    glow.clear();
    glow.fillStyle(COLORS.pink, 0.55);
    rect(glow, 1, 6);
  }

  preUpdate(_t: number, dt: number) {
    if (this.trail > this.shown) {
      this.trail = Math.max(this.shown, this.trail - dt * 0.0006);
      // ~1 px de barre par redessin, pas plus souvent.
      const px = Math.round(this.trail * this.barW);
      if (px !== this.trailPx) {
        this.trailPx = px;
        this.redraw();
      }
    }
  }

  /** Parallélogramme de la barre entre les fractions a et b (0 = bord extérieur). */
  private quad(g: Phaser.GameObjects.Graphics, a: number, b: number, inset = 0) {
    const dir = this.side === 'left' ? 1 : -1;
    const w = this.barW;
    const h = this.barH - inset * 2;
    // Bord gauche/droit incliné : en haut décalé de `slant` vers le centre.
    const x = (f: number, top: boolean) => dir * (f * w + (top ? this.slant : 0) + inset);
    const y0 = inset;
    const y1 = inset + h;
    g.beginPath();
    g.moveTo(x(a, true), y0);
    g.lineTo(x(b, true), y0);
    g.lineTo(x(b, false), y1);
    g.lineTo(x(a, false), y1);
    g.closePath();
  }

  private redraw() {
    const g = this.g;
    g.clear();
    // Fond
    g.fillStyle(COLORS.ink, 0.85);
    this.quad(g, 0, 1);
    g.fillPath();
    // Dégâts récents (rouge) puis vie restante (jaune), vidées depuis le centre.
    if (this.trail > 0) {
      g.fillStyle(COLORS.red, 1);
      this.quad(g, 0, this.trail, 3);
      g.fillPath();
    }
    if (this.shown > 0) {
      g.fillStyle(this.shown < 0.25 ? COLORS.pink : COLORS.yellow, 1);
      this.quad(g, 0, this.shown, 3);
      g.fillPath();
      // reflet
      g.fillStyle(0xffffff, 0.35);
      const dir = this.side === 'left' ? 1 : -1;
      g.fillRect(Math.min(0, dir * this.shown * this.barW) + dir * (this.slant + 6), 6, Math.max(0, this.shown * this.barW - this.slant - 12), 5);
    }
    // Contour noir épais
    g.lineStyle(5, COLORS.ink, 1);
    this.quad(g, 0, 1);
    g.strokePath();
  }
}
