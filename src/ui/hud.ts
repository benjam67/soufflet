import Phaser from 'phaser';
import { COLORS, CSS, FONT_TITLE } from './theme';

/** Chrono du tour dans un losange central. */
export class TimerDiamond extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private ratio = 1;
  private readonly r = 38;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0);
    this.g = scene.add.graphics();
    this.label = scene.add
      .text(0, 2, '', {
        fontFamily: FONT_TITLE,
        fontSize: '34px',
        color: CSS.cream,
        stroke: CSS.ink,
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    this.add([this.g, this.label]);
    scene.add.existing(this);
    this.set(null);
  }

  /** `seconds` restant (null = pas de chrono, losange vide), `ratio` 0–1 pour l'anneau. */
  set(seconds: number | null, ratio = 1) {
    this.ratio = ratio;
    const text = seconds === null ? '' : `${Math.ceil(seconds)}`;
    if (this.label.text !== text) {
      this.label.setText(text);
      if (seconds !== null && seconds > 0) {
        this.scene.tweens.add({ targets: this.label, scale: { from: 1.5, to: 1 }, duration: 180, ease: 'Back.Out' });
      }
    }
    this.label.setColor(seconds !== null && seconds <= 1 ? CSS.red : CSS.cream);
    this.redraw(seconds !== null && seconds <= 1);
  }

  private redraw(urgent: boolean) {
    const g = this.g;
    const r = this.r;
    g.clear();
    const diamond = (rr: number) => [
      new Phaser.Math.Vector2(0, -rr),
      new Phaser.Math.Vector2(rr, 0),
      new Phaser.Math.Vector2(0, rr),
      new Phaser.Math.Vector2(-rr, 0),
    ];
    g.fillStyle(COLORS.ink, 1);
    g.fillPoints(diamond(r + 6), true);
    g.fillStyle(urgent ? COLORS.red : COLORS.pink, 1);
    g.fillPoints(diamond(r), true);
    g.lineStyle(4, COLORS.cream, 1);
    g.strokePoints(diamond(r), true);
    // Temps restant : petite barre sous le losange.
    if (this.label.text !== '') {
      const w = 64;
      g.fillStyle(COLORS.ink, 1);
      g.fillRect(-w / 2 - 3, r + 10, w + 6, 10);
      g.fillStyle(urgent ? COLORS.red : COLORS.yellow, 1);
      g.fillRect(-w / 2, r + 13, w * this.ratio, 4);
    }
  }
}

/** Losanges des rounds gagnés, sous la barre de vie, côté centre. */
export class RoundPips extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private won = 0;

  constructor(
    scene: Phaser.Scene,
    readonly side: 'left' | 'right',
    readonly total: number,
  ) {
    super(scene, 0, 0);
    this.g = scene.add.graphics();
    this.add(this.g);
    scene.add.existing(this);
    this.redraw();
  }

  setWon(n: number) {
    const gained = n > this.won;
    this.won = n;
    this.redraw();
    if (gained) this.scene.tweens.add({ targets: this, scale: { from: 1.6, to: 1 }, duration: 260, ease: 'Back.Out' });
  }

  private redraw() {
    const g = this.g;
    g.clear();
    const dir = this.side === 'left' ? -1 : 1; // les losanges partent du centre vers l'extérieur
    for (let i = 0; i < this.total; i++) {
      const x = dir * i * 30;
      const pts = [
        new Phaser.Math.Vector2(x, -12),
        new Phaser.Math.Vector2(x + 12, 0),
        new Phaser.Math.Vector2(x, 12),
        new Phaser.Math.Vector2(x - 12, 0),
      ];
      g.fillStyle(i < this.won ? COLORS.yellow : COLORS.ink, i < this.won ? 1 : 0.7);
      g.fillPoints(pts, true);
      g.lineStyle(3, i < this.won ? COLORS.ink : COLORS.cream, 1);
      g.strokePoints(pts, true);
    }
  }
}

/** Bandeau rouge incliné « À TOI, BERNARD ! » façon annonce d'anime. */
export function turnBanner(scene: Phaser.Scene, text: string, fromSide: 'left' | 'right', holdMs = 650) {
  const { width, height } = scene.scale;
  const c = scene.add.container(width / 2, height * 0.42).setDepth(90).setAngle(-6);
  const bandH = 86;
  const band = scene.add.rectangle(0, 0, width * 1.4, bandH, COLORS.red).setStrokeStyle(6, COLORS.ink);
  const stripe = scene.add.rectangle(0, bandH / 2 - 10, width * 1.4, 6, COLORS.yellow);
  const label = scene.add
    .text(0, -2, text, {
      fontFamily: FONT_TITLE,
      fontSize: '52px',
      color: CSS.cream,
      stroke: CSS.ink,
      strokeThickness: 10,
    })
    .setOrigin(0.5);
  c.add([band, stripe, label]);
  const dir = fromSide === 'left' ? -1 : 1;
  c.x = width / 2 + dir * width * 1.3;
  scene.tweens.chain({
    targets: c,
    tweens: [
      { x: width / 2, duration: 170, ease: 'Cubic.Out' },
      { x: width / 2 - dir * 24, duration: holdMs, ease: 'Linear' },
      { x: width / 2 - dir * width * 1.3, duration: 170, ease: 'Cubic.In' },
    ],
    onComplete: () => c.destroy(),
  });
  return 170 + holdMs + 170;
}

/** Grande annonce centrale (ROUND 1, BAGARRE !, K.O. !). Renvoie sa durée totale. */
export function bigAnnounce(scene: Phaser.Scene, text: string, color: string, holdMs = 700, size = 110) {
  const { width, height } = scene.scale;
  const t = scene.add
    .text(width / 2, height * 0.4, text, {
      fontFamily: FONT_TITLE,
      fontSize: `${size}px`,
      color,
      stroke: CSS.ink,
      strokeThickness: 16,
    })
    .setOrigin(0.5)
    .setAngle(-5)
    .setDepth(95)
    .setScale(2.6)
    .setAlpha(0);
  scene.tweens.chain({
    targets: t,
    tweens: [
      { scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' },
      { scale: 1.06, duration: holdMs, ease: 'Linear' },
      { alpha: 0, scale: 0.9, duration: 200, ease: 'Quad.In' },
    ],
    onComplete: () => t.destroy(),
  });
  return 200 + holdMs + 200;
}
