import Phaser from 'phaser';
import assets from '../config/assets.json';
import { ADVANCED, COMBO, DEFENSE, FIGHTERS, MATCH, SLAP, STAGE, type FighterId } from '../config/balance';
import { CHEEK } from '../config/sprites';
import type { CommentKind } from '../config/comments';
import { computeLayout, computeStrike, HABITUES, type StageLayout } from '../logic/layout';
import { DefenseGesture, SlapGesture, type DefenseMove, type GestureOutcome } from '../logic/gesture';
import { chargeAt, computeSlap, judgeDefense, stunCurve, swipeAngle, type ChargeSpeed, type DefenseQuality, type SlapResult } from '../logic/slap';
import { Match, other, replayMatch, type MatchEvent, type Side, type TurnAction } from '../logic/match';
import type { OnlineGame } from '../net/online';
import type { Stage } from '../net/protocol';
import { showNetLost } from '../net/lobby';
import { makeButton } from '../ui/button';
import { aiDecide, aiDefend, AI_PROFILES, LEVEL_LABEL, LEVEL_PROFILE, scaleSpeed, type AiLevel, type AiProfile } from '../logic/ai';
import { createRng, type Rng } from '../logic/rng';
import { sfx } from '../audio/sfx';
import { announceImage, bannerImage, Fx, type LabelKey } from '../fx/Fx';
import { Commentator, Crowd } from '../fx/Crowd';
import { ChargeGauge } from '../ui/ChargeGauge';
import { HealthBar } from '../ui/HealthBar';
import { RoundPips, TimerDiamond } from '../ui/hud';
import { COLORS, CSS, FONT_TITLE, FONT_UI } from '../ui/theme';
import { fighterKey, type Pose } from './BootScene';
import { award, loadProgress, saveProgress, tintOf, levelProgress, type Award, type Progress } from '../logic/progress';

export type Mode = 'match' | 'solo' | 'training' | 'autoplay' | 'online';
/** Qui joue un côté : le doigt du joueur, l'IA, ou l'adversaire à distance (en ligne). */
type Controller = 'human' | 'ai' | 'remote';

export interface FightData {
  mode?: Mode;
  /** Niveau de l'IA en mode solo. */
  level?: AiLevel;
  /** Perso du joueur (à gauche) en solo, à deux et à l'entraînement ; l'adversaire est l'autre. */
  fighter?: FighterId;
  /** Partie en ligne (salon déjà connecté). */
  online?: OnlineGame;
  /** En ligne : le côté local est joué par l'IA (tests et démos). */
  bot?: boolean;
  /** Accélère tout (animations, chrono, IA) : utile pour les tests et démos. */
  speed?: number;
  seed?: number;
}

interface Fighter {
  side: Side;
  id: FighterId;
  sprite: Phaser.GameObjects.Image;
  bar: HealthBar;
  pips: RoundPips;
  hp: number;
  pose: Pose;
  homeX: number;
  /** Traces de main accumulées sur la joue pendant le round. */
  prints: { img: Phaser.GameObjects.Image; dx: number; dy: number }[];
  /** Étoiles qui tournent autour de la tête quand le perso est sonné. */
  dizzy: Phaser.GameObjects.Container | null;
  /** Aura et étiquette quand la spéciale est prête. */
  readyTag: Phaser.GameObjects.Image | null;
}

/**
 * `armed` : le swipe est fait, la gifle est retenue (feinte). `combo` : La Toupie attend les gifles
 * suivantes. `travel` : la gifle est partie, celui qui reçoit peut esquiver. `await` : en ligne,
 * on attend l'esquive (ou l'action validée) de l'autre téléphone.
 */
type ScenePhase = 'intro' | 'banner' | 'ready' | 'charging' | 'armed' | 'combo' | 'travel' | 'await' | 'busy' | 'roundEnd' | 'over';
type SlapAction = Extract<TurnAction, { type: 'slap' }>;
type HitEvent = Extract<MatchEvent, { type: 'hit' }>;
/** Ce que fait celui qui reçoit : esquive au timing, ou garde de rage. */
type Defense = { defense?: DefenseQuality; rageGuard?: boolean };
/** En ligne : temps d'attente maximal de l'esquive de l'adversaire (ms réelles). */
const DEFENSE_WAIT_MS = 1200;
/** Teintes de l'esquive (en attendant les vraies poses) : bleu = correcte, or = parfaite, rose = garde de rage. */
const DODGE_TINT = { good: 0x8fd8ff, perfect: 0xffe27a, rage: 0xff9cc8 } as const;

/** Arrêt sur image au contact, avant la réaction (direction artistique : 80 ms). */
const HITSTOP_MS = 80;
/** Nombre maximal de traces de main visibles par joue. */
const MAX_PRINTS = 6;

/**
 * Scène de combat : match à deux sur le même téléphone, entraînement, ou démo IA contre IA.
 */
export class FightScene extends Phaser.Scene {
  private decor!: Phaser.GameObjects.Image;
  private patron!: Phaser.GameObjects.Image;
  private crowdImgs: Phaser.GameObjects.Image[] = [];
  private f!: Record<Side, Fighter>;
  private gauge!: ChargeGauge;
  private timer!: TimerDiamond;
  private hint!: Phaser.GameObjects.Text;
  private modeLabel!: Phaser.GameObjects.Text;
  private soundBtn!: Phaser.GameObjects.Image;
  private fx!: Fx;
  private crowd!: Crowd;
  private commentator!: Commentator;
  layout!: StageLayout;

  private mode: Mode = 'match';
  private ids: Record<Side, FighterId> = { left: 'bernard', right: 'lola' };
  private progress: Progress = loadProgress();
  /** Teinte de la tenue de chaque perso (blanc = dessin d'origine). */
  private skin: Record<Side, number> = { left: 0xffffff, right: 0xffffff };
  private lastAward: Award | null = null;
  private level: AiLevel = 'normal';
  /** Qui joue chaque côté : le joueur (doigt) ou l'IA. */
  private control: Record<Side, Controller> = { left: 'human', right: 'human' };
  private aiProfile: Record<Side, AiProfile> = { left: AI_PROFILES.average, right: AI_PROFILES.average };
  private speed = 1;
  private rng: Rng = createRng(1);
  private match: Match | null = null;
  private attacker: Side = 'left';
  private phase: ScenePhase = 'intro';
  private gesture: SlapGesture | null = null;
  private pointerId = -1;
  private turnElapsed = 0;
  private lastTickSecond = -1;
  private turnsPlayed = 0;
  private slapCount = 0;
  private lastResult: (SlapResult & { kind: 'slap' | 'special'; dodge: DefenseQuality | 'rage' | null }) | { kind: 'selfslap' | 'limp'; damage: number } | null = null;
  private aiTimers: Phaser.Time.TimerEvent[] = [];
  private frozen = false;
  private slowToken = 0;
  private online: OnlineGame | null = null;
  private bot = false;
  /** En ligne : jauge de l'adversaire pendant qu'il arme. */
  private remoteGauge: Phaser.Tweens.Tween | null = null;
  private pendingPress = false;
  private overheatSeen = false;
  private homeBtn!: Phaser.GameObjects.Image;
  /** Geste de celui qui reçoit (un seul essai par gifle) et doigts qui le font. */
  private defGesture: DefenseGesture | null = null;
  private defPointers = new Set<number>();
  private defMove: DefenseMove | null = null;
  /**
   * Instant de l'esquive dans le trajet de la gifle (ms de jeu depuis son départ ; très négatif si
   * elle a été faite avant). On juge sur le temps du jeu, celui de l'animation que le joueur voit :
   * si le téléphone saccade, la fenêtre d'esquive suit l'image, pas l'horloge.
   */
  private defAt: number | null = null;
  private travelMs = 0;
  private lastFrameAt = 0;
  /** Heure du dernier lever de doigt de celui qui gifle (rythme de La Toupie). */
  private liftAt = 0;
  /** Combien de fois l'aide « esquive » a été montrée à chaque joueur. */
  private defHints: Record<Side, number> = { left: 0, right: 0 };
  /** La spéciale est déclenchée pour ce tour. */
  private specialOn = false;
  /** La Toupie : gifles déjà placées, en attendant la suivante. */
  private combo: {
    base: SlapAction;
    hits: { speed: number; angle: number }[];
    lastAt: number;
    feintMs: number;
    timer: Phaser.Time.TimerEvent | null;
    start: { id: number; t: number; x: number; y: number } | null;
  } | null = null;
  /** Gifle partie, pas encore arrivée. `action` est inconnue quand elle vient de l'adversaire en ligne. */
  private pending: { action: SlapAction | null; feintMs: number; source: 'local' | 'remote'; pre: Defense | null } | null = null;
  /** En ligne : esquive reçue de l'adversaire pour la gifle en cours. */
  private remoteDef: Defense | null = null;
  private awaitToken = 0;
  private downPos: { x: number; y: number } | null = null;
  private lift: { dx: number; dy: number } | null = null;
  /** Teinte imposée (esquive, droit de réponse) : l'aura de rage ne la remplace pas. */
  private tintLock: Record<Side, boolean> = { left: false, right: false };

  constructor() {
    super('Fight');
  }

  init(data: FightData) {
    this.mode = data.mode ?? 'match';
    this.level = data.level ?? 'normal';
    // Solo : le joueur à gauche, l'IA à droite. Démo : deux IA « joueur moyen ».
    this.control =
      this.mode === 'solo'
        ? { left: 'human', right: 'ai' }
        : this.mode === 'autoplay'
          ? { left: 'ai', right: 'ai' }
          : { left: 'human', right: 'human' };
    this.aiProfile = {
      left: AI_PROFILES.average,
      right: this.mode === 'solo' ? LEVEL_PROFILE[this.level] : AI_PROFILES.average,
    };
    this.speed = data.speed && data.speed > 0 ? data.speed : 1;
    this.rng = createRng(data.seed ?? Math.floor(Math.random() * 1e9));
    this.online = data.online ?? null;
    this.bot = !!data.bot;
    this.remoteGauge = null;
    this.pendingPress = false;
    if (this.online) {
      // En ligne : l'hôte joue Bernard à gauche, l'invité Lola à droite ; l'autre côté est à distance.
      this.mode = 'online';
      const me = this.online.localSide;
      this.control = { left: 'remote', right: 'remote' };
      this.control[me] = this.bot ? 'ai' : 'human';
    }
    // En ligne, l'hôte est toujours Bernard ; ailleurs le joueur choisit son perso (à gauche).
    const mine: FighterId = this.online ? 'bernard' : (data.fighter ?? 'bernard');
    this.ids = { left: mine, right: mine === 'bernard' ? 'lola' : 'bernard' };
    this.progress = loadProgress();
    this.skin = { left: tintOf(this.progress.skin[this.ids.left]), right: tintOf(this.progress.skin[this.ids.right]) };
    this.lastAward = null;
    // En ligne, le match est toujours reconstruit depuis le journal (vide au début, rempli à la reprise).
    this.match = this.mode === 'training' ? null : this.online ? replayMatch(this.online.log) : new Match(this.ids.left, this.ids.right);
    this.attacker = 'left';
    this.phase = 'intro';
    this.gesture = null;
    this.turnElapsed = 0;
    this.lastTickSecond = -1;
    this.turnsPlayed = 0;
    this.slapCount = 0;
    this.lastResult = null;
    this.aiTimers = [];
    this.frozen = false;
    this.slowToken = 0;
    this.defGesture = null;
    this.defPointers = new Set();
    this.defMove = null;
    this.defAt = null;
    this.travelMs = 0;
    this.defHints = { left: 0, right: 0 };
    this.specialOn = false;
    this.combo = null;
    this.pending = null;
    this.remoteDef = null;
    this.tintLock = { left: false, right: false };
  }

  create() {
    this.setTimeScale(1);

    this.decor = this.add.image(0, 0, 'decor').setOrigin(0, 0).setTint(tintOf(this.progress.bar));
    this.crowdImgs = HABITUES.map((id) =>
      this.add.image(0, 0, `habitue_${id}`).setOrigin(0.5, 1).setTint(STAGE.crowdTint),
    );
    this.patron = this.add.image(0, 0, 'patron').setOrigin(0.5, 1).setTint(STAGE.patronTint);

    this.f = {
      left: this.makeFighter('left', this.ids.left),
      right: this.makeFighter('right', this.ids.right),
    };

    this.fx = new Fx(this);
    this.crowd = new Crowd(this, this.crowdImgs, this.patron);
    this.commentator = new Commentator(this);
    this.gauge = new ChargeGauge(this).setDepth(100);
    this.timer = new TimerDiamond(this).setDepth(100);
    this.hint = this.add
      .text(0, 0, '', {
        fontFamily: FONT_UI,
        fontStyle: '800',
        fontSize: '20px',
        color: CSS.ink,
        backgroundColor: CSS.cream,
        padding: { x: 14, y: 6 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(100)
      .setVisible(false);
    this.modeLabel = this.add
      .text(0, 0, this.modeText(), {
        fontFamily: FONT_TITLE,
        fontSize: '20px',
        color: CSS.cream,
        backgroundColor: CSS.red,
        padding: { x: 12, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setAngle(-3)
      .setDepth(101)
      .setVisible(this.mode !== 'match');
    this.timer.setVisible(this.mode !== 'training');

    this.soundBtn = this.add
      .image(0, 0, sfx.muted ? 'ico_sound_off' : 'ico_sound_on')
      .setDepth(110)
      .setInteractive({ useHandCursor: true });
    this.soundBtn.on('pointerup', () => {
      sfx.unlock();
      sfx.setMuted(!sfx.muted);
      this.soundBtn.setTexture(sfx.muted ? 'ico_sound_off' : 'ico_sound_on');
      if (!sfx.muted) sfx.startMusic();
    });

    this.homeBtn = this.add.image(0, 0, 'ico_home').setDepth(110).setInteractive({ useHandCursor: true });
    this.homeBtn.on('pointerup', () => this.goHome());

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
      this.slowToken++;
      showNetLost(false);
      if (this.online) {
        const noop = () => {};
        this.online.onPress = this.online.onCancel = this.online.onRestart = this.online.onStage = noop;
        this.online.onStatus = noop;
      }
    });

    if (this.online) {
      const o = this.online;
      o.onPress = () => this.remotePress(true);
      o.onCancel = () => this.remotePress(false);
      o.onStage = (s) => this.remoteStage(s);
      o.onStatus = () => this.netStatus();
      // Revanche lancée en face, ou état distant à adopter : on repart du journal.
      o.onRestart = () => this.scene.restart({ online: o, bot: this.bot, speed: this.speed });
      this.netStatus();
    }

    // Le son ne peut démarrer qu'après un geste de l'utilisateur.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      sfx.unlock();
      sfx.startMusic();
    });
    if (this.mode !== 'autoplay') {
      // Deux joueurs sur le même écran : celui qui gifle et celui qui esquive ont chacun leur doigt.
      this.input.addPointer(2);
      this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    }

    if (window.__slap) {
      window.__slap.ready = true;
      window.__slap.scene = 'Fight';
    }

    if (this.online) {
      if (this.online.log.length > 0) this.resume();
      else this.startRound(true);
    } else if (this.match) this.startRound();
    else this.beginTurn('left');
  }

  /** Retour à l'écran d'accueil (en ligne : on quitte le salon). */
  private goHome() {
    this.online?.leave();
    this.scene.start('Title', { speed: this.speed });
  }

  // ── Jeu en ligne ───────────────────────────────────────────────────────

  /** Connexion perdue ou rétablie : bandeau et chrono en pause. */
  private netStatus() {
    showNetLost(!!this.online && !this.online.connected && this.phase !== 'over');
    this.publish();
  }

  /** L'adversaire a posé le doigt (ou l'a levé sans gifler) : on l'anime de notre côté. */
  private remotePress(down: boolean) {
    const side = this.attacker;
    if (this.control[side] !== 'remote') return;
    // Appui reçu pendant notre bandeau : on le montrera dès que le tour commence.
    this.pendingPress = down && this.phase === 'banner';
    // L'adversaire rejoue son tour (il a rechargé sa page pendant sa gifle) : on repart de zéro.
    if (down && (this.phase === 'await' || this.phase === 'travel') && this.pending?.source === 'remote') this.abortPending();
    if (down && this.phase === 'ready') {
      const g = this.gaugeSetup(side);
      this.showCharging(side);
      const tw = { t: 0 };
      this.remoteGauge = this.tweens.add({
        targets: tw,
        t: g.time / g.factor,
        duration: g.time / g.factor,
        onUpdate: () => this.gauge.setValue(chargeAt(tw.t, g.time, g.factor)),
      });
    } else if (!down && (this.phase === 'charging' || this.phase === 'armed')) {
      this.stopRemoteGauge();
      this.gauge.show(false);
      this.f[side].sprite.x = this.f[side].homeX;
      this.setPose(side, 'idle');
      this.setPhase('ready');
    }
  }

  /** Une gifle de l'adversaire était en route mais n'aboutira pas : retour à l'attente. */
  private abortPending() {
    this.pending = null;
    this.awaitToken++;
    const att = this.f[this.attacker];
    this.tweens.killTweensOf(att.sprite);
    att.sprite.x = att.homeX;
    this.setPose(this.attacker, 'idle');
    this.setPhase('ready');
  }

  /** Étapes du tour de l'adversaire (ou son esquive pendant le nôtre). */
  private remoteStage(s: Stage) {
    const side = this.attacker;
    if (s.k === 'defense') {
      if (this.control[side] === 'remote') return;
      this.remoteDef = { defense: s.defense, rageGuard: s.rageGuard };
      if (this.phase === 'await' && this.pending?.source === 'local') this.finalize(this.remoteDef);
      return;
    }
    if (this.control[side] !== 'remote') return;
    const p = this.phase;
    if (s.k === 'special') {
      if (p === 'ready' || p === 'charging') this.activateSpecial(side);
    } else if (s.k === 'armed') {
      if (p === 'charging') {
        this.stopRemoteGauge();
        this.showArmed(side);
      }
    } else if (s.k === 'spin') {
      if (p === 'charging' || p === 'armed' || p === 'combo') this.showSpin(side, s.count);
    } else if (p === 'ready' || p === 'charging' || p === 'armed' || p === 'combo') {
      this.stopRemoteGauge();
      this.launch(null, s.feintMs, 'remote');
    }
  }

  /**
   * Joue l'action reçue de l'adversaire. Si sa gifle est déjà arrivée à l'écran (on a vu son
   * départ), il ne reste que l'impact. Sinon (action arrivée pendant notre bandeau, reprise…),
   * on montre un armement express puis la gifle complète.
   */
  private playRemote(action: TurnAction) {
    const side = this.attacker;
    this.stopRemoteGauge();
    if (this.pending?.source === 'remote' && this.phase === 'await' && action.type === 'slap') {
      this.pending = null;
      return this.act(action, { fromRemote: true, arrived: true });
    }
    const seenCharging = this.phase === 'charging' || this.phase === 'armed' || this.phase === 'combo';
    this.pending = null;
    this.tweens.killTweensOf(this.f[side].sprite);
    this.setPhase('busy');
    this.f[side].sprite.x = this.f[side].homeX;
    const finish = () => {
      if (action.type === 'slap') this.gauge.setValue(action.charge);
      else if (action.type === 'selfslap') this.gauge.setValue(100, true);
      this.time.delayedCall(300, () => this.gauge.show(false));
      this.act(action, { fromRemote: true });
    };
    if (action.type === 'timeout') return this.act(action, { fromRemote: true });
    if (seenCharging) return finish();
    const target = action.type === 'slap' ? action.charge : 100;
    this.specialOn = action.type === 'slap' && !!action.special && !!this.match?.specialReady[side];
    this.gauge.setZone(this.gaugeSetup(side).zone);
    this.gauge.setValue(0);
    this.gauge.show(true);
    this.setPose(side, 'windup');
    const tw = { v: 0 };
    this.tweens.add({ targets: tw, v: target, duration: 280, ease: 'Quad.Out', onUpdate: () => this.gauge.setValue(tw.v), onComplete: finish });
  }

  private stopRemoteGauge() {
    this.remoteGauge?.remove();
    this.remoteGauge = null;
  }

  /** Reprise d'une partie en ligne (page rechargée ou état resynchronisé) : on repart du journal. */
  private resume() {
    const m = this.match!;
    for (const s of ['left', 'right'] as const) {
      this.f[s].hp = m.hp[s];
      this.f[s].bar.setValue(m.hp[s] / MATCH.hp, true);
      this.f[s].bar.setRage(m.rage[s] / ADVANCED.rageMax);
      this.f[s].pips.setWon(m.wins[s]);
      this.setPose(s, 'idle');
      if (m.stunned[s]) this.addDizzy(s);
    }
    if (m.phase === 'matchOver') {
      this.showResult(m.winner!, false);
      return;
    }
    this.setPhase('intro');
    const d = announceImage(this, 'ann_resume', 500);
    this.time.delayedCall(d - 150, () => this.beginTurn(m.turn));
  }

  private modeText() {
    if (this.mode === 'training') return 'ENTRAÎNEMENT';
    if (this.mode === 'solo') return `SOLO · ${LEVEL_LABEL[this.level]}`;
    if (this.mode === 'online') return `EN LIGNE · TU ES ${FIGHTERS[this.online!.localSide === 'left' ? 'bernard' : 'lola'].short.toUpperCase()}`;
    return 'DÉMO IA';
  }

  // ── Construction et placement ──────────────────────────────────────────

  private makeFighter(side: Side, id: FighterId): Fighter {
    const a = assets.fighters[id];
    const flip = side === 'right';
    // Phaser retourne la texture dans son cadre sans bouger l'origine :
    // pour un perso en miroir, l'ancrage (entre les pieds) passe à 1 - originX.
    const sprite = this.add
      .image(0, 0, fighterKey(id, 'idle'))
      .setFlipX(flip)
      .setOrigin(flip ? 1 - a.originX : a.originX, a.originY)
      .setTint(this.skin[side])
      .setDepth(10);
    const bar = new HealthBar(this, side, FIGHTERS[id].name, FIGHTERS[id].katakana).setDepth(100);
    const pips = new RoundPips(this, side, MATCH.roundsToWin).setDepth(100).setVisible(this.mode !== 'training');
    return { side, id, sprite, bar, pips, hp: MATCH.hp, pose: 'idle', homeX: 0, prints: [], dizzy: null, readyTag: null };
  }

  private applyLayout() {
    const { width, height } = this.scale;
    const L = computeLayout(width, height, this.f.left.id, this.f.right.id);
    this.layout = L;
    this.cameras.main.setSize(width, height);

    this.decor.setPosition(L.decor.x, L.decor.y).setScale(L.decor.scale);
    this.patron.setPosition(L.patron.x, L.patron.y).setScale(L.patron.scale);
    L.crowd.forEach((c, i) => this.crowdImgs[i].setPosition(c.x, c.y).setScale(c.scale));
    this.crowd.layout();
    for (const side of ['left', 'right'] as const) {
      const p = L[side];
      const fighter = this.f[side];
      fighter.homeX = p.x;
      fighter.sprite.setPosition(p.x, p.y).setScale(p.scale);
      this.placePrints(side);
    }

    // Interface : barres en haut, chrono au centre, losanges des rounds sous les barres.
    const margin = 22;
    const centerGap = 64;
    const barW = width / 2 - margin - centerGap;
    this.f.left.bar.layout(margin, 16, barW);
    this.f.right.bar.layout(width - margin, 16, barW);
    this.f.left.bar.setValue(this.f.left.hp / MATCH.hp, true);
    this.f.right.bar.setValue(this.f.right.hp / MATCH.hp, true);
    this.f.left.pips.setPosition(width / 2 - centerGap - 20, 66);
    this.f.right.pips.setPosition(width / 2 + centerGap + 20, 66);
    this.timer.setPosition(width / 2, 48);
    this.gauge.layout(margin + 6, height * 0.3, height * 0.52);
    this.hint.setPosition(width / 2, height - 58);
    this.modeLabel.setPosition(width / 2, this.mode === 'training' ? 14 : 96);
    this.soundBtn.setPosition(width - 44, 120);
    this.homeBtn.setPosition(44, 120);
    this.fx.layout(width, height);
    this.commentator.layout(width, height);

    if (window.__slap) window.__slap.layout = L;
  }

  // ── État visible par les tests ─────────────────────────────────────────

  private publish() {
    if (!window.__slap) return;
    const m = this.match;
    window.__slap.state = {
      mode: this.mode,
      ids: { ...this.ids },
      award: this.lastAward,
      progress: { xp: this.progress.xp, matches: this.progress.matches, wins: this.progress.wins },
      level: this.mode === 'solo' ? this.level : null,
      control: { ...this.control },
      phase: this.phase === 'ready' || this.phase === 'charging' ? this.phase : this.phase === 'over' ? 'over' : 'busy',
      scenePhase: this.phase,
      attacker: this.attacker,
      hp: { left: this.f.left.hp, right: this.f.right.hp },
      pose: { left: this.f.left.pose, right: this.f.right.pose },
      slaps: this.slapCount,
      // Nombre de tours joués dans le match (survit à une reprise en ligne).
      turns: m ? m.totalTurns : this.turnsPlayed,
      last: this.lastResult,
      charge: this.gesture ? this.gesture.charge(performance.now()) : 0,
      round: m?.round ?? 0,
      wins: m ? { ...m.wins } : { left: 0, right: 0 },
      winner: m?.winner ?? null,
      timeLeft: Math.max(0, MATCH.turnTimeMs - this.turnElapsed),
      rage: m ? { ...m.rage } : { left: 0, right: 0 },
      specialReady: m ? { ...m.specialReady } : { left: false, right: false },
      stunned: m ? { ...m.stunned } : { left: false, right: false },
      dizzy: { left: !!this.f.left.dizzy, right: !!this.f.right.dizzy },
      special: this.specialOn,
      combo: this.combo?.hits.length ?? 0,
      defMove: this.defMove ? this.defMove.kind : null,
      travelMs: this.phase === 'travel' ? this.travelMs : null,
      lastWord: m?.lastWord ?? null,
      opener: m?.opener ?? null,
      hint: this.hint?.visible ? this.hint.text : '',
    };
    (window.__slap as Record<string, unknown>).fx = {
      ...this.fx.stats,
      ...this.crowd.stats,
      ...this.commentator.stats,
      handprints: { left: this.f.left.prints.length, right: this.f.right.prints.length },
      sounds: sfx.played.slice(-30),
      frozen: this.frozen,
      timeScale: this.tweens.timeScale / this.speed,
    };
  }

  setPose(side: Side, pose: Pose) {
    const fighter = this.f[side];
    fighter.pose = pose;
    fighter.sprite.setTexture(fighterKey(fighter.id, pose));
    // Les traces de main sont calées sur la joue de la pose idle.
    for (const p of fighter.prints) p.img.setVisible(pose === 'idle');
    this.publish();
  }

  private setPhase(phase: ScenePhase) {
    this.phase = phase;
    this.publish();
  }

  // ── Temps : arrêt sur image et ralenti ─────────────────────────────────

  private setTimeScale(factor: number) {
    this.time.timeScale = this.speed * factor;
    this.tweens.timeScale = this.speed * factor;
  }

  /** Arrêt sur image : tout se fige `ms` millisecondes (temps réel), puis `then`. */
  private freeze(ms: number, then: () => void) {
    this.frozen = true;
    this.tweens.pauseAll();
    this.time.paused = true;
    this.publish();
    window.setTimeout(() => {
      if (!this.sys.isActive()) return;
      this.frozen = false;
      this.time.paused = false;
      this.tweens.resumeAll();
      then();
    }, ms / this.speed);
  }

  /** Ralenti : tout tourne à `factor` pendant `realMs` millisecondes réelles. */
  private slowmo(factor: number, realMs: number) {
    const token = ++this.slowToken;
    this.setTimeScale(factor);
    this.publish();
    window.setTimeout(() => {
      if (token !== this.slowToken || !this.sys.isActive()) return;
      this.setTimeScale(1);
      this.publish();
    }, realMs / this.speed);
  }

  // ── Rounds et tours ────────────────────────────────────────────────────

  /** `prestarted` : le round est déjà lancé dans le match (en ligne, il est reconstruit du journal). */
  private startRound(prestarted = false) {
    const m = this.match!;
    if (!prestarted && m.startRound().length === 0) return;
    const start = { round: m.round, first: m.turn };
    this.setPhase('intro');
    for (const s of ['left', 'right'] as const) {
      this.f[s].hp = m.hp[s];
      this.f[s].bar.setValue(1, true);
      this.f[s].sprite.x = this.f[s].homeX;
      this.clearPrints(s);
      this.clearDizzy(s);
      this.setTint(s, null);
      this.f[s].bar.setRage(m.rage[s] / ADVANCED.rageMax);
      this.setPose(s, 'idle');
    }
    const final = start.round === MATCH.maxRounds || (m.wins.left === MATCH.roundsToWin - 1 && m.wins.right === MATCH.roundsToWin - 1);
    // Le patron siffle, puis annonce le round.
    this.crowd.whistle();
    sfx.whistle();
    if (start.round === 1) this.say('roundStart');
    this.time.delayedCall(350, () => {
      const d1 = announceImage(this, final ? 'ann_round_final' : `ann_round_${start.round}`, 650);
      this.time.delayedCall(d1, () => {
        const d2 = announceImage(this, 'ann_fight', 450);
        this.crowd.cheer(0.5);
        sfx.crowd(0.5, 0.8);
        this.time.delayedCall(d2 - 150, () => this.beginTurn(start.first));
      });
    });
  }

  private beginTurn(side: Side) {
    this.attacker = side;
    this.turnElapsed = 0;
    this.lastTickSecond = -1;
    this.gesture = null;
    this.specialOn = false;
    this.combo = null;
    this.pending = null;
    this.remoteDef = null;
    this.defGesture = null;
    this.defMove = null;
    this.defAt = null;
    this.defPointers.clear();
    this.timer.set(null);
    if (this.mode === 'training') {
      this.setPhase('ready');
      this.showHint();
      return;
    }
    this.setPhase('banner');
    const d = bannerImage(this, `ban_turn_${this.f[side].id}`, side, 520);
    if (this.match?.specialReady[side]) this.showReady(side, true);
    this.time.delayedCall(d - 120, () => {
      if (this.phase !== 'banner') return;
      this.turnElapsed = 0;
      // Celui qui reçoit peut esquiver dès maintenant : un seul essai par gifle.
      const def = other(side);
      if (this.match && this.control[def] === 'human') this.defGesture = new DefenseGesture(def === 'left' ? -1 : 1);
      this.setPhase('ready');
      this.showHint(true);
      if (this.control[side] === 'ai') this.aiTurn(side);
      if (this.control[side] === 'remote' && this.pendingPress) this.remotePress(true);
      this.pendingPress = false;
    });
  }

  /** Aide en bas de l'écran. `fresh` : début du tour (compte les fois où l'aide « esquive » est montrée). */
  private showHint(fresh = false) {
    const att = this.attacker;
    const def = other(att);
    const m = this.match;
    const lines: string[] = [];
    const two = this.control[att] === 'human' && this.control[def] === 'human' && !!m;
    const who = (s: Side) => (two ? `${FIGHTERS[this.f[s].id].short.toUpperCase()} : ` : '');
    if (this.control[att] === 'human') {
      const sp = FIGHTERS[this.f[att].id].special;
      const name = sp.name.toUpperCase();
      if (this.specialOn) {
        lines.push(sp.hits > 1 ? `${name} : GIFLE, puis RE-GLISSE ${sp.hits - 1} fois en rythme !` : `${name} : jauge lente, zone dorée étroite… vise bien !`);
      } else {
        const limit = this.mode === 'solo' ? 3 : 2;
        if (this.mode === 'training' || this.turnsPlayed < limit) {
          const arrow = att === 'left' ? '→' : '←';
          lines.push(`${who(att)}MAINTIENS pour armer  ·  GLISSE vers ${FIGHTERS[this.f[def].id].short.toUpperCase()} ${arrow}`);
        }
        if (m?.specialReady[att]) lines.push(`${who(att)}RAGE PLEINE ! GLISSE VERS LE HAUT ↑ pour ${name}`);
      }
    }
    if (m && this.control[def] === 'human') {
      const back = def === 'left' ? '←' : '→';
      if (fresh) this.defHints[def]++;
      if (this.defHints[def] <= 3) lines.push(`${who(def)}ESQUIVE : glisse vers l'arrière ${back} juste avant l'impact`);
      if (m.specialReady[def]) lines.push(`${who(def)}RAGE PLEINE : glisse vers le bas ↓ = garde parfaite`);
    }
    if (lines.length === 0) {
      this.hint.setVisible(false);
      this.publish();
      return;
    }
    this.hint.setFontSize(lines.length > 2 ? 17 : 20).setText(lines.join('\n')).setVisible(true);
    this.publish();
  }

  update(time: number, delta: number) {
    if (!this.frozen) this.crowd.update(time);
    // Avancée de la gifle en route, au rythme des animations.
    if (this.phase === 'travel') this.travelMs += delta * this.tweens.timeScale;
    this.lastFrameAt = performance.now();
    const p = this.phase;
    if (this.online && this.match && this.control[this.attacker] === 'remote' && (p === 'ready' || p === 'charging' || p === 'armed' || p === 'combo' || p === 'await')) {
      // L'adversaire a joué : son action est arrivée par le réseau.
      const action = this.online.takeRemote(this.match.totalTurns);
      if (action) {
        this.playRemote(action);
        return;
      }
    }
    // En ligne, le chrono s'arrête pendant une coupure de connexion.
    const netPaused = !!this.online && !this.online.connected;
    if (this.match && !netPaused && (this.phase === 'ready' || this.phase === 'charging')) {
      this.turnElapsed += delta * this.speed;
      const left = MATCH.turnTimeMs - this.turnElapsed;
      this.timer.set(Math.max(0, left) / 1000, Math.max(0, left) / MATCH.turnTimeMs);
      const sec = Math.ceil(Math.max(0, left) / 1000);
      if (sec !== this.lastTickSecond && sec <= 2 && sec > 0) sfx.tick(sec <= 1);
      this.lastTickSecond = sec;
      // Chrono écoulé : gifle molle automatique (sauf swipe déjà lancé, qu'on laisse finir).
      // (En ligne, c'est le téléphone de celui qui joue qui décide du dépassement.)
      if (left <= 0 && this.gesture?.phase !== 'swiping' && this.control[this.attacker] !== 'remote') {
        this.timeout();
        return;
      }
    }
    if (this.phase === 'charging' && this.gesture) {
      const t = performance.now();
      // Surchauffe : constatée sur une image, appliquée à la suivante seulement. Si le téléphone
      // saccade, les mouvements du doigt déjà faits (datés à leur vrai moment) passent d'abord :
      // un swipe fait à temps n'est jamais transformé en surchauffe par une image en retard.
      if (this.gesture.overheatedAt(t)) {
        if (this.overheatSeen) {
          this.overheatSeen = false;
          return this.resolve(this.gesture.update(t));
        }
        this.overheatSeen = true;
      } else this.overheatSeen = false;
      const c = this.gesture.charge(t);
      this.gauge.setValue(c, false);
      if (window.__slap?.state) window.__slap.state.charge = c;
      // Le perso tremble quand la jauge est pleine (surchauffe imminente).
      const att = this.f[this.attacker];
      att.sprite.x = att.homeX + (c >= 100 ? Phaser.Math.Between(-3, 3) : 0);
    }
    // Gifle retenue (feinte) : elle part toute seule au bout d'un moment.
    if (this.phase === 'armed' && this.gesture) {
      this.liftAt = performance.now();
      this.resolve(this.gesture.update(this.liftAt));
    }
  }

  private timeout() {
    this.cancelAi();
    this.gesture = null;
    this.gauge.show(false);
    this.f[this.attacker].sprite.x = this.f[this.attacker].homeX;
    this.act({ type: 'timeout' });
  }

  // ── Entrées tactiles ───────────────────────────────────────────────────

  /** Position en px CSS (les seuils de vitesse et de distance sont en px écran). */
  private css(p: Phaser.Input.Pointer) {
    const ds = this.scale.displayScale;
    return { x: p.x / ds.x, y: p.y / ds.y };
  }

  private now(p?: Phaser.Input.Pointer) {
    const ts = (p?.event as Event | undefined)?.timeStamp;
    return typeof ts === 'number' && ts > 0 ? ts : performance.now();
  }

  /**
   * À qui est ce doigt ? À deux sur le même écran, chacun joue sur sa moitié ;
   * sinon l'unique joueur gifle à son tour et esquive au tour de l'autre.
   */
  private roleOf(p: Phaser.Input.Pointer): 'attack' | 'defend' | null {
    const att = this.attacker;
    const a = this.control[att] === 'human';
    const d = this.control[other(att)] === 'human' && !!this.match;
    if (a && d) return (p.x < this.scale.width / 2 ? 'left' : 'right') === att ? 'attack' : 'defend';
    return a ? 'attack' : d ? 'defend' : null;
  }

  private onDown(p: Phaser.Input.Pointer) {
    if (this.soundBtn.getBounds().contains(p.x, p.y) || this.homeBtn.getBounds().contains(p.x, p.y)) return;
    const role = this.roleOf(p);
    const { x, y } = this.css(p);
    const t = this.now(p);
    const ph = this.phase;
    if (role === 'defend') {
      if (this.defGesture && (ph === 'ready' || ph === 'charging' || ph === 'armed' || ph === 'combo' || ph === 'travel')) {
        this.defGesture.down(p.id, t, x, y);
        this.defPointers.add(p.id);
      }
      return;
    }
    if (role !== 'attack') return;
    if (ph === 'combo' && this.combo) {
      this.combo.start = { id: p.id, t, x, y };
      return;
    }
    if (ph !== 'ready') return;
    this.online?.sendPress();
    const att = this.f[this.attacker];
    const g = this.gaugeSetup(this.attacker);
    this.gesture = new SlapGesture(att.id, this.attacker === 'left' ? 1 : -1, scaleSpeed(this.chargeSpeed(this.attacker), g.factor));
    this.overheatSeen = false;
    this.gesture.down(t, x, y);
    this.pointerId = p.id;
    this.downPos = { x, y };
    this.lift = null;
    this.showCharging(this.attacker);
  }

  private onMove(p: Phaser.Input.Pointer) {
    const { x, y } = this.css(p);
    const t = this.now(p);
    if (this.defPointers.has(p.id)) return this.defenseTrack(this.defGesture?.track(p.id, t, x, y) ?? null);
    if (this.phase === 'combo') return this.comboMove(p.id, t, x, y);
    if ((this.phase !== 'charging' && this.phase !== 'armed') || !this.gesture || p.id !== this.pointerId || !p.isDown) return;
    const out = this.gesture.move(t, x, y);
    if (out) return this.resolve(out);
    // Le swipe est fait, le doigt reste posé : la gifle est retenue (feinte).
    if (this.gesture.armed && this.phase === 'charging') {
      this.online?.sendStage({ k: 'armed' });
      this.showArmed(this.attacker);
    }
  }

  private onUp(p: Phaser.Input.Pointer) {
    const { x, y } = this.css(p);
    const t = this.now(p);
    if (this.defPointers.has(p.id)) {
      this.defenseTrack(this.defGesture?.up(p.id, t, x, y) ?? null);
      this.defPointers.delete(p.id);
      return;
    }
    if (this.phase === 'combo') {
      this.comboMove(p.id, t, x, y);
      if (this.combo?.start?.id === p.id) this.combo.start = null;
      return;
    }
    if ((this.phase !== 'charging' && this.phase !== 'armed') || !this.gesture || p.id !== this.pointerId) return;
    this.lift = this.downPos ? { dx: x - this.downPos.x, dy: y - this.downPos.y } : null;
    this.liftAt = t;
    this.resolve(this.gesture.up(t, x, y));
  }

  private resolve(out: GestureOutcome | null) {
    if (!out) return;
    const side = this.attacker;
    const att = this.f[side];
    att.sprite.x = att.homeX;
    if (out.type === 'cancel') {
      this.online?.sendCancel();
      this.gesture = null;
      this.gauge.show(false);
      this.setPose(side, 'idle');
      this.setPhase('ready');
      // Swipe vers le haut avec la rage pleine : la spéciale est déclenchée.
      const l = this.lift;
      this.lift = null;
      if (out.reason !== 'no-swipe' && l && l.dy <= -50 && Math.abs(l.dy) > Math.abs(l.dx) && this.match?.specialReady[side] && !this.specialOn) {
        this.online?.sendStage({ k: 'special' });
        this.activateSpecial(side);
        return;
      }
      this.showHint();
      if (out.reason !== 'no-swipe') announceImage(this, `ann_harder_${this.f[other(side)].id}`, 500, 0.5);
      return;
    }
    this.gesture = null;
    if (out.type === 'selfslap') {
      this.gauge.setValue(100, true);
      this.time.delayedCall(250, () => this.gauge.show(false));
      this.act({ type: 'selfslap' });
      return;
    }
    this.gauge.setValue(out.charge);
    const base: SlapAction = { type: 'slap', charge: out.charge, speed: out.speed, angle: out.angle };
    if (this.specialOn && this.match?.specialReady[side]) {
      base.special = { hits: [{ speed: out.speed, angle: out.angle }] };
      // La Toupie : les gifles suivantes se placent en rythme avant que tout parte.
      if (FIGHTERS[att.id].special.hits > 1) return this.startCombo(base, out.heldMs);
    }
    this.launch(base, out.heldMs, 'local');
  }

  // ── Spéciales, feinte, esquive ─────────────────────────────────────────

  /** Jauge du tour : celle de la spéciale (plus lente, zone plus étroite) si elle est déclenchée. */
  private gaugeSetup(side: Side) {
    const f = FIGHTERS[this.f[side].id];
    const sp = this.specialOn ? f.special : null;
    return { zone: sp?.goldenZone ?? f.goldenZone, factor: sp?.chargeSpeed ?? 1, time: f.chargeTimeMs };
  }

  private showCharging(side: Side) {
    this.gauge.setZone(this.gaugeSetup(side).zone);
    this.gauge.setValue(0);
    this.gauge.show(true);
    this.hint.setVisible(false);
    this.setPose(side, 'windup');
    this.setPhase('charging');
  }

  /** La gifle est prête et retenue : le perso se penche en arrière, le chrono s'arrête. */
  private showArmed(side: Side) {
    const f = this.f[side];
    const dir = side === 'left' ? 1 : -1;
    this.tweens.add({ targets: f.sprite, x: f.homeX - dir * 14, duration: 70, ease: 'Quad.Out' });
    this.setPhase('armed');
  }

  /** La spéciale est déclenchée (swipe vers le haut, rage pleine) : annonce, puis le tour repart. */
  private activateSpecial(side: Side) {
    this.specialOn = true;
    sfx.powerUp();
    this.fx.screenFlash(0.35, COLORS.pink);
    this.cameras.main.shake(200, 0.004);
    announceImage(this, `ann_special_${this.f[side].id}`, 420, 0.3);
    this.turnElapsed = 0;
    this.showHint();
  }

  /** La Toupie : première gifle placée, on attend les suivantes (en rythme). */
  private startCombo(base: SlapAction, feintMs: number) {
    this.combo = { base, hits: base.special!.hits, lastAt: this.liftAt, feintMs, timer: null, start: null };
    this.setPhase('combo');
    this.comboArm();
  }

  private comboArm() {
    const c = this.combo!;
    c.timer?.remove(false);
    c.timer = this.time.delayedCall(COMBO.maxGapMs, () => this.endCombo());
  }

  /** Un nouveau swipe vers l'adversaire pendant La Toupie. */
  private comboMove(id: number, t: number, x: number, y: number) {
    const c = this.combo;
    if (!c?.start || c.start.id !== id) return;
    const dir = this.attacker === 'left' ? 1 : -1;
    const dx = (x - c.start.x) * dir;
    const dy = y - c.start.y;
    if (dx < SLAP.minSwipePx) return;
    const dur = Math.max(1, t - c.start.t);
    c.start = null;
    // Trop vite : le rythme est cassé, la Toupie part avec ce qu'elle a.
    if ((t - c.lastAt) * this.speed < COMBO.minGapMs) return this.endCombo();
    c.hits.push({ speed: Math.hypot(dx, dy) / dur, angle: swipeAngle(dx, dy) });
    c.lastAt = t;
    this.online?.sendStage({ k: 'spin', count: c.hits.length });
    this.showSpin(this.attacker, c.hits.length);
    if (c.hits.length >= FIGHTERS[this.f[this.attacker].id].special.hits) this.endCombo();
    else this.comboArm();
  }

  private endCombo() {
    const c = this.combo;
    if (!c) return;
    c.timer?.remove(false);
    this.combo = null;
    this.launch(c.base, c.feintMs, 'local');
  }

  /** La Toupie : le perso fait un tour sur lui-même, le compteur monte. */
  private showSpin(side: Side, count: number) {
    const f = this.f[side];
    const s = this.layout[side].scale;
    sfx.whoosh();
    this.tweens.add({ targets: f.sprite, scaleX: s * 0.15, duration: 70, yoyo: true, ease: 'Sine.InOut', onComplete: () => f.sprite.setScale(this.layout[side].scale) });
    if (count >= 2 && count <= 3) {
      const img = this.add.image(f.homeX, this.layout[side].top + 40, `lbl_x${count}`).setDepth(75).setAngle(-8).setScale(0.3);
      this.tweens.add({ targets: img, scale: 1, duration: 140, ease: 'Back.Out' });
      this.tweens.add({ targets: img, alpha: 0, y: img.y - 40, delay: 420, duration: 200, onComplete: () => img.destroy() });
    }
    this.publish();
  }

  /** Teinte imposée à un perso (null : on la retire). */
  private setTint(side: Side, color: number | null) {
    const f = this.f[side];
    this.tintLock[side] = color !== null;
    if (color !== null) f.sprite.setTint(color);
    else if (!f.readyTag) f.sprite.setTint(this.skin[side]);
  }

  /** Recul d'esquive (en attendant une vraie pose) : le perso part en arrière puis revient. */
  private lean(side: Side) {
    const f = this.f[side];
    const back = side === 'left' ? -1 : 1;
    this.tweens.killTweensOf(f.sprite);
    this.tweens.add({ targets: f.sprite, x: f.homeX + back * 34, duration: 80, ease: 'Quad.Out', yoyo: true, hold: 260 });
  }

  /** Le joueur qui reçoit a fait son geste : esquive (arrière) ou garde de rage (bas). */
  private defenseTrack(m: DefenseMove | null) {
    if (!m) return;
    this.defMove = m;
    // Où en est la gifle ? (dernière image, plus le temps écoulé depuis, borné à une image.)
    this.defAt = this.phase === 'travel' ? this.travelMs + Math.min(20, Math.max(0, performance.now() - this.lastFrameAt)) * this.tweens.timeScale : -1e9;
    const def = other(this.attacker);
    if (m.kind === 'dodge') {
      this.lean(def);
      sfx.whoosh();
    } else if (this.match?.specialReady[def]) {
      this.fx.screenFlash(0.2, COLORS.pink);
      sfx.powerUp();
    }
    this.publish();
  }

  /** Défense de celui qui reçoit, jugée à l'instant de l'impact. */
  private localDefense(feintMs: number): Defense {
    const def = other(this.attacker);
    const m = this.match;
    if (!m) return {};
    if (this.control[def] === 'ai') return aiDefend(this.rng, this.aiProfile[def], feintMs, m.specialReady[def]);
    const mv = this.defMove;
    if (!mv) return {};
    if (mv.kind === 'guard') return m.specialReady[def] ? { rageGuard: true } : {};
    const q = judgeDefense(this.defAt, DEFENSE.travelMs);
    return q ? { defense: q } : {};
  }

  /**
   * La gifle part : le perso s'élance, et celui qui reçoit a `DEFENSE.travelMs` pour esquiver.
   * `action` est inconnue quand la gifle vient de l'adversaire en ligne (elle arrivera validée).
   */
  private launch(action: SlapAction | null, feintMs: number, source: 'local' | 'remote') {
    const attSide = this.attacker;
    const defSide = other(attSide);
    const att = this.f[attSide];
    if (source === 'local') this.online?.sendStage({ k: 'attack', feintMs });
    this.cancelAi();
    this.gesture = null;
    this.hint.setVisible(false);
    this.timer.set(null);
    this.time.delayedCall(250, () => this.gauge.show(false));
    // L'IA décide de son esquive au départ de la gifle (on la voit reculer juste avant l'impact).
    const pre = this.control[defSide] === 'ai' ? this.localDefense(feintMs) : null;
    this.pending = { action, feintMs, source, pre };
    this.travelMs = 0;
    this.setPhase('travel');
    const k = computeStrike(this.layout, attSide, att.id, this.f[defSide].id);
    att.sprite.setDepth(11);
    this.f[defSide].sprite.setDepth(10);
    this.setPose(attSide, 'swing');
    sfx.whoosh();
    const T = DEFENSE.travelMs;
    this.time.delayedCall(T - 70, () => {
      if (this.phase === 'travel') this.setPose(attSide, 'slap');
    });
    if (pre && (pre.defense || pre.rageGuard)) this.time.delayedCall(T - (pre.defense === 'good' ? 140 : 60), () => this.lean(defSide));
    this.tweens.killTweensOf(att.sprite);
    this.tweens.add({ targets: att.sprite, x: att.homeX + k.dir * k.step, duration: T, ease: 'Quad.In', onComplete: () => this.arrive() });
  }

  /** La main arrive sur la joue : on juge l'esquive, puis le tour se résout. */
  private arrive() {
    const p = this.pending;
    if (!p || this.phase !== 'travel') return;
    const d = p.pre ?? this.localDefense(p.feintMs);
    if (p.source === 'remote') {
      // En ligne, gifle de l'adversaire : on lui envoie notre esquive, il valide l'action.
      this.online?.sendStage({ k: 'defense', ...d });
      this.setPhase('await');
      return;
    }
    if (this.online && this.control[other(this.attacker)] === 'remote') {
      // En ligne, notre gifle : l'esquive se juge sur le téléphone d'en face.
      if (this.remoteDef) return this.finalize(this.remoteDef);
      if (!this.online.connected) return this.finalize({});
      this.setPhase('await');
      const token = ++this.awaitToken;
      window.setTimeout(() => {
        if (token === this.awaitToken && this.sys.isActive() && this.phase === 'await' && this.pending === p) this.finalize({});
      }, DEFENSE_WAIT_MS / this.speed);
      return;
    }
    this.finalize(d);
  }

  private finalize(d: Defense) {
    const p = this.pending;
    if (!p?.action) return;
    this.pending = null;
    this.awaitToken++;
    const action: SlapAction = { ...p.action };
    if (d.defense) action.defense = d.defense;
    if (d.rageGuard) action.rageGuard = true;
    this.act(action, { arrived: true });
  }

  // ── IA (mode solo et démo) ─────────────────────────────────────────────

  private aiTurn(side: Side) {
    const id = this.f[side].id;
    const useSpecial = !!this.match?.specialReady[side];
    const speed = this.chargeSpeed(side);
    const d = aiDecide(this.rng, id, this.aiProfile[side], speed, useSpecial);
    if (d.action.type === 'timeout') return; // l'IA hésite : le chrono tranchera
    const target = d.action.type === 'slap' ? d.action.charge : 100;
    const action = d.action;
    this.aiTimers.push(
      this.time.delayedCall(d.startDelayMs, () => {
        if (this.phase !== 'ready') return;
        if (useSpecial) {
          this.online?.sendStage({ k: 'special' });
          this.activateSpecial(side);
        }
        this.online?.sendPress();
        const g = this.gaugeSetup(side);
        const speedNow = scaleSpeed(speed, g.factor);
        this.showCharging(side);
        const holdMs = d.holdMs;
        const tw = { t: 0 };
        // La jauge de l'IA suit la même courbe que celle d'un joueur (irrégulière si sonnée).
        this.tweens.add({
          targets: tw,
          t: holdMs,
          duration: holdMs,
          onUpdate: () => this.gauge.setValue(Math.min(target, chargeAt(tw.t, g.time, speedNow))),
        });
        this.aiTimers.push(
          this.time.delayedCall(holdMs + (action.type === 'slap' ? d.swipeMs : 0), () => {
            if (this.phase !== 'charging') return;
            this.gauge.setValue(target, action.type === 'selfslap');
            if (action.type !== 'slap') {
              this.time.delayedCall(300, () => this.gauge.show(false));
              return this.act(action);
            }
            // Swipe fait : la gifle est retenue un instant (feinte), La Toupie place ses gifles.
            this.online?.sendStage({ k: 'armed' });
            this.showArmed(side);
            const hits = action.special?.hits.length ?? 1;
            let wait = 0;
            for (let i = 2; i <= hits; i++) {
              wait += 330;
              this.aiTimers.push(
                this.time.delayedCall(wait, () => {
                  this.online?.sendStage({ k: 'spin', count: i });
                  this.showSpin(side, i);
                }),
              );
            }
            this.aiTimers.push(
              this.time.delayedCall(wait + d.feintMs, () => {
                if (this.phase === 'armed') this.launch(action, d.feintMs, 'local');
              }),
            );
          }),
        );
      }),
    );
  }

  private cancelAi() {
    for (const t of this.aiTimers) t.remove(false);
    this.aiTimers = [];
  }

  // ── Résolution d'un tour ───────────────────────────────────────────────

  private act(action: TurnAction, o: { fromRemote?: boolean; arrived?: boolean } = {}) {
    // En ligne : notre action part chez l'adversaire (et dans le journal).
    if (this.online && this.match && !o.fromRemote) this.online.sendAction(this.match.totalTurns, action);
    this.cancelAi();
    this.setPhase('busy');
    this.hint.setVisible(false);
    this.timer.set(null);
    this.turnsPlayed++;
    // Le perso a joué son tour : s'il était sonné, ses étoiles s'envolent.
    this.clearDizzy(this.attacker);
    const events = this.match ? this.match.play(action) : this.trainingPlay(action);
    const hit = events.find((e): e is HitEvent => e.type === 'hit');
    const self = events.find((e): e is Extract<MatchEvent, { type: 'selfhit' }> => e.type === 'selfhit');
    const after = () => {
      this.afterHitStatus(events);
      this.afterTurn(events);
    };
    if (hit?.kind === 'special') this.specialAnim(hit, after, !!o.arrived);
    else if (hit) this.slapAnim(hit, after, !!o.arrived);
    else if (self) this.selfSlapAnim(self, after);
    else after();
  }

  /** Vitesse de la jauge du perso : irrégulière s'il est sonné. */
  private chargeSpeed(side: Side): ChargeSpeed {
    return this.match?.stunned[side] ? stunCurve(this.rng) : 1;
  }

  /** Après un coup : jauges de rage, rage pleine, perso sonné. */
  private afterHitStatus(events: MatchEvent[]) {
    const m = this.match;
    if (!m) return;
    for (const s of ['left', 'right'] as const) {
      this.f[s].bar.setRage(m.rage[s] / ADVANCED.rageMax);
      if (!m.specialReady[s]) this.showReady(s, false);
    }
    if (events.some((e) => e.type === 'ko')) return;
    const rage = events.find((e): e is Extract<MatchEvent, { type: 'rageFull' }> => e.type === 'rageFull');
    const stun = events.find((e): e is Extract<MatchEvent, { type: 'stunned' }> => e.type === 'stunned');
    if (stun) {
      this.addDizzy(stun.side);
      sfx.dizzy();
    }
    if (rage) {
      sfx.powerUp();
      this.fx.screenFlash(0.25, COLORS.pink);
      this.time.delayedCall(stun ? 900 : 0, () => this.say('rage'));
    }
    if (stun) this.say('stun');
    this.publish();
  }

  /** Aura qui pulse et étiquette « LE BATTOIR PRÊT ! » au-dessus du perso. */
  private showReady(side: Side, on: boolean) {
    const f = this.f[side];
    if (!on) {
      if (f.readyTag) {
        f.readyTag.destroy();
        f.readyTag = null;
        this.tweens.killTweensOf(f.sprite);
        if (!this.tintLock[side]) f.sprite.setTint(this.skin[side]);
      }
      return;
    }
    if (f.readyTag) return;
    const top = this.layout[side].top;
    f.readyTag = this.add.image(f.homeX, top - 18, `lbl_ready_${f.id}`).setDepth(60).setAngle(-4);
    this.tweens.add({ targets: f.readyTag, y: top - 26, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const glow = { v: 0 };
    this.tweens.add({
      targets: glow,
      v: 1,
      duration: 260,
      yoyo: true,
      repeat: -1,
      onUpdate: () => {
        const k = glow.v;
        // Teinte rosée qui pulse (blanc → rose), sans masquer le dessin.
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(
          Phaser.Display.Color.ValueToColor(this.skin[side]),
          Phaser.Display.Color.ValueToColor(0xff9cc8),
          100,
          k * 100,
        );
        if (!this.tintLock[side]) f.sprite.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      },
    });
    this.publish();
  }

  /** Étoiles qui tournent au-dessus de la tête du perso sonné. */
  private addDizzy(side: Side) {
    const f = this.f[side];
    this.clearDizzy(side);
    const s = this.layout.fighterScale;
    const a = assets.fighters[f.id];
    const dir = side === 'left' ? 1 : -1;
    const x = f.homeX + dir * (a.face.x - 60) * s;
    const y = f.sprite.y - (a.face.y + 95) * s;
    const c = this.add.container(x, y).setDepth(58);
    const stars = [0, 1, 2].map((i) => this.add.image(0, 0, 'fx_dizzy').setData('a', (i / 3) * Math.PI * 2));
    c.add(stars);
    c.add(this.add.image(0, -46, 'lbl_stun').setAngle(-6).setScale(0.8));
    const spin = { a: 0 };
    this.tweens.add({
      targets: spin,
      a: Math.PI * 2,
      duration: 1100,
      repeat: -1,
      onUpdate: () => {
        for (const st of stars) {
          const ang = spin.a + (st.getData('a') as number);
          st.setPosition(Math.cos(ang) * 52, Math.sin(ang) * 14);
          st.setScale(0.8 + 0.3 * (Math.sin(ang) + 1) / 2).setDepth(Math.sin(ang));
        }
      },
    });
    c.setData('spin', spin);
    f.dizzy = c;
    this.publish();
  }

  private clearDizzy(side: Side) {
    const f = this.f[side];
    if (!f.dizzy) return;
    this.tweens.killTweensOf(f.dizzy.getData('spin'));
    const c = f.dizzy;
    f.dizzy = null;
    this.tweens.add({ targets: c, alpha: 0, y: c.y - 30, duration: 250, onComplete: () => c.destroy() });
  }

  /** Entraînement : même règles, mais c'est toujours Bernard qui gifle et la vie revient au K.O. */
  private trainingPlay(action: TurnAction): MatchEvent[] {
    const att: Side = 'left';
    const def: Side = 'right';
    const hp = { left: this.f.left.hp, right: this.f.right.hp };
    const events: MatchEvent[] = [];
    if (action.type === 'slap') {
      const result = computeSlap({ attacker: this.f[att].id, defender: this.f[def].id, ...action });
      hp[def] -= result.damage;
      events.push({ type: 'hit', attacker: att, defender: def, damage: result.damage, kind: 'slap', result });
    } else if (action.type === 'selfslap') {
      hp[att] -= SLAP.selfSlapDamage;
      events.push({ type: 'selfhit', side: att, damage: SLAP.selfSlapDamage });
    }
    const loser: Side | null = hp.left <= 0 ? 'left' : hp.right <= 0 ? 'right' : null;
    if (loser) events.push({ type: 'ko', loser });
    else events.push({ type: 'turn', side: att });
    return events;
  }

  private afterTurn(events: MatchEvent[]) {
    const ko = events.find((e): e is Extract<MatchEvent, { type: 'ko' }> => e.type === 'ko');
    const next = events.find((e): e is Extract<MatchEvent, { type: 'turn' }> => e.type === 'turn');
    const reply = events.find((e): e is Extract<MatchEvent, { type: 'lastWord' }> => e.type === 'lastWord');
    if (ko) this.knockout(ko.loser, events);
    else if (reply && next) {
      // Droit de réponse : à 0 PV, celui qui n'a pas ouvert la manche rend une dernière gifle.
      this.fx.clearTransient();
      this.fx.screenFlash(0.35, COLORS.cyan);
      sfx.whistle();
      this.setPose(reply.side, 'idle');
      this.setTint(reply.side, 0xff9f9f);
      this.say('lastWord');
      const d = announceImage(this, 'ann_lastword', 800, 0.2);
      this.time.delayedCall(d - 100, () => this.beginTurn(next.side));
    } else if (next) this.beginTurn(next.side);
  }

  // ── Animations ─────────────────────────────────────────────────────────

  /** windup → swing (60 ms) → slap avec pas en avant → contact (arrêt sur image) → hit → retour. */
  private slapAnim(hit: HitEvent, done: () => void, arrived = false) {
    const attSide = hit.attacker;
    const defSide = hit.defender;
    const att = this.f[attSide];
    const def = this.f[defSide];
    const limp = hit.kind === 'limp';
    const k = computeStrike(this.layout, attSide, att.id, def.id);
    att.sprite.setDepth(11);
    def.sprite.setDepth(10);
    // La gifle a déjà fait le trajet (le temps de l'esquive) : il ne reste que le contact.
    if (arrived && !limp) {
      this.setPose(attSide, 'slap');
      return this.impact(hit, k, done);
    }

    this.setPose(attSide, 'swing');
    if (!limp) sfx.whoosh();
    this.time.delayedCall(limp ? 160 : 60, () => {
      this.setPose(attSide, 'slap');
      this.tweens.add({
        targets: att.sprite,
        x: att.homeX + k.dir * k.step,
        duration: limp ? 220 : 70,
        ease: limp ? 'Sine.InOut' : 'Quad.Out',
        onComplete: () => this.impact(hit, k, done),
      });
    });
  }

  private impact(
    hit: HitEvent,
    k: ReturnType<typeof computeStrike>,
    done: () => void,
    opts: { hpAfter?: number; whole?: HitEvent } = {},
  ) {
    const attSide = hit.attacker;
    const defSide = hit.defender;
    const att = this.f[attSide];
    const def = this.f[defSide];
    const result = hit.result;
    const limp = hit.kind === 'limp';
    const special = hit.kind === 'special';
    // Une spéciale se met en scène comme un critique, en plus gros.
    const crit = !!result?.critical || special;
    const contact = limp ? 'limp' : special ? 'clean' : result!.contact;
    const whole = opts.whole ?? hit;
    const dodge = whole.defense ?? null;
    // Puissance perçue 0–1 : sert à doser tous les effets.
    const power = special ? 1 : Math.min(1, hit.damage / 34);
    const dir = k.dir as 1 | -1;

    // Contact : la main est sur la joue (pose idle).
    if (opts.hpAfter !== undefined) this.showHp(defSide, opts.hpAfter);
    else this.setHp(defSide, def.hp - hit.damage);
    this.slapCount++;
    this.lastResult = result ? { ...result, kind: special ? 'special' : 'slap', damage: whole.damage, dodge } : { kind: 'limp', damage: hit.damage };
    const size = limp ? 0.45 : special ? 1.6 : crit ? 1.35 : contact === 'clean' ? 0.8 + power * 0.4 : 0.6;
    this.fx.flash(k.impactX, k.impactY, size);
    if (!limp && contact !== 'missed') {
      this.fx.focusLines(k.impactX, k.impactY, crit ? 1 : power);
      this.addPrint(defSide);
    }
    if (crit) this.fx.screenFlash(special ? 0.75 : 0.55, special ? COLORS.pink : 0xffffff);
    this.fx.onomatopoeia(limp ? 'limp' : crit ? 'crit' : 'slap', k.impactX, k.impactY, dir);
    sfx.slap(limp ? 0.15 : contact === 'missed' ? 0.25 : 0.35 + power * 0.65, crit);
    this.publish();

    // Arrêt sur image, puis réaction.
    this.freeze(limp ? 40 : HITSTOP_MS, () => {
      // Esquive parfaite ou garde de rage : le perso reste debout, la gifle ne fait que l'effleurer.
      const slipped = dodge === 'perfect' || dodge === 'rage';
      if (!slipped || def.hp <= 0) this.setPose(defSide, 'hit');
      if (dodge && def.hp > 0) {
        this.setTint(defSide, DODGE_TINT[dodge]);
        this.time.delayedCall(520, () => this.setTint(defSide, null));
        if (dodge === 'rage') this.fx.screenFlash(0.3, COLORS.pink);
      }
      // Garde de rage : la rage est dépensée tout de suite (jauge vide, plus d'aura).
      if (dodge === 'rage') {
        this.showReady(defSide, false);
        def.bar.setRage(0);
      }
      const big = hit.damage >= 20 || crit;
      this.cameras.main.shake(special ? 320 : big ? 220 : 110, (special ? 0.02 : big ? 0.014 : 0.006) * (size < 0.7 ? 0.4 : 1));
      if (big) {
        this.fx.debris(k.impactX, k.impactY, dir, 6 + Math.round(power * 8), whole.damage >= 25 ? (crit ? 3 : 1) : 0);
        this.slowmo(special ? 0.25 : 0.35, special ? 520 : 380);
      }
      const label: LabelKey | undefined = dodge
        ? dodge === 'rage'
          ? 'lbl_guard'
          : dodge === 'perfect'
            ? 'lbl_perfect'
            : 'lbl_dodge'
        : limp
        ? 'lbl_limp'
        : special
          ? 'lbl_special'
          : crit
          ? 'lbl_crit'
          : contact === 'grazed'
            ? 'lbl_grazed'
            : contact === 'missed'
              ? 'lbl_missed'
              : undefined;
      this.fx.damageNumber(k.impactX - dir * 45, k.impactY - 95, hit.damage, crit ? 'c' : 'n', label);
      // Recul : plus ample quand la gifle est esquivée (le perso s'est jeté en arrière).
      this.tweens.killTweensOf(def.sprite);
      this.tweens.chain({
        targets: def.sprite,
        tweens: [
          { x: def.homeX + dir * (dodge ? 46 : 18 + power * 22), duration: 90, ease: 'Quad.Out' },
          { x: def.homeX, duration: dodge ? 220 : 90, delay: dodge ? 160 : 0, ease: 'Quad.InOut' },
        ],
      });
      sfx.cry(def.id, limp ? 0.1 : slipped ? power * 0.3 : power);

      // Foule et commentateur
      if (limp || contact === 'missed') {
        this.crowd.boo();
        sfx.boo();
      } else {
        this.crowd.cheer(crit ? 1 : power);
        sfx.crowd(crit ? 1 : power);
      }
      const ko = def.hp <= 0;
      if (!ko) this.say(dodge === 'rage' ? 'guard' : dodge === 'perfect' ? 'perfect' : dodge === 'good' && !crit ? 'dodge' : this.commentKind(whole, crit, contact));
      this.publish();

      this.time.delayedCall(300, () => {
        this.tweens.add({
          targets: att.sprite,
          x: att.homeX,
          duration: 200,
          ease: 'Quad.InOut',
          onComplete: () => {
            if (att.pose === 'slap') this.setPose(attSide, 'idle');
          },
        });
      });
      this.time.delayedCall(560, () => {
        if (def.hp > 0) this.setPose(defSide, 'idle');
        done();
      });
    });
  }

  /** Le commentateur parle (et l'état publié pour les tests est mis à jour). */
  private say(kind: CommentKind) {
    this.commentator.say(kind);
    this.publish();
  }

  private commentKind(hit: HitEvent, crit: boolean, contact: string): CommentKind {
    if (hit.kind === 'special') return this.f[hit.attacker].id === 'bernard' ? 'battoir' : 'toupie';
    if (hit.kind === 'limp') return 'limp';
    if (crit) return 'crit';
    if (contact === 'missed') return 'missed';
    if (contact === 'grazed') return 'grazed';
    return hit.damage >= 20 ? 'big' : 'normal';
  }

  private selfSlapAnim(e: Extract<MatchEvent, { type: 'selfhit' }>, done: () => void) {
    const side = e.side;
    const fighter = this.f[side];
    this.setPose(side, 'selfslap');
    this.setHp(side, fighter.hp - e.damage);
    this.lastResult = { kind: 'selfslap', damage: e.damage };
    const s = this.layout.fighterScale;
    const a = assets.fighters[fighter.id];
    const dir = side === 'left' ? 1 : -1;
    // La main se pose sur la joue, un peu en retrait de l'avant du visage.
    const fx = fighter.homeX + dir * (a.face.x - 55) * s;
    const fy = fighter.sprite.y - a.face.y * s;
    this.cameras.main.shake(140, 0.007);
    this.fx.flash(fx, fy, 0.7);
    this.fx.onomatopoeia('self', fx, fy, dir);
    this.fx.damageNumber(fx, fy - 80, e.damage, 'r', 'lbl_self');
    this.addPrint(side);
    sfx.slap(0.5);
    sfx.cry(fighter.id, 0.5);
    this.crowd.cheer(0.6);
    sfx.crowd(0.6);
    if (fighter.hp > 0) this.say('self');
    this.publish();
    this.time.delayedCall(800, () => {
      if (fighter.hp > 0) this.setPose(side, 'idle');
      done();
    });
  }

  /** Affiche une valeur de PV précise (coups enchaînés de La Toupie). */
  private showHp(side: Side, hp: number) {
    const fighter = this.f[side];
    fighter.hp = Math.max(0, hp);
    fighter.bar.setValue(fighter.hp / MATCH.hp);
  }

  /**
   * Gifle spéciale : Le Battoir (un coup énorme) ou La Toupie (jusqu'à 3 coups enchaînés).
   * `arrived` : la spéciale a été annoncée à son déclenchement et la main est déjà sur la joue.
   */
  private specialAnim(hit: HitEvent, done: () => void, arrived = false) {
    const attSide = hit.attacker;
    const defSide = hit.defender;
    const att = this.f[attSide];
    const def = this.f[defSide];
    this.showReady(attSide, false);
    // La rage est dépensée : la jauge se vide.
    att.bar.setRage(0);
    const strike = () => {
      const hits = hit.special!.hits;
      if (hits.length === 1) return this.slapAnim(hit, done, arrived);
      // La Toupie : chaque coup fait reculer la barre, le dernier déclenche la grande réaction.
      const k = computeStrike(this.layout, attSide, att.id, def.id);
      const startHp = def.hp;
      let cum = 0;
      att.sprite.setDepth(11);
      def.sprite.setDepth(10);
      const contact = (i: number) => {
        cum += hits[i];
        const sub = { ...hit, damage: hits[i] };
        if (i === hits.length - 1) {
          this.impact(sub, k, done, { hpAfter: startHp - cum, whole: hit });
          return;
        }
        this.chainHit(sub, k, startHp - cum, i, () =>
          this.tweens.add({ targets: att.sprite, x: att.homeX + k.dir * k.step * 0.35, duration: 70, ease: 'Quad.In', onComplete: () => one(i + 1) }),
        );
      };
      const one = (i: number) => {
        this.setPose(attSide, 'swing');
        sfx.whoosh();
        this.time.delayedCall(45, () => {
          this.setPose(attSide, 'slap');
          this.tweens.add({ targets: att.sprite, x: att.homeX + k.dir * k.step, duration: 60, ease: 'Quad.Out', onComplete: () => contact(i) });
        });
      };
      if (arrived) {
        this.setPose(attSide, 'slap');
        contact(0);
      } else one(0);
    };
    if (arrived) return strike();
    sfx.powerUp();
    this.fx.screenFlash(0.35, COLORS.pink);
    this.cameras.main.shake(200, 0.004);
    const d = announceImage(this, `ann_special_${att.id}`, 420, 0.3);
    // On laisse l'annonce disparaître avant le coup.
    this.time.delayedCall(d - 80, strike);
  }

  /** Coup intermédiaire de La Toupie : éclair, chiffre, trace, son, mini arrêt sur image. */
  private chainHit(hit: HitEvent, k: ReturnType<typeof computeStrike>, hpAfter: number, i: number, next: () => void) {
    const defSide = hit.defender;
    const dir = k.dir as 1 | -1;
    this.showHp(defSide, hpAfter);
    this.fx.flash(k.impactX, k.impactY - i * 10, 0.9);
    this.addPrint(defSide);
    this.fx.damageNumber(k.impactX - dir * (45 + i * 40), k.impactY - 95 - i * 30, hit.damage, 'n');
    sfx.slap(0.7);
    this.cameras.main.shake(90, 0.008);
    this.freeze(45, () => {
      this.setPose(defSide, 'hit');
      this.tweens.killTweensOf(this.f[defSide].sprite);
      this.f[defSide].sprite.x = this.f[defSide].homeX;
      this.tweens.add({ targets: this.f[defSide].sprite, x: this.f[defSide].homeX + dir * 14, duration: 60, yoyo: true });
      this.time.delayedCall(70, next);
    });
  }

  private setHp(side: Side, hp: number) {
    const fighter = this.f[side];
    fighter.hp = Math.max(0, this.match ? this.match.hp[side] : hp);
    fighter.bar.setValue(fighter.hp / MATCH.hp);
  }

  // ── Traces de main sur la joue ─────────────────────────────────────────

  private addPrint(side: Side) {
    const fighter = this.f[side];
    if (fighter.prints.length >= MAX_PRINTS) {
      // On recycle la plus ancienne : la joue est déjà bien rouge.
      const old = fighter.prints.shift()!;
      old.img.destroy();
    }
    const img = this.add
      .image(0, 0, 'fx_hand')
      .setDepth(12)
      .setAlpha(0.3 + Math.random() * 0.12)
      .setAngle(Phaser.Math.Between(-35, 15) * (side === 'left' ? 1 : -1))
      .setFlipX(side === 'right')
      .setVisible(fighter.pose === 'idle');
    fighter.prints.push({ img, dx: Phaser.Math.Between(-6, 6), dy: Phaser.Math.Between(-6, 6) });
    this.placePrints(side);
    this.publish();
  }

  private placePrints(side: Side) {
    const fighter = this.f[side];
    if (!this.layout) return;
    const s = this.layout.fighterScale;
    const dir = side === 'left' ? 1 : -1;
    const cheek = CHEEK[fighter.id];
    for (const p of fighter.prints) {
      p.img
        .setPosition(fighter.homeX + dir * (cheek.x + p.dx) * s, fighter.sprite.y - (cheek.y + p.dy) * s)
        .setScale(s * 0.34);
    }
  }

  private clearPrints(side: Side) {
    for (const p of this.f[side].prints) p.img.destroy();
    this.f[side].prints = [];
  }

  // ── K.O., fin de round, fin de match ───────────────────────────────────

  private knockout(loser: Side, events: MatchEvent[]) {
    const winner = other(loser);
    this.setPhase('roundEnd');
    // Double K.O. (droit de réponse) : les deux tombent, puis le moins amoché se relève.
    const double = !!this.match && this.match.hp.left <= 0 && this.match.hp.right <= 0;
    this.setTint('left', null);
    this.setTint('right', null);
    this.setPose(loser, 'dazed');
    if (double) this.setPose(winner, 'dazed');
    this.fx.clearTransient();
    this.fx.screenFlash(0.7);
    this.slowmo(0.4, 700);
    const d = announceImage(this, double ? 'ann_double_ko' : 'ann_ko', 900);
    this.cameras.main.shake(300, 0.012);
    sfx.ko();
    this.crowd.whistle();
    sfx.whistle(true);
    this.say(double ? 'doubleKo' : 'ko');
    this.crowd.cheer(1);
    sfx.crowd(1, 1.8);
    this.time.delayedCall(450, () => this.crowd.cheer(1));
    this.time.delayedCall(double ? 1000 : 250, () => this.setPose(winner, 'victory'));

    if (!this.match) {
      // Entraînement : on repart pour un tour.
      this.time.delayedCall(d + 300, () => {
        for (const s of ['left', 'right'] as const) {
          this.f[s].hp = MATCH.hp;
          this.f[s].bar.setValue(1, true);
          this.clearPrints(s);
          this.setPose(s, 'idle');
        }
        this.beginTurn('left');
      });
      return;
    }

    const roundOver = events.find((e): e is Extract<MatchEvent, { type: 'roundOver' }> => e.type === 'roundOver');
    const matchOver = events.find((e): e is Extract<MatchEvent, { type: 'matchOver' }> => e.type === 'matchOver');
    this.time.delayedCall(d - 300, () => {
      if (roundOver) this.f[roundOver.winner].pips.setWon(roundOver.wins[roundOver.winner]);
      if (!matchOver) announceImage(this, `ann_roundfor_${this.f[winner].id}`, 700, 0.62);
    });
    this.time.delayedCall(d + 900, () => {
      if (matchOver) this.showResult(matchOver.winner);
      else this.startRound();
    });
  }

  /** `fresh` : le match vient de se finir (on compte l'XP) ; faux quand on réaffiche un résultat à la reprise. */
  private showResult(winner: Side, fresh = true) {
    const m = this.match!;
    this.setPhase('over');
    this.commentator.hide();
    const { width, height } = this.scale;
    const loser = other(winner);
    this.setPose(winner, 'victory');
    this.setPose(loser, 'dazed');
    const w = FIGHTERS[this.f[winner].id];
    this.crowd.cheer(1);
    sfx.crowd(1, 2);

    const c = this.add.container(0, 0).setDepth(200);
    // Voile (150) < vainqueur en pleine lumière (160) < panneau (200).
    const shade = this.add.rectangle(0, 0, width, height, COLORS.ink, 0.45).setOrigin(0).setDepth(150).setAlpha(0);
    this.tweens.add({ targets: shade, alpha: 1, duration: 300 });
    const band = this.add.rectangle(width / 2, height * 0.24, width * 1.3, 128, COLORS.red).setStrokeStyle(8, COLORS.ink).setAngle(-4);
    // Solo : on parle du point de vue du joueur (victoire ou défaite contre l'IA).
    const playerLost = (this.mode === 'solo' && this.control[winner] === 'ai') || (this.mode === 'online' && this.control[winner] === 'remote');
    showNetLost(false);
    const title = this.add
      .text(width / 2, height * 0.23, playerLost ? 'DÉFAITE…' : 'VICTOIRE !', {
        fontFamily: FONT_TITLE,
        fontSize: '84px',
        color: playerLost ? CSS.cream : CSS.yellow,
        stroke: CSS.ink,
        strokeThickness: 14,
      })
      .setOrigin(0.5)
      .setAngle(-4);
    if (playerLost) band.setFillStyle(COLORS.ink).setStrokeStyle(8, COLORS.red);
    const who = this.add
      .text(width / 2, height * 0.41, `${w.name.toUpperCase()}  ${w.katakana}`, {
        fontFamily: FONT_TITLE,
        fontSize: '38px',
        color: CSS.cream,
        stroke: CSS.ink,
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setAngle(-4);
    const score = this.add
      .text(width / 2, height * 0.5, `${m.wins[winner]} ROUNDS À ${m.wins[loser]}`, {
        fontFamily: FONT_UI,
        fontStyle: '800',
        fontSize: '24px',
        color: CSS.ink,
        backgroundColor: CSS.cream,
        padding: { x: 14, y: 4 },
      })
      .setOrigin(0.5)
      .setAngle(-4);
    c.add([band, title, who, score]);
    // Progression : XP gagnée, niveau, déblocages (sauvegardés tout de suite).
    const kind = this.mode === 'solo' || this.mode === 'match' || this.mode === 'online' ? this.mode : null;
    if (fresh && kind && !this.bot) {
      const me: Side = this.mode === 'online' ? this.online!.localSide : this.mode === 'solo' ? 'left' : winner;
      const a = award(this.progress, { kind, level: this.level, won: !playerLost, rounds: m.wins[me] });
      saveProgress(this.progress);
      this.lastAward = a;
      const y = height * 0.61;
      const barW = 300;
      const label = this.add
        .text(width / 2, y, `+${a.gained} XP  ·  NIVEAU ${a.levelAfter}`, { fontFamily: FONT_TITLE, fontSize: '26px', color: CSS.yellow, stroke: CSS.ink, strokeThickness: 7 })
        .setOrigin(0.5);
      const track = this.add.rectangle(width / 2, y + 30, barW, 14, COLORS.ink).setStrokeStyle(3, COLORS.cream);
      const from = a.levelAfter > a.levelBefore ? 0 : levelProgress(a.before);
      const fill = this.add.rectangle(width / 2 - barW / 2 + 3, y + 30, Math.max(1, (barW - 6) * from), 8, COLORS.yellow).setOrigin(0, 0.5);
      this.tweens.add({ targets: fill, width: Math.max(1, (barW - 6) * levelProgress(a.after)), delay: 350, duration: 600, ease: 'Quad.Out' });
      c.add([label, track, fill]);
      if (a.unlocked.length > 0) {
        const names = a.unlocked.map((u) => (u.kind === 'bar' ? u.name : `tenue ${u.name} de ${FIGHTERS[u.fighter!].short}`)).join(' · ');
        const un = this.add
          .text(width / 2, y + 66, `DÉBLOQUÉ : ${names} !`, { fontFamily: FONT_TITLE, fontSize: '24px', color: CSS.cream, backgroundColor: CSS.pink, padding: { x: 14, y: 5 } })
          .setOrigin(0.5)
          .setAngle(-3)
          .setScale(0);
        this.tweens.add({ targets: un, scale: 1, delay: 900, duration: 300, ease: 'Back.Out', onStart: () => sfx.powerUp() });
        c.add(un);
      }
    }
    const again = () => {
      if (this.online) {
        // Revanche en ligne : les deux téléphones repartent ensemble.
        this.online.rematch();
        this.scene.restart({ online: this.online, bot: this.bot, speed: this.speed });
      } else this.scene.restart({ mode: this.mode, level: this.level, fighter: this.ids.left, speed: this.speed });
    };
    c.add(makeButton(this, width / 2 - 160, height * 0.88, 'REVANCHE', COLORS.yellow, again));
    // Solo gagné : on propose le niveau au-dessus. Sinon, retour au menu.
    const nextLevel: AiLevel | null = this.mode === 'solo' && !playerLost ? (this.level === 'easy' ? 'normal' : this.level === 'normal' ? 'hard' : null) : null;
    if (nextLevel) {
      c.add(makeButton(this, width / 2 + 160, height * 0.88, 'NIVEAU SUIVANT', COLORS.pink, () => this.scene.restart({ mode: 'solo', level: nextLevel, fighter: this.ids.left, speed: this.speed })));
    } else {
      c.add(makeButton(this, width / 2 + 160, height * 0.88, 'MENU', COLORS.cyan, () => this.goHome()));
    }
    this.f[winner].sprite.setDepth(160);
    this.timer.set(null);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 300 });
    title.setScale(2);
    this.tweens.add({ targets: title, scale: 1, duration: 300, ease: 'Back.Out' });
    this.publish();
  }
}
