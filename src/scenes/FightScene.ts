import Phaser from 'phaser';
import assets from '../config/assets.json';
import { STAGE, type FighterId } from '../config/balance';
import { computeLayout, HABITUES, type StageLayout } from '../logic/layout';
import { fighterKey, type Pose } from './BootScene';

/** Scène de combat. Phase 0 : décor, foule, patron et combattants statiques. */
export class FightScene extends Phaser.Scene {
  private decor!: Phaser.GameObjects.Image;
  private patron!: Phaser.GameObjects.Image;
  private crowd: Phaser.GameObjects.Image[] = [];
  private fighters!: Record<'left' | 'right', { id: FighterId; sprite: Phaser.GameObjects.Image }>;
  layout!: StageLayout;

  constructor() {
    super('Fight');
  }

  create() {
    this.decor = this.add.image(0, 0, 'decor').setOrigin(0, 0);

    this.crowd = HABITUES.map((id) =>
      this.add.image(0, 0, `habitue_${id}`).setOrigin(0.5, 1).setTint(STAGE.crowdTint),
    );
    this.patron = this.add.image(0, 0, 'patron').setOrigin(0.5, 1).setTint(STAGE.patronTint);

    this.fighters = {
      left: { id: 'bernard', sprite: this.makeFighter('bernard', false) },
      right: { id: 'lola', sprite: this.makeFighter('lola', true) },
    };

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this));

    if (window.__slap) {
      window.__slap.ready = true;
      window.__slap.scene = 'Fight';
    }
  }

  /**
   * Phaser retourne la texture à l'intérieur de son cadre sans bouger l'origine :
   * pour un perso en miroir, le point d'ancrage (entre les pieds) passe à 1 - originX.
   */
  private makeFighter(id: FighterId, flipX: boolean) {
    const a = assets.fighters[id];
    return this.add
      .image(0, 0, fighterKey(id, 'idle'))
      .setFlipX(flipX)
      .setOrigin(flipX ? 1 - a.originX : a.originX, a.originY);
  }

  setPose(side: 'left' | 'right', pose: Pose) {
    const f = this.fighters[side];
    f.sprite.setTexture(fighterKey(f.id, pose));
  }

  private applyLayout() {
    const { width, height } = this.scale;
    const L = computeLayout(width, height, this.fighters.left.id, this.fighters.right.id);
    this.layout = L;
    this.cameras.main.setSize(width, height);

    this.decor.setPosition(L.decor.x, L.decor.y).setScale(L.decor.scale);
    this.patron.setPosition(L.patron.x, L.patron.y).setScale(L.patron.scale);
    L.crowd.forEach((c, i) => this.crowd[i].setPosition(c.x, c.y).setScale(c.scale));
    for (const side of ['left', 'right'] as const) {
      const p = L[side];
      this.fighters[side].sprite.setPosition(p.x, p.y).setScale(p.scale);
    }
    if (window.__slap) window.__slap.layout = L;
  }
}
