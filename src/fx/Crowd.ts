import Phaser from 'phaser';
import { commentKey } from './bake';
import { COMMENTS, type CommentKind } from '../config/comments';
import { COLORS } from '../ui/theme';

interface Person {
  img: Phaser.GameObjects.Image;
  baseX: number;
  baseY: number;
  phase: number;
  speed: number;
  /** Décalage vertical animé (saut) et inclinaison, pilotés par des tweens. */
  anim: { jump: number; tilt: number };
}

/**
 * Les habitués et le patron : chacun respire à son rythme, saute et se dandine
 * quand une gifle claque, le patron siffle les débuts de round.
 */
export class Crowd {
  private people: Person[];
  private patron: Person;
  private bubble: Phaser.GameObjects.Container | null = null;
  readonly stats = { cheers: 0, boos: 0, whistles: 0 };

  constructor(
    private scene: Phaser.Scene,
    habitues: Phaser.GameObjects.Image[],
    patron: Phaser.GameObjects.Image,
  ) {
    const mk = (img: Phaser.GameObjects.Image): Person => ({
      img,
      baseX: img.x,
      baseY: img.y,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0022 + Math.random() * 0.0016,
      anim: { jump: 0, tilt: 0 },
    });
    this.people = habitues.map(mk);
    this.patron = mk(patron);
  }

  /** Nouvelles positions de repos (après un redimensionnement). */
  layout() {
    for (const p of [...this.people, this.patron]) {
      p.baseX = p.img.x;
      p.baseY = p.img.y;
    }
  }

  update(time: number) {
    for (const p of [...this.people, this.patron]) {
      const breath = Math.sin(time * p.speed + p.phase);
      p.img.y = p.baseY - p.anim.jump * p.img.scaleY - Math.max(0, breath) * 2;
      p.img.setAngle(p.anim.tilt + breath * 0.8);
    }
  }

  /** Clameur : chacun saute avec son propre retard (intensité 0–1). */
  cheer(intensity: number) {
    this.stats.cheers++;
    for (const p of this.people) {
      this.scene.tweens.killTweensOf(p.anim);
      const h = 18 + 40 * intensity * (0.6 + Math.random() * 0.6);
      const hops = intensity > 0.75 ? 2 : 1;
      this.scene.tweens.add({
        targets: p.anim,
        jump: h,
        tilt: (Math.random() < 0.5 ? -1 : 1) * (3 + 6 * intensity),
        duration: 150 + Math.random() * 60,
        ease: 'Quad.Out',
        yoyo: true,
        repeat: hops - 1,
        delay: Math.random() * 180,
        onComplete: () => {
          p.anim.jump = 0;
          p.anim.tilt = 0;
        },
      });
    }
  }

  /** Huées : tout le monde s'affaisse un peu en secouant la tête. */
  boo() {
    this.stats.boos++;
    for (const p of this.people) {
      this.scene.tweens.killTweensOf(p.anim);
      this.scene.tweens.add({
        targets: p.anim,
        jump: -6,
        tilt: { from: -4, to: 4 },
        duration: 120,
        yoyo: true,
        repeat: 2,
        delay: Math.random() * 120,
        onComplete: () => {
          p.anim.jump = 0;
          p.anim.tilt = 0;
        },
      });
    }
  }

  /** Le patron siffle : petit saut et bulle « PRRRT ! ». */
  whistle() {
    this.stats.whistles++;
    const p = this.patron;
    this.scene.tweens.killTweensOf(p.anim);
    this.scene.tweens.add({ targets: p.anim, jump: 14, duration: 110, yoyo: true, repeat: 1, ease: 'Quad.Out' });
    this.bubble?.destroy();
    const img = p.img;
    const x = img.x + img.displayWidth * 0.42;
    const y = img.y - img.displayHeight * 0.9;
    const c = this.scene.add.container(x, y).setDepth(60);
    const bg = this.scene.add.image(0, 0, 'fx_bubble').setOrigin(0.15, 0.9);
    const t = this.scene.add.image(bg.displayWidth * 0.35, -bg.displayHeight * 0.53, 'bub_whistle');
    c.add([bg, t]);
    c.setScale(0.2).setAngle(-6);
    this.scene.tweens.add({ targets: c, scale: 0.85, duration: 140, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: c, alpha: 0, delay: 900, duration: 200, onComplete: () => c.destroy() });
    this.bubble = c;
  }
}

/** Bandeau du commentateur en bas de l'écran. */
export class Commentator {
  private c: Phaser.GameObjects.Container;
  private band: Phaser.GameObjects.Rectangle;
  private tag: Phaser.GameObjects.Image;
  private line: Phaser.GameObjects.Image | null = null;
  private hideTimer: Phaser.Time.TimerEvent | null = null;
  private last: Partial<Record<CommentKind, number>> = {};
  readonly stats = { comments: 0, lastKey: '' };
  private h = 46;

  constructor(private scene: Phaser.Scene) {
    this.band = scene.add.rectangle(0, 0, 10, this.h, COLORS.ink, 0.88).setOrigin(0, 0).setStrokeStyle(3, COLORS.yellow);
    this.tag = scene.add.image(14, this.h / 2, 'com_tag').setOrigin(0, 0.5).setAngle(-3);
    this.c = scene.add.container(0, 0, [this.band, this.tag]).setDepth(105);
    this.c.setVisible(false);
  }

  layout(width: number, height: number) {
    this.band.setSize(width + 10, this.h);
    this.c.setPosition(-5, height - this.h);
    this.yShown = height - this.h;
    this.yHidden = height + 4;
    if (!this.c.visible) this.c.y = this.yHidden;
  }

  private yShown = 0;
  private yHidden = 0;

  /** Dit une phrase de la catégorie donnée (jamais deux fois de suite la même). */
  say(kind: CommentKind) {
    const list = COMMENTS[kind];
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.last[kind]) i = (i + 1) % list.length;
    this.last[kind] = i;
    const key = commentKey(kind, i);
    this.stats.comments++;
    this.stats.lastKey = key;

    this.line?.destroy();
    this.line = this.scene.add.image(this.tag.x + this.tag.displayWidth + 16, this.h / 2, key).setOrigin(0, 0.5);
    this.c.add(this.line);
    this.c.setVisible(true);
    this.scene.tweens.killTweensOf(this.c);
    this.scene.tweens.add({ targets: this.c, y: this.yShown, duration: 160, ease: 'Quad.Out' });
    this.hideTimer?.remove(false);
    this.hideTimer = this.scene.time.delayedCall(2300, () => this.hide());
  }

  hide() {
    this.scene.tweens.killTweensOf(this.c);
    this.scene.tweens.add({
      targets: this.c,
      y: this.yHidden,
      duration: 200,
      ease: 'Quad.In',
      onComplete: () => this.c.setVisible(false),
    });
  }

  get visible() {
    return this.c.visible;
  }
}
