import Phaser from 'phaser';
import assets from '../config/assets.json';
import { ADVANCED, FIGHTERS, MATCH, SLAP, STAGE, type FighterId } from '../config/balance';
import { CHEEK } from '../config/sprites';
import type { CommentKind } from '../config/comments';
import { computeLayout, computeStrike, HABITUES, type StageLayout } from '../logic/layout';
import { SlapGesture, type GestureOutcome } from '../logic/gesture';
import { chargeAt, computeSlap, stunCurve, type ChargeSpeed, type SlapResult } from '../logic/slap';
import { Match, other, type MatchEvent, type Side, type TurnAction } from '../logic/match';
import { aiDecide, AI_PROFILES, LEVEL_LABEL, LEVEL_PROFILE, type AiLevel, type AiProfile } from '../logic/ai';
import { createRng, type Rng } from '../logic/rng';
import { sfx } from '../audio/sfx';
import { announceImage, bannerImage, Fx, type LabelKey } from '../fx/Fx';
import { Commentator, Crowd } from '../fx/Crowd';
import { ChargeGauge } from '../ui/ChargeGauge';
import { HealthBar } from '../ui/HealthBar';
import { RoundPips, TimerDiamond } from '../ui/hud';
import { COLORS, CSS, FONT_TITLE, FONT_UI } from '../ui/theme';
import { fighterKey, type Pose } from './BootScene';

export type Mode = 'match' | 'solo' | 'training' | 'autoplay';
type Controller = 'human' | 'ai';

export interface FightData {
  mode?: Mode;
  /** Niveau de l'IA en mode solo. */
  level?: AiLevel;
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

type ScenePhase = 'intro' | 'banner' | 'ready' | 'charging' | 'busy' | 'roundEnd' | 'over';

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
  private lastResult: (SlapResult & { kind: 'slap' | 'special' }) | { kind: 'selfslap' | 'limp'; damage: number } | null = null;
  private aiTimers: Phaser.Time.TimerEvent[] = [];
  private frozen = false;
  private slowToken = 0;

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
    this.match = this.mode === 'training' ? null : new Match('bernard', 'lola');
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
  }

  create() {
    this.setTimeScale(1);

    this.decor = this.add.image(0, 0, 'decor').setOrigin(0, 0);
    this.crowdImgs = HABITUES.map((id) =>
      this.add.image(0, 0, `habitue_${id}`).setOrigin(0.5, 1).setTint(STAGE.crowdTint),
    );
    this.patron = this.add.image(0, 0, 'patron').setOrigin(0.5, 1).setTint(STAGE.patronTint);

    this.f = {
      left: this.makeFighter('left', 'bernard'),
      right: this.makeFighter('right', 'lola'),
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
      })
      .setOrigin(0.5, 1)
      .setDepth(100)
      .setVisible(false);
    this.modeLabel = this.add
      .text(0, 0, this.mode === 'training' ? 'ENTRAÎNEMENT' : this.mode === 'solo' ? `SOLO · ${LEVEL_LABEL[this.level]}` : 'DÉMO IA', {
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

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
      this.slowToken++;
    });

    // Le son ne peut démarrer qu'après un geste de l'utilisateur.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      sfx.unlock();
      sfx.startMusic();
    });
    if (this.mode !== 'autoplay') {
      this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    }

    if (window.__slap) {
      window.__slap.ready = true;
      window.__slap.scene = 'Fight';
    }

    if (this.match) this.startRound();
    else this.beginTurn('left');
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
      level: this.mode === 'solo' ? this.level : null,
      control: { ...this.control },
      phase: this.phase === 'ready' || this.phase === 'charging' ? this.phase : this.phase === 'over' ? 'over' : 'busy',
      scenePhase: this.phase,
      attacker: this.attacker,
      hp: { left: this.f.left.hp, right: this.f.right.hp },
      pose: { left: this.f.left.pose, right: this.f.right.pose },
      slaps: this.slapCount,
      turns: this.turnsPlayed,
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

  private startRound() {
    const m = this.match!;
    const events = m.startRound();
    const start = events.find((e): e is Extract<MatchEvent, { type: 'roundStart' }> => e.type === 'roundStart');
    if (!start) return;
    this.setPhase('intro');
    for (const s of ['left', 'right'] as const) {
      this.f[s].hp = m.hp[s];
      this.f[s].bar.setValue(1, true);
      this.f[s].sprite.x = this.f[s].homeX;
      this.clearPrints(s);
      this.clearDizzy(s);
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
      this.setPhase('ready');
      this.showHint();
      if (this.control[side] === 'ai') this.aiTurn(side);
    });
  }

  private showHint() {
    const human = this.control[this.attacker] === 'human';
    const show = human && (this.mode === 'training' || (this.mode === 'match' && this.turnsPlayed < 2) || (this.mode === 'solo' && this.turnsPlayed < 3));
    if (!show) return this.hint.setVisible(false);
    const def = FIGHTERS[this.f[other(this.attacker)].id].short.toUpperCase();
    const arrow = this.attacker === 'left' ? '→' : '←';
    this.hint.setText(`MAINTIENS pour armer  ·  GLISSE vers ${def} ${arrow}`).setVisible(true);
  }

  update(time: number, delta: number) {
    if (!this.frozen) this.crowd.update(time);
    if (this.match && (this.phase === 'ready' || this.phase === 'charging')) {
      this.turnElapsed += delta * this.speed;
      const left = MATCH.turnTimeMs - this.turnElapsed;
      this.timer.set(Math.max(0, left) / 1000, Math.max(0, left) / MATCH.turnTimeMs);
      const sec = Math.ceil(Math.max(0, left) / 1000);
      if (sec !== this.lastTickSecond && sec <= 2 && sec > 0) sfx.tick(sec <= 1);
      this.lastTickSecond = sec;
      // Chrono écoulé : gifle molle automatique (sauf swipe déjà lancé, qu'on laisse finir).
      if (left <= 0 && this.gesture?.phase !== 'swiping') {
        this.timeout();
        return;
      }
    }
    if (this.phase === 'charging' && this.gesture) {
      const t = performance.now();
      const out = this.gesture.update(t);
      if (out) return this.resolve(out);
      const c = this.gesture.charge(t);
      this.gauge.setValue(c, false);
      if (window.__slap?.state) window.__slap.state.charge = c;
      // Le perso tremble quand la jauge est pleine (surchauffe imminente).
      const att = this.f[this.attacker];
      att.sprite.x = att.homeX + (c >= 100 ? Phaser.Math.Between(-3, 3) : 0);
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

  private onDown(p: Phaser.Input.Pointer) {
    if (this.phase !== 'ready' || this.control[this.attacker] !== 'human') return;
    if (this.soundBtn.getBounds().contains(p.x, p.y)) return;
    const att = this.f[this.attacker];
    this.gesture = new SlapGesture(att.id, this.attacker === 'left' ? 1 : -1, this.chargeSpeed(this.attacker));
    const { x, y } = this.css(p);
    this.gesture.down(this.now(p), x, y);
    this.pointerId = p.id;
    this.setPhase('charging');
    this.gauge.setZone(FIGHTERS[att.id].goldenZone);
    this.gauge.setValue(0);
    this.gauge.show(true);
    this.setPose(this.attacker, 'windup');
    this.hint.setVisible(false);
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (this.phase !== 'charging' || !this.gesture || p.id !== this.pointerId || !p.isDown) return;
    const { x, y } = this.css(p);
    this.resolve(this.gesture.move(this.now(p), x, y));
  }

  private onUp(p: Phaser.Input.Pointer) {
    if (this.phase !== 'charging' || !this.gesture || p.id !== this.pointerId) return;
    const { x, y } = this.css(p);
    this.resolve(this.gesture.up(this.now(p), x, y));
  }

  private resolve(out: GestureOutcome | null) {
    if (!out) return;
    const att = this.f[this.attacker];
    att.sprite.x = att.homeX;
    if (out.type === 'cancel') {
      this.gesture = null;
      this.gauge.show(false);
      this.setPose(this.attacker, 'idle');
      this.setPhase('ready');
      this.showHint();
      if (out.reason !== 'no-swipe') announceImage(this, `ann_harder_${this.f[other(this.attacker)].id}`, 500, 0.5);
      return;
    }
    this.gesture = null;
    if (out.type === 'selfslap') {
      this.gauge.setValue(100, true);
      this.time.delayedCall(250, () => this.gauge.show(false));
      this.act({ type: 'selfslap' });
    } else {
      this.gauge.setValue(out.charge);
      this.time.delayedCall(350, () => this.gauge.show(false));
      this.act({ type: 'slap', charge: out.charge, speed: out.speed, angle: out.angle });
    }
  }

  // ── IA (mode solo et démo) ─────────────────────────────────────────────

  private aiTurn(side: Side) {
    const id = this.f[side].id;
    const speed = this.chargeSpeed(side);
    const d = aiDecide(this.rng, id, this.aiProfile[side], speed);
    if (d.action.type === 'timeout') return; // l'IA hésite : le chrono tranchera
    const target = d.action.type === 'slap' ? d.action.charge : 100;
    const action = d.action;
    this.aiTimers.push(
      this.time.delayedCall(d.startDelayMs, () => {
        if (this.phase !== 'ready') return;
        this.setPhase('charging');
        this.gauge.setZone(FIGHTERS[id].goldenZone);
        this.gauge.setValue(0);
        this.gauge.show(true);
        this.setPose(side, 'windup');
        const holdMs = d.holdMs;
        const tw = { t: 0 };
        // La jauge de l'IA suit la même courbe que celle d'un joueur (irrégulière si sonnée).
        this.tweens.add({
          targets: tw,
          t: holdMs,
          duration: holdMs,
          onUpdate: () => this.gauge.setValue(Math.min(target, chargeAt(tw.t, FIGHTERS[id].chargeTimeMs, speed))),
        });
        this.aiTimers.push(
          this.time.delayedCall(holdMs + (action.type === 'slap' ? d.swipeMs : 0), () => {
            if (this.phase !== 'charging') return;
            this.gauge.setValue(target, action.type === 'selfslap');
            this.time.delayedCall(300, () => this.gauge.show(false));
            this.act(action);
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

  private act(action: TurnAction) {
    this.cancelAi();
    this.setPhase('busy');
    this.hint.setVisible(false);
    this.timer.set(null);
    this.turnsPlayed++;
    // Le perso a joué son tour : s'il était sonné, ses étoiles s'envolent.
    this.clearDizzy(this.attacker);
    const events = this.match ? this.match.play(action) : this.trainingPlay(action);
    const hit = events.find((e): e is Extract<MatchEvent, { type: 'hit' }> => e.type === 'hit');
    const self = events.find((e): e is Extract<MatchEvent, { type: 'selfhit' }> => e.type === 'selfhit');
    const after = () => {
      this.afterHitStatus(events);
      this.afterTurn(events);
    };
    if (hit?.kind === 'special') this.specialAnim(hit, after);
    else if (hit) this.slapAnim(hit, after);
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
        f.sprite.clearTint();
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
          Phaser.Display.Color.ValueToColor(0xffffff),
          Phaser.Display.Color.ValueToColor(0xff9cc8),
          100,
          k * 100,
        );
        f.sprite.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
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
    if (ko) this.knockout(ko.loser, events);
    else if (next) this.beginTurn(next.side);
  }

  // ── Animations ─────────────────────────────────────────────────────────

  /** windup → swing (60 ms) → slap avec pas en avant → contact (arrêt sur image) → hit → retour. */
  private slapAnim(hit: Extract<MatchEvent, { type: 'hit' }>, done: () => void) {
    const attSide = hit.attacker;
    const defSide = hit.defender;
    const att = this.f[attSide];
    const def = this.f[defSide];
    const limp = hit.kind === 'limp';
    const k = computeStrike(this.layout, attSide, att.id, def.id);
    att.sprite.setDepth(11);
    def.sprite.setDepth(10);

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
    hit: Extract<MatchEvent, { type: 'hit' }>,
    k: ReturnType<typeof computeStrike>,
    done: () => void,
    opts: { hpAfter?: number; whole?: Extract<MatchEvent, { type: 'hit' }> } = {},
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
    // Puissance perçue 0–1 : sert à doser tous les effets.
    const power = special ? 1 : Math.min(1, hit.damage / 34);
    const dir = k.dir as 1 | -1;

    // Contact : la main est sur la joue (pose idle).
    if (opts.hpAfter !== undefined) this.showHp(defSide, opts.hpAfter);
    else this.setHp(defSide, def.hp - hit.damage);
    this.slapCount++;
    this.lastResult = result ? { ...result, kind: special ? 'special' : 'slap', damage: whole.damage } : { kind: 'limp', damage: hit.damage };
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
      this.setPose(defSide, 'hit');
      const big = hit.damage >= 20 || crit;
      this.cameras.main.shake(special ? 320 : big ? 220 : 110, (special ? 0.02 : big ? 0.014 : 0.006) * (size < 0.7 ? 0.4 : 1));
      if (big) {
        this.fx.debris(k.impactX, k.impactY, dir, 6 + Math.round(power * 8), whole.damage >= 25 ? (crit ? 3 : 1) : 0);
        this.slowmo(special ? 0.25 : 0.35, special ? 520 : 380);
      }
      const label: LabelKey | undefined = limp
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
      this.tweens.add({ targets: def.sprite, x: def.homeX + dir * (18 + power * 22), duration: 90, yoyo: true, ease: 'Quad.Out' });
      sfx.cry(def.id, limp ? 0.1 : power);

      // Foule et commentateur
      if (limp || contact === 'missed') {
        this.crowd.boo();
        sfx.boo();
      } else {
        this.crowd.cheer(crit ? 1 : power);
        sfx.crowd(crit ? 1 : power);
      }
      const ko = def.hp <= 0;
      if (!ko) this.say(this.commentKind(whole, crit, contact));
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

  private commentKind(hit: Extract<MatchEvent, { type: 'hit' }>, crit: boolean, contact: string): CommentKind {
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

  /** Gifle spéciale : annonce, puis Le Battoir (un coup énorme) ou La Toupie (3 coups enchaînés). */
  private specialAnim(hit: Extract<MatchEvent, { type: 'hit' }>, done: () => void) {
    const attSide = hit.attacker;
    const defSide = hit.defender;
    const att = this.f[attSide];
    const def = this.f[defSide];
    this.showReady(attSide, false);
    sfx.powerUp();
    this.fx.screenFlash(0.35, COLORS.pink);
    this.cameras.main.shake(200, 0.004);
    // La rage est dépensée : la jauge se vide dès l'annonce.
    att.bar.setRage(0);
    const d = announceImage(this, `ann_special_${att.id}`, 420, 0.3);
    // On laisse l'annonce disparaître avant le coup.
    this.time.delayedCall(d - 80, () => {
      const hits = hit.special!.hits;
      if (hits.length === 1) return this.slapAnim(hit, done);
      // La Toupie : chaque coup fait reculer la barre, le dernier déclenche la grande réaction.
      const k = computeStrike(this.layout, attSide, att.id, def.id);
      const startHp = def.hp;
      let cum = 0;
      att.sprite.setDepth(11);
      def.sprite.setDepth(10);
      const one = (i: number) => {
        this.setPose(attSide, 'swing');
        sfx.whoosh();
        this.time.delayedCall(45, () => {
          this.setPose(attSide, 'slap');
          this.tweens.add({
            targets: att.sprite,
            x: att.homeX + k.dir * k.step,
            duration: 60,
            ease: 'Quad.Out',
            onComplete: () => {
              cum += hits[i];
              const sub = { ...hit, damage: hits[i] };
              if (i === hits.length - 1) {
                this.impact(sub, k, done, { hpAfter: startHp - cum, whole: hit });
                return;
              }
              this.chainHit(sub, k, startHp - cum, i, () =>
                this.tweens.add({ targets: att.sprite, x: att.homeX + k.dir * k.step * 0.35, duration: 70, ease: 'Quad.In', onComplete: () => one(i + 1) }),
              );
            },
          });
        });
      };
      one(0);
    });
  }

  /** Coup intermédiaire de La Toupie : éclair, chiffre, trace, son, mini arrêt sur image. */
  private chainHit(hit: Extract<MatchEvent, { type: 'hit' }>, k: ReturnType<typeof computeStrike>, hpAfter: number, i: number, next: () => void) {
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
    this.setPose(loser, 'dazed');
    this.fx.clearTransient();
    this.fx.screenFlash(0.7);
    this.slowmo(0.4, 700);
    const d = announceImage(this, 'ann_ko', 900);
    this.cameras.main.shake(300, 0.012);
    sfx.ko();
    this.crowd.whistle();
    sfx.whistle(true);
    this.say('ko');
    this.crowd.cheer(1);
    sfx.crowd(1, 1.8);
    this.time.delayedCall(450, () => this.crowd.cheer(1));
    this.time.delayedCall(250, () => this.setPose(winner, 'victory'));

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

  private showResult(winner: Side) {
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
    const playerLost = this.mode === 'solo' && this.control[winner] === 'ai';
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
    const again = () => this.scene.restart({ mode: this.mode, level: this.level, speed: this.speed });
    c.add(this.button(width / 2 - 160, height * 0.88, 'REVANCHE', COLORS.yellow, again));
    // Solo gagné : on propose le niveau au-dessus.
    const nextLevel: AiLevel | null = this.mode === 'solo' && !playerLost ? (this.level === 'easy' ? 'normal' : this.level === 'normal' ? 'hard' : null) : null;
    if (nextLevel) {
      c.add(this.button(width / 2 + 160, height * 0.88, 'NIVEAU SUIVANT', COLORS.pink, () => this.scene.restart({ mode: 'solo', level: nextLevel, speed: this.speed })));
    } else {
      c.add(this.button(width / 2 + 160, height * 0.88, 'ENTRAÎNEMENT', COLORS.cyan, () => this.scene.restart({ mode: 'training' })));
    }
    this.f[winner].sprite.setDepth(160);
    this.timer.set(null);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 300 });
    title.setScale(2);
    this.tweens.add({ targets: title, scale: 1, duration: 300, ease: 'Back.Out' });
    this.publish();
  }

  private button(x: number, y: number, label: string, color: number, onClick: () => void) {
    const W = 290;
    const H = 66;
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, W, H, color).setStrokeStyle(6, COLORS.ink).setAngle(-3);
    const t = this.add
      .text(0, 0, label, { fontFamily: FONT_TITLE, fontSize: '28px', color: CSS.ink })
      .setOrigin(0.5)
      .setAngle(-3);
    // Le texte ne déborde jamais du bouton : réduit si la police est plus large que prévu.
    const maxW = W - 40;
    if (t.width > maxW) t.setScale(maxW / t.width);
    c.add([bg, t]);
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
}
