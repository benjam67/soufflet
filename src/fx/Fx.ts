import Phaser from 'phaser';
import { digitsImage, ONOMATOPOEIA, type DigitVariant } from './bake';
import { COLORS } from '../ui/theme';

type OnoKind = keyof typeof ONOMATOPOEIA;
export type LabelKey = 'lbl_crit' | 'lbl_grazed' | 'lbl_missed' | 'lbl_limp' | 'lbl_self' | 'lbl_special' | 'lbl_stun';

/** Compteurs d'effets (lus par les tests pour vérifier que tout se déclenche). */
export interface FxStats {
  flashes: number;
  focusLines: number;
  onomatopoeia: number;
  particles: number;
  numbers: number;
  screenFlashes: number;
}

/**
 * Effets d'impact façon anime : éclair en étoile, lignes de focus, onomatopées,
 * gouttes et dents qui volent, chiffres de dégâts. Uniquement des images pré-rendues.
 */
export class Fx {
  readonly stats: FxStats = { flashes: 0, focusLines: 0, onomatopoeia: 0, particles: 0, numbers: 0, screenFlashes: 0 };
  private drops: Record<1 | -1, Phaser.GameObjects.Particles.ParticleEmitter>;
  private teeth: Record<1 | -1, Phaser.GameObjects.Particles.ParticleEmitter>;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private flashRect: Phaser.GameObjects.Rectangle;
  /** Onomatopées et chiffres encore à l'écran (balayés au K.O.). */
  private transient = new Set<Phaser.GameObjects.Container>();

  constructor(private scene: Phaser.Scene) {
    const mk = (key: string, dir: 1 | -1, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) =>
      scene.add
        .particles(0, 0, key, {
          emitting: false,
          gravityY: 1400,
          rotate: { min: -180, max: 180 },
          // Projetés vers l'arrière de la victime (dans le sens de la gifle), en cloche.
          angle: dir === 1 ? { min: -80, max: -10 } : { min: 190, max: 260 },
          ...cfg,
        })
        .setDepth(45);
    this.drops = {
      1: mk('fx_drop', 1, { speed: { min: 260, max: 620 }, lifespan: 750, scale: { start: 1.1, end: 0.5 }, alpha: { start: 1, end: 0.2 } }),
      [-1]: mk('fx_drop', -1, { speed: { min: 260, max: 620 }, lifespan: 750, scale: { start: 1.1, end: 0.5 }, alpha: { start: 1, end: 0.2 } }),
    } as Record<1 | -1, Phaser.GameObjects.Particles.ParticleEmitter>;
    this.teeth = {
      1: mk('fx_tooth', 1, { speed: { min: 380, max: 720 }, lifespan: 1000, scale: 1 }),
      [-1]: mk('fx_tooth', -1, { speed: { min: 380, max: 720 }, lifespan: 1000, scale: 1 }),
    } as Record<1 | -1, Phaser.GameObjects.Particles.ParticleEmitter>;
    this.sparks = scene.add
      .particles(0, 0, 'fx_spark', {
        emitting: false,
        speed: { min: 300, max: 900 },
        angle: { min: 0, max: 360 },
        lifespan: 260,
        scale: { start: 0.9, end: 0 },
        tint: [0xffffff, 0xffc93c, 0xff8a1f],
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(44);
    this.flashRect = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 1).setOrigin(0).setDepth(80).setAlpha(0);
  }

  layout(width: number, height: number) {
    this.flashRect.setSize(width, height);
  }

  /** Éclair blanc et orange en étoile + étincelles. */
  flash(x: number, y: number, size: number) {
    this.stats.flashes++;
    const img = this.scene.add
      .image(x, y, `fx_star_${Phaser.Math.Between(0, 2)}`)
      .setDepth(42)
      .setAngle(Phaser.Math.Between(0, 359))
      .setScale(0.3 * size);
    this.scene.tweens.add({ targets: img, scale: size * 1.1, duration: 90, ease: 'Quad.Out' });
    this.scene.tweens.add({ targets: img, alpha: 0, scale: size * 1.3, delay: 130, duration: 170, onComplete: () => img.destroy() });
    this.sparks.explode(Math.round(8 + size * 10), x, y);
  }

  /** Lignes de focus manga convergeant vers l'impact. */
  focusLines(x: number, y: number, strength: number) {
    this.stats.focusLines++;
    const img = this.scene.add
      .image(x, y, 'fx_focus')
      .setDepth(41)
      .setAlpha(0)
      .setScale(1.5 + strength * 0.4)
      .setAngle(Phaser.Math.Between(0, 359));
    this.scene.tweens.add({ targets: img, alpha: Math.min(1, 0.55 + strength * 0.45), duration: 60 });
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      scale: img.scale * 0.85,
      delay: 260 + strength * 200,
      duration: 220,
      onComplete: () => img.destroy(),
    });
  }

  /** Onomatopée japonaise + sous-titre français, au-dessus de l'impact. */
  onomatopoeia(kind: OnoKind, x: number, y: number, dir: number) {
    this.stats.onomatopoeia++;
    // Au-dessus de l'impact, décalée vers la victime : jamais sur le visage de celui qui gifle.
    // Le chiffre de dégâts garde l'espace juste au-dessus de l'impact.
    const c = this.scene.add.container(x + dir * (kind === 'crit' ? 230 : 200), y - (kind === 'crit' ? 165 : 130)).setDepth(70);
    const jp = this.scene.add.image(0, 0, `ono_${kind}_jp`);
    const fr = this.scene.add.image(dir * 20, jp.height * 0.42, `ono_${kind}_fr`).setAngle(-6);
    c.add([jp, fr]);
    c.setAngle(Phaser.Math.Between(-14, -4) * (dir === 1 ? 1 : -1));
    this.track(c);
    c.setScale(0.25);
    this.scene.tweens.add({ targets: c, scale: kind === 'crit' ? 1.15 : 1, duration: 130, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: c, y: c.y - 24, duration: 900, ease: 'Sine.Out' });
    this.scene.tweens.add({ targets: c, alpha: 0, delay: 700, duration: 250, onComplete: () => c.destroy() });
  }

  /** Gouttes et dents qui volent, dans le sens de la gifle. */
  debris(x: number, y: number, dir: 1 | -1, drops: number, teeth: number) {
    this.stats.particles++;
    if (drops > 0) this.drops[dir].explode(drops, x, y);
    if (teeth > 0) this.teeth[dir].explode(teeth, x, y);
  }

  private track(c: Phaser.GameObjects.Container) {
    this.transient.add(c);
    c.once(Phaser.GameObjects.Events.DESTROY, () => this.transient.delete(c));
  }

  /** Fait disparaître vite les onomatopées et chiffres encore visibles (avant une grande annonce). */
  clearTransient() {
    for (const c of this.transient) {
      this.scene.tweens.killTweensOf(c);
      this.scene.tweens.add({ targets: c, alpha: 0, scale: c.scale * 0.8, duration: 120, onComplete: () => c.destroy() });
    }
  }

  /** Flash plein écran (critiques, K.O.). */
  screenFlash(alpha: number, color = 0xffffff) {
    this.stats.screenFlashes++;
    this.flashRect.setFillStyle(color, 1).setAlpha(alpha);
    this.scene.tweens.killTweensOf(this.flashRect);
    this.scene.tweens.add({ targets: this.flashRect, alpha: 0, duration: 160, ease: 'Quad.Out' });
  }

  /** Chiffre de dégâts qui jaillit puis s'envole, avec étiquette éventuelle. */
  damageNumber(x: number, y: number, n: number, variant: DigitVariant, label?: LabelKey) {
    this.stats.numbers++;
    const c = this.scene.add.container(x, y).setDepth(72);
    c.add(digitsImage(this.scene, n, variant));
    if (label) c.add(this.scene.add.image(0, variant === 'c' ? 50 : 42, label).setAngle(-6));
    this.track(c);
    c.setScale(0.2);
    this.scene.tweens.add({ targets: c, scale: 1, duration: 140, ease: 'Back.Out' });
    this.scene.tweens.add({ targets: c, y: y - 70, alpha: 0, delay: 650, duration: 450, ease: 'Quad.In', onComplete: () => c.destroy() });
  }
}

/** Bandeau incliné (annonces) à partir d'une texture pré-rendue. */
export function bannerImage(scene: Phaser.Scene, textKey: string, fromSide: 'left' | 'right', holdMs = 650) {
  const { width, height } = scene.scale;
  const c = scene.add.container(width / 2, height * 0.42).setDepth(90).setAngle(-6);
  const bandH = 86;
  const band = scene.add.rectangle(0, 0, width * 1.4, bandH, COLORS.red).setStrokeStyle(6, COLORS.ink);
  const stripe = scene.add.rectangle(0, bandH / 2 - 10, width * 1.4, 6, COLORS.yellow);
  const label = scene.add.image(0, -2, textKey);
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

/** Grande annonce centrale (ROUND 1, BAGARRE !, K.O. !) à partir d'une texture. Renvoie sa durée. */
export function announceImage(scene: Phaser.Scene, textKey: string, holdMs = 700, y = 0.4) {
  const { width, height } = scene.scale;
  const t = scene.add.image(width / 2, height * y, textKey).setAngle(-5).setDepth(95).setScale(2.6).setAlpha(0);
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
