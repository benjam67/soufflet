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
import { needsInstallHint, safeInsets } from '../ui/safe';
import type { FightData } from './FightScene';
import { FIGHTERS, type FighterId } from '../config/balance';
import { PROGRESS } from '../config/progress';
import { choices, levelOf, levelProgress, loadProgress, nameOf, nextChoice, nextUnlock, saveProgress, tintOf, xpForLevel, type Progress } from '../logic/progress';

export interface TitleData {
  /** Ouvre directement le salon en ligne (lien `?join=CODE`, `?mode=online`, ou reprise). */
  lobby?: { join?: string; resume?: SavedSession };
  speed?: number;
  bot?: boolean;
}

type View = 'main' | 'solo' | 'locker';

/** Écran d'accueil : choix du mode de jeu, du perso, des tenues et du bar ; niveau du joueur. */
export class TitleScene extends Phaser.Scene {
  private items: Phaser.GameObjects.GameObject[] = [];
  private menu: Phaser.GameObjects.Container | null = null;
  private view: View = 'main';
  private progress: Progress = loadProgress();
  private extra: TitleData = {};

  constructor() {
    super('Title');
  }

  init(data: TitleData) {
    this.extra = data ?? {};
    this.view = 'main';
    this.progress = loadProgress();
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
    }
    this.publish();
    if (this.extra.lobby) void this.online(this.extra.lobby);
  }

  private build() {
    for (const o of this.items) o.destroy();
    this.items = [];
    const { width, height } = this.scale;
    const L = computeLayout(width, height);
    const safe = safeInsets(this);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.items.push(o), o);

    const p = this.progress;
    const dim = Phaser.Display.Color.ValueToColor(tintOf(p.bar)).darken(42).color;
    add(this.add.image(L.decor.x, L.decor.y, 'decor').setOrigin(0, 0).setScale(L.decor.scale).setTint(p.bar === 'base' ? 0x8a7f92 : dim));
    add(this.add.rectangle(0, 0, width, height, COLORS.ink, 0.35).setOrigin(0));

    // Les deux combattants encadrent le menu.
    const a = assets.fighters;
    const s = L.fighterScale * 1.08;
    // Le perso choisi à gauche, son adversaire à droite, chacun dans sa tenue.
    const mine = p.fighter;
    const foe: FighterId = mine === 'bernard' ? 'lola' : 'bernard';
    add(
      this.add
        .image(width * 0.16, height * 0.98, fighterKey(mine, mine === 'bernard' ? 'idle' : 'victory'))
        .setOrigin(a[mine].originX, a[mine].originY)
        .setScale(s)
        .setTint(tintOf(p.skin[mine]))
        .setDepth(2),
    );
    add(
      this.add
        .image(width * 0.85, height * 0.98, fighterKey(foe, foe === 'bernard' ? 'idle' : 'victory'))
        .setFlipX(true)
        .setOrigin(1 - a[foe].originX, a[foe].originY)
        .setScale(s)
        .setTint(tintOf(p.skin[foe]))
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

    // Niveau du joueur et barre d'XP, sous le titre.
    const lv = levelOf(p.xp);
    const max = lv >= PROGRESS.maxLevel;
    const py = height * 0.345;
    const barW = 260;
    add(
      this.add
        .text(width / 2, py, max ? `NIVEAU ${lv} · MAX` : `NIVEAU ${lv}  ·  ${p.xp} / ${xpForLevel(lv + 1)} XP`, { fontFamily: FONT_TITLE, fontSize: '22px', color: CSS.cream, stroke: CSS.ink, strokeThickness: 6 })
        .setOrigin(0.5)
        .setDepth(3)
        .setName('profile'),
    );
    add(this.add.rectangle(width / 2, py + 24, barW, 12, COLORS.ink).setStrokeStyle(3, COLORS.cream).setDepth(3));
    add(
      this.add
        .rectangle(width / 2 - barW / 2 + 3, py + 24, Math.max(1, (barW - 6) * levelProgress(p.xp)), 6, COLORS.yellow)
        .setOrigin(0, 0.5)
        .setDepth(3),
    );

    this.menu = add(this.add.container(width / 2, height * 0.64).setDepth(4));
    this.fillMenu();

    add(
      this.add
        .text(width / 2, height - 14 - safe.bottom, needsInstallHint() ? 'iPhone : pour le plein écran, touche Partager puis « Sur l’écran d’accueil »' : 'Un bar de village, à la fermeture. Deux joues. Aucune raison.', {
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
        .image(width - 44 - Math.max(safe.left, safe.right), 44, sfx.muted ? 'ico_sound_off' : 'ico_sound_on')
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
    const p = this.progress;
    const go = (data: FightData) => () => this.scene.start('Fight', { speed: this.extra.speed, fighter: p.fighter, ...data });
    const small = { w: 300, h: 56, font: 22 };
    if (this.view === 'main') {
      m.add(makeButton(this, -dx, -dy, 'SOLO', COLORS.yellow, () => this.setView('solo')));
      m.add(makeButton(this, dx, -dy, '2 JOUEURS', COLORS.cyan, go({ mode: 'match' })));
      m.add(makeButton(this, -dx, dy + 8, 'EN LIGNE', COLORS.pink, () => void this.online({})));
      m.add(makeButton(this, dx, dy + 8, 'ENTRAÎNEMENT', COLORS.cream, go({ mode: 'training' })));
      m.add(makeButton(this, 0, dy + 86, 'VESTIAIRE', COLORS.cream, () => this.setView('locker'), { w: 220, h: 50, font: 20 }));
    } else if (this.view === 'solo') {
      const lv = (level: AiLevel) => go({ mode: 'solo', level });
      m.add(makeButton(this, -dx * 1.35, -dy, 'FACILE', COLORS.cyan, lv('easy'), { w: 210 }));
      m.add(makeButton(this, 0, -dy, 'NORMAL', COLORS.yellow, lv('normal'), { w: 210 }));
      m.add(makeButton(this, dx * 1.35, -dy, 'DIFFICILE', COLORS.pink, lv('hard'), { w: 210 }));
      m.add(makeButton(this, -dx, dy + 8, `PERSO : ${FIGHTERS[p.fighter].short.toUpperCase()}`, COLORS.cream, () => this.change(() => (p.fighter = p.fighter === 'bernard' ? 'lola' : 'bernard')), small).setName('btn-perso'));
      m.add(makeButton(this, dx, dy + 8, '← RETOUR', COLORS.cream, () => this.setView('main'), { w: 220, h: 54, font: 22 }));
    } else {
      // Vestiaire : tenues et bar. On passe d'un choix débloqué au suivant.
      const skinBtn = (id: FighterId, x: number) => {
        const list = choices('skin', p.xp, id);
        return makeButton(this, x, -dy, `${FIGHTERS[id].short.toUpperCase()} : ${nameOf(p.skin[id]).toUpperCase()}`, list.length > 1 ? COLORS.yellow : COLORS.cream, () => this.change(() => (p.skin[id] = nextChoice(list, p.skin[id]))), small).setName(`btn-skin-${id}`);
      };
      m.add(skinBtn('bernard', -dx));
      m.add(skinBtn('lola', dx));
      const bars = choices('bar', p.xp);
      m.add(makeButton(this, -dx, dy + 8, `BAR : ${nameOf(p.bar).toUpperCase()}`, bars.length > 1 ? COLORS.yellow : COLORS.cream, () => this.change(() => (p.bar = nextChoice(bars, p.bar))), small).setName('btn-bar'));
      m.add(makeButton(this, dx, dy + 8, '← RETOUR', COLORS.cream, () => this.setView('main'), { w: 220, h: 54, font: 22 }));
      const next = nextUnlock(p.xp);
      const what = next ? (next.kind === 'bar' ? next.name : `tenue ${next.name} de ${FIGHTERS[next.fighter!].short}`) : '';
      m.add(
        this.add
          .text(0, dy + 78, next ? `Prochain déblocage : niveau ${next.level} — ${what}` : 'Tout est débloqué !', { fontFamily: FONT_UI, fontStyle: '800', fontSize: '19px', color: CSS.cream, stroke: CSS.ink, strokeThickness: 5 })
          .setOrigin(0.5)
          .setName('next-unlock'),
      );
    }
  }

  /** Change un choix (perso, tenue, bar), le sauvegarde et redessine l'écran. */
  private change(fn: () => void) {
    fn();
    saveProgress(this.progress);
    this.build();
    this.publish();
  }

  private setView(view: View) {
    this.view = view;
    this.fillMenu();
    this.publish();
  }

  private publish() {
    if (!window.__slap) return;
    const p = this.progress;
    window.__slap.state = { mode: 'title', view: this.view, progress: { ...p, skin: { ...p.skin }, level: levelOf(p.xp) } };
  }

  private async online(opts: { join?: string; resume?: SavedSession }) {
    this.input.enabled = false;
    const game = await openLobby(opts);
    this.input.enabled = true;
    if (game) this.scene.start('Fight', { mode: 'online', online: game, speed: this.extra.speed, bot: this.extra.bot });
  }
}
