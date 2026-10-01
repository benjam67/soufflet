import Phaser from 'phaser';
import assets from '../config/assets.json';
import { sfx } from '../audio/sfx';
import { computeLayout } from '../logic/layout';
import type { AiLevel } from '../logic/ai';
import { openLobby } from '../net/lobby';
import type { SavedSession } from '../net/protocol';
import { makeButton } from '../ui/button';
import { COLORS, CSS, FONT_TITLE, FONT_UI } from '../ui/theme';
import { fighterKey } from './BootScene';
import type { FightData } from './FightScene';

export interface TitleData {
  /** Ouvre directement le salon en ligne (lien `?join=CODE`, `?mode=online`, ou reprise). */
  lobby?: { join?: string; resume?: SavedSession };
  speed?: number;
  bot?: boolean;
}

/** Écran d'accueil : choix du mode de jeu. */
export class TitleScene extends Phaser.Scene {
  private items: Phaser.GameObjects.GameObject[] = [];
  private menu: Phaser.GameObjects.Container | null = null;
  private view: 'main' | 'solo' = 'main';
  private extra: TitleData = {};

  constructor() {
    super('Title');
  }

  init(data: TitleData) {
    this.extra = data ?? {};
    this.view = 'main';
    this.items = [];
    this.menu = null;
  }

  create() {
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
    this.build();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.build, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.build, this));
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      sfx.unlock();
      sfx.startMusic();
    });
    if (window.__slap) {
      window.__slap.ready = true;
      window.__slap.scene = 'Title';
      window.__slap.state = { mode: 'title', view: this.view };
    }
    if (this.extra.lobby) void this.online(this.extra.lobby);
  }

  private build() {
    for (const o of this.items) o.destroy();
    this.items = [];
    const { width, height } = this.scale;
    const L = computeLayout(width, height);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.items.push(o), o);

    add(this.add.image(L.decor.x, L.decor.y, 'decor').setOrigin(0, 0).setScale(L.decor.scale).setTint(0x8a7f92));
    add(this.add.rectangle(0, 0, width, height, COLORS.ink, 0.35).setOrigin(0));

    // Les deux combattants encadrent le menu.
    const a = assets.fighters;
    const s = L.fighterScale * 1.08;
    add(
      this.add
        .image(width * 0.16, height * 0.98, fighterKey('bernard', 'idle'))
        .setOrigin(a.bernard.originX, a.bernard.originY)
        .setScale(s)
        .setDepth(2),
    );
    add(
      this.add
        .image(width * 0.85, height * 0.98, fighterKey('lola', 'victory'))
        .setFlipX(true)
        .setOrigin(1 - a.lola.originX, a.lola.originY)
        .setScale(s)
        .setDepth(2),
    );

    // Titre
    const band = add(this.add.rectangle(width / 2, height * 0.17, width * 1.3, 150, COLORS.red).setStrokeStyle(8, COLORS.ink).setAngle(-4));
    band.setDepth(1);
    add(
      this.add
        .text(width / 2, height * 0.15, 'SLAP FIGHTER', {
          fontFamily: FONT_TITLE,
          fontSize: '96px',
          color: CSS.yellow,
          stroke: CSS.ink,
          strokeThickness: 16,
        })
        .setOrigin(0.5)
        .setAngle(-4)
        .setDepth(3),
    );
    add(
      this.add
        .text(width / 2 + 210, height * 0.15 + 62, 'スラップファイター', {
          fontFamily: FONT_TITLE,
          fontSize: '28px',
          color: CSS.cream,
          stroke: CSS.ink,
          strokeThickness: 7,
        })
        .setOrigin(0.5)
        .setAngle(-4)
        .setDepth(3),
    );

    this.menu = add(this.add.container(width / 2, height * 0.62).setDepth(4));
    this.fillMenu();

    add(
      this.add
        .text(width / 2, height - 14, 'Un bar de village, à la fermeture. Deux joues. Aucune raison.', {
          fontFamily: FONT_UI,
          fontStyle: '800',
          fontSize: '17px',
          color: CSS.cream,
          stroke: CSS.ink,
          strokeThickness: 5,
        })
        .setOrigin(0.5, 1)
        .setDepth(3),
    );

    const snd = add(
      this.add
        .image(width - 44, 44, sfx.muted ? 'ico_sound_off' : 'ico_sound_on')
        .setDepth(5)
        .setInteractive({ useHandCursor: true }),
    );
    snd.on('pointerup', () => {
      sfx.unlock();
      sfx.setMuted(!sfx.muted);
      snd.setTexture(sfx.muted ? 'ico_sound_off' : 'ico_sound_on');
      if (!sfx.muted) sfx.startMusic();
    });
  }

  private fillMenu() {
    const m = this.menu!;
    m.removeAll(true);
    const dx = 165;
    const dy = 46;
    const go = (data: FightData) => () => this.scene.start('Fight', { speed: this.extra.speed, ...data });
    if (this.view === 'main') {
      m.add(makeButton(this, -dx, -dy, 'SOLO', COLORS.yellow, () => this.setView('solo')));
      m.add(makeButton(this, dx, -dy, '2 JOUEURS', COLORS.cyan, go({ mode: 'match' })));
      m.add(makeButton(this, -dx, dy + 8, 'EN LIGNE', COLORS.pink, () => void this.online({})));
      m.add(makeButton(this, dx, dy + 8, 'ENTRAÎNEMENT', COLORS.cream, go({ mode: 'training' })));
    } else {
      const lv = (level: AiLevel) => go({ mode: 'solo', level });
      m.add(makeButton(this, -dx * 1.35, -dy, 'FACILE', COLORS.cyan, lv('easy'), { w: 210 }));
      m.add(makeButton(this, 0, -dy, 'NORMAL', COLORS.yellow, lv('normal'), { w: 210 }));
      m.add(makeButton(this, dx * 1.35, -dy, 'DIFFICILE', COLORS.pink, lv('hard'), { w: 210 }));
      m.add(makeButton(this, 0, dy + 8, '← RETOUR', COLORS.cream, () => this.setView('main'), { w: 220, h: 54, font: 22 }));
    }
  }

  private setView(view: 'main' | 'solo') {
    this.view = view;
    this.fillMenu();
    if (window.__slap) window.__slap.state = { mode: 'title', view };
  }

  private async online(opts: { join?: string; resume?: SavedSession }) {
    this.input.enabled = false;
    const game = await openLobby(opts);
    this.input.enabled = true;
    if (game) this.scene.start('Fight', { mode: 'online', online: game, speed: this.extra.speed, bot: this.extra.bot });
  }
}
