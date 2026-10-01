import Phaser from 'phaser';
import assets from '../config/assets.json';
import { FIGHTERS, MATCH, SLAP, STAGE, type FighterId } from '../config/balance';
import { computeLayout, computeStrike, HABITUES, type StageLayout } from '../logic/layout';
import { SlapGesture, type GestureOutcome } from '../logic/gesture';
import { computeSlap, type SlapResult } from '../logic/slap';
import { Match, other, type MatchEvent, type Side, type TurnAction } from '../logic/match';
import { aiDecide, AI_PROFILES } from '../logic/ai';
import { createRng, type Rng } from '../logic/rng';
import { ChargeGauge } from '../ui/ChargeGauge';
import { HealthBar } from '../ui/HealthBar';
import { bigAnnounce, RoundPips, TimerDiamond, turnBanner } from '../ui/hud';
import { flashText, popDamage } from '../ui/popups';
import { COLORS, CSS, FONT_TITLE, FONT_UI } from '../ui/theme';
import { fighterKey, type Pose } from './BootScene';

export type Mode = 'match' | 'training' | 'autoplay';

export interface FightData {
  mode?: Mode;
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
}

type ScenePhase = 'intro' | 'banner' | 'ready' | 'charging' | 'busy' | 'roundEnd' | 'over';

/** Arrêt sur image au contact, avant la réaction (direction artistique : 80 ms). */
const HITSTOP_MS = 80;

/**
 * Scène de combat : match à deux sur le même téléphone, entraînement, ou démo IA contre IA.
 */
export class FightScene extends Phaser.Scene {
  private decor!: Phaser.GameObjects.Image;
  private patron!: Phaser.GameObjects.Image;
  private crowd: Phaser.GameObjects.Image[] = [];
  private f!: Record<Side, Fighter>;
  private gauge!: ChargeGauge;
  private timer!: TimerDiamond;
  private hint!: Phaser.GameObjects.Text;
  private modeLabel!: Phaser.GameObjects.Text;
  layout!: StageLayout;

  private mode: Mode = 'match';
  private speed = 1;
  private rng: Rng = createRng(1);
  private match: Match | null = null;
  private attacker: Side = 'left';
  private phase: ScenePhase = 'intro';
  private gesture: SlapGesture | null = null;
  private pointerId = -1;
  private turnElapsed = 0;
  private turnsPlayed = 0;
  private slapCount = 0;
  private lastResult: (SlapResult & { kind: 'slap' }) | { kind: 'selfslap' | 'limp'; damage: number } | null = null;
  private aiTimers: Phaser.Time.TimerEvent[] = [];

  constructor() {
    super('Fight');
  }

  init(data: FightData) {
    this.mode = data.mode ?? 'match';
    this.speed = data.speed && data.speed > 0 ? data.speed : 1;
    this.rng = createRng(data.seed ?? Math.floor(Math.random() * 1e9));
    this.match = this.mode === 'training' ? null : new Match('bernard', 'lola');
    this.attacker = 'left';
    this.phase = 'intro';
    this.gesture = null;
    this.turnElapsed = 0;
    this.turnsPlayed = 0;
    this.slapCount = 0;
    this.lastResult = null;
    this.aiTimers = [];
  }

  create() {
    this.time.timeScale = this.speed;
    this.tweens.timeScale = this.speed;

    this.decor = this.add.image(0, 0, 'decor').setOrigin(0, 0);
    this.crowd = HABITUES.map((id) =>
      this.add.image(0, 0, `habitue_${id}`).setOrigin(0.5, 1).setTint(STAGE.crowdTint),
    );
    this.patron = this.add.image(0, 0, 'patron').setOrigin(0.5, 1).setTint(STAGE.patronTint);

    this.f = {
      left: this.makeFighter('left', 'bernard'),
      right: this.makeFighter('right', 'lola'),
    };

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
      .text(0, 0, this.mode === 'training' ? 'ENTRAÎNEMENT' : 'DÉMO IA', {
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

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this));

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
    return { side, id, sprite, bar, pips, hp: MATCH.hp, pose: 'idle', homeX: 0 };
  }

  private applyLayout() {
    const { width, height } = this.scale;
    const L = computeLayout(width, height, this.f.left.id, this.f.right.id);
    this.layout = L;
    this.cameras.main.setSize(width, height);

    this.decor.setPosition(L.decor.x, L.decor.y).setScale(L.decor.scale);
    this.patron.setPosition(L.patron.x, L.patron.y).setScale(L.patron.scale);
    L.crowd.forEach((c, i) => this.crowd[i].setPosition(c.x, c.y).setScale(c.scale));
    for (const side of ['left', 'right'] as const) {
      const p = L[side];
      const fighter = this.f[side];
      fighter.homeX = p.x;
      fighter.sprite.setPosition(p.x, p.y).setScale(p.scale);
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
    this.hint.setPosition(width / 2, height - 12);
    this.modeLabel.setPosition(width / 2, this.mode === 'training' ? 14 : 96);

    if (window.__slap) window.__slap.layout = L;
  }

  // ── État visible par les tests ─────────────────────────────────────────

  private publish() {
    if (!window.__slap) return;
    const m = this.match;
    window.__slap.state = {
      mode: this.mode,
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
    };
  }

  setPose(side: Side, pose: Pose) {
    const fighter = this.f[side];
    fighter.pose = pose;
    fighter.sprite.setTexture(fighterKey(fighter.id, pose));
    this.publish();
  }

  private setPhase(phase: ScenePhase) {
    this.phase = phase;
    this.publish();
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
      this.setPose(s, 'idle');
    }
    const final = start.round === MATCH.maxRounds || (m.wins.left === MATCH.roundsToWin - 1 && m.wins.right === MATCH.roundsToWin - 1);
    const d1 = bigAnnounce(this, final ? 'ROUND FINAL' : `ROUND ${start.round}`, CSS.yellow, 650);
    this.time.delayedCall(d1, () => {
      const d2 = bigAnnounce(this, 'BAGARRE !', CSS.pink, 450, 120);
      this.time.delayedCall(d2 - 150, () => this.beginTurn(start.first));
    });
  }

  private beginTurn(side: Side) {
    this.attacker = side;
    this.turnElapsed = 0;
    this.gesture = null;
    this.timer.set(null);
    if (this.mode === 'training') {
      this.setPhase('ready');
      this.showHint();
      return;
    }
    this.setPhase('banner');
    const d = turnBanner(this, `À TOI, ${FIGHTERS[this.f[side].id].short.toUpperCase()} !`, side, 520);
    this.time.delayedCall(d - 120, () => {
      if (this.phase !== 'banner') return;
      this.turnElapsed = 0;
      this.setPhase('ready');
      this.showHint();
      if (this.mode === 'autoplay') this.aiTurn(side);
    });
  }

  private showHint() {
    const show = this.mode === 'training' || (this.mode === 'match' && this.turnsPlayed < 2);
    if (!show) return this.hint.setVisible(false);
    const def = FIGHTERS[this.f[other(this.attacker)].id].short.toUpperCase();
    const arrow = this.attacker === 'left' ? '→' : '←';
    this.hint.setText(`MAINTIENS pour armer  ·  GLISSE vers ${def} ${arrow}`).setVisible(true);
  }

  update(_time: number, delta: number) {
    if (this.match && (this.phase === 'ready' || this.phase === 'charging')) {
      this.turnElapsed += delta * this.speed;
      const left = MATCH.turnTimeMs - this.turnElapsed;
      this.timer.set(Math.max(0, left) / 1000, Math.max(0, left) / MATCH.turnTimeMs);
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
    if (this.phase !== 'ready') return;
    const att = this.f[this.attacker];
    this.gesture = new SlapGesture(att.id, this.attacker === 'left' ? 1 : -1);
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
      if (out.reason !== 'no-swipe') {
        const def = FIGHTERS[this.f[other(this.attacker)].id].short.toUpperCase();
        flashText(this, this.scale.width / 2, this.scale.height * 0.5, `PLUS FORT, VERS ${def} !`, CSS.cream, 34);
      }
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

  // ── IA (mode démo) ─────────────────────────────────────────────────────

  private aiTurn(side: Side) {
    const id = this.f[side].id;
    const d = aiDecide(this.rng, id, AI_PROFILES.average);
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
        const holdMs = action.type === 'selfslap' ? d.holdMs : (target / 100) * FIGHTERS[id].chargeTimeMs;
        const tw = { v: 0 };
        this.tweens.add({
          targets: tw,
          v: target,
          duration: holdMs,
          onUpdate: () => this.gauge.setValue(tw.v),
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
    const events = this.match ? this.match.play(action) : this.trainingPlay(action);
    const hit = events.find((e): e is Extract<MatchEvent, { type: 'hit' }> => e.type === 'hit');
    const self = events.find((e): e is Extract<MatchEvent, { type: 'selfhit' }> => e.type === 'selfhit');
    const after = () => this.afterTurn(events);
    if (hit) this.slapAnim(hit, after);
    else if (self) this.selfSlapAnim(self, after);
    else after();
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

  private impact(hit: Extract<MatchEvent, { type: 'hit' }>, k: ReturnType<typeof computeStrike>, done: () => void) {
    const attSide = hit.attacker;
    const defSide = hit.defender;
    const att = this.f[attSide];
    const def = this.f[defSide];
    const result = hit.result;
    const limp = hit.kind === 'limp';

    // Contact : la main est sur la joue (pose idle), arrêt sur image puis réaction.
    this.setHp(defSide, def.hp - hit.damage);
    this.slapCount++;
    this.lastResult = result ? { ...result, kind: 'slap' } : { kind: 'limp', damage: hit.damage };
    const size = limp ? 0.45 : result!.critical ? 1.3 : result!.contact === 'clean' ? 1 : 0.6;
    this.burst(k.impactX, k.impactY, size);
    this.publish();

    this.time.delayedCall(HITSTOP_MS, () => {
      this.setPose(defSide, 'hit');
      const big = hit.damage >= 20;
      this.cameras.main.shake(big ? 180 : 110, (big ? 0.012 : 0.006) * (size < 0.7 ? 0.4 : 1));
      const label = limp
        ? 'GIFLE MOLLE…'
        : result!.critical
          ? undefined
          : result!.contact === 'grazed'
            ? 'EFFLEURÉE'
            : result!.contact === 'missed'
              ? 'RATÉE…'
              : undefined;
      popDamage(this, k.impactX + k.dir * 40, k.impactY - 80, hit.damage, { critical: result?.critical, label });
      this.tweens.add({ targets: def.sprite, x: def.homeX + k.dir * 18, duration: 90, yoyo: true, ease: 'Quad.Out' });
    });

    this.time.delayedCall(HITSTOP_MS + 300, () => {
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
    this.time.delayedCall(HITSTOP_MS + 560, () => {
      if (def.hp > 0) this.setPose(defSide, 'idle');
      done();
    });
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
    this.cameras.main.shake(120, 0.006);
    this.burst(fx, fy, 0.7);
    popDamage(this, fx, fy - 70, e.damage, { label: 'SURCHAUFFE !', color: CSS.red });
    this.publish();
    this.time.delayedCall(800, () => {
      if (fighter.hp > 0) this.setPose(side, 'idle');
      done();
    });
  }

  private setHp(side: Side, hp: number) {
    const fighter = this.f[side];
    fighter.hp = Math.max(0, this.match ? this.match.hp[side] : hp);
    fighter.bar.setValue(fighter.hp / MATCH.hp);
  }

  /** Éclair blanc et orange en étoile (version simple). */
  private burst(x: number, y: number, size: number) {
    const g = this.add.graphics().setDepth(40).setPosition(x, y);
    const star = (r: number, color: number, spikes = 10) => {
      g.fillStyle(color, 1);
      g.beginPath();
      for (let i = 0; i <= spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2 + Math.random() * 0.15;
        const rr = i % 2 ? r * 0.42 : r * (0.85 + Math.random() * 0.3);
        const px = Math.cos(a) * rr;
        const py = Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
    };
    star(95, COLORS.yellow);
    star(70, 0xff8a1f);
    star(42, 0xffffff, 8);
    g.setScale(0.3 * size).setAngle(Math.random() * 40);
    this.tweens.add({ targets: g, scale: size, duration: 90, ease: 'Quad.Out' });
    this.tweens.add({ targets: g, alpha: 0, delay: 110, duration: 160, onComplete: () => g.destroy() });
  }

  // ── K.O., fin de round, fin de match ───────────────────────────────────

  private knockout(loser: Side, events: MatchEvent[]) {
    const winner = other(loser);
    this.setPhase('roundEnd');
    this.setPose(loser, 'dazed');
    const d = bigAnnounce(this, 'K.O. !', CSS.yellow, 900, 150);
    this.cameras.main.shake(260, 0.01);
    this.time.delayedCall(250, () => this.setPose(winner, 'victory'));

    if (!this.match) {
      // Entraînement : on repart pour un tour.
      this.time.delayedCall(d + 300, () => {
        for (const s of ['left', 'right'] as const) {
          this.f[s].hp = MATCH.hp;
          this.f[s].bar.setValue(1, true);
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
      if (!matchOver) {
        const name = FIGHTERS[this.f[winner].id].short.toUpperCase();
        flashText(this, this.scale.width / 2, this.scale.height * 0.62, `ROUND POUR ${name} !`, CSS.cream, 40);
      }
    });
    this.time.delayedCall(d + 900, () => {
      if (matchOver) this.showResult(matchOver.winner);
      else this.startRound();
    });
  }

  private showResult(winner: Side) {
    const m = this.match!;
    this.setPhase('over');
    const { width, height } = this.scale;
    const loser = other(winner);
    this.setPose(winner, 'victory');
    this.setPose(loser, 'dazed');
    const w = FIGHTERS[this.f[winner].id];

    const c = this.add.container(0, 0).setDepth(200);
    // Voile (150) < vainqueur en pleine lumière (160) < panneau (200).
    const shade = this.add.rectangle(0, 0, width, height, COLORS.ink, 0.45).setOrigin(0).setDepth(150).setAlpha(0);
    this.tweens.add({ targets: shade, alpha: 1, duration: 300 });
    const band = this.add.rectangle(width / 2, height * 0.24, width * 1.3, 128, COLORS.red).setStrokeStyle(8, COLORS.ink).setAngle(-4);
    const title = this.add
      .text(width / 2, height * 0.23, 'VICTOIRE !', {
        fontFamily: FONT_TITLE,
        fontSize: '84px',
        color: CSS.yellow,
        stroke: CSS.ink,
        strokeThickness: 14,
      })
      .setOrigin(0.5)
      .setAngle(-4);
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
    const wonRounds = m.wins[winner];
    const lostRounds = m.wins[loser];
    const score = this.add
      .text(width / 2, height * 0.5, `${wonRounds} ROUNDS À ${lostRounds}`, {
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
    c.add(this.button(width / 2 - 160, height * 0.88, 'REVANCHE', COLORS.yellow, () => this.scene.restart({ mode: this.mode === 'autoplay' ? 'autoplay' : 'match', speed: this.speed })));
    c.add(this.button(width / 2 + 160, height * 0.88, 'ENTRAÎNEMENT', COLORS.cyan, () => this.scene.restart({ mode: 'training' })));
    this.f[winner].sprite.setDepth(160);
    this.timer.set(null);
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 300 });
    title.setScale(2);
    this.tweens.add({ targets: title, scale: 1, duration: 300, ease: 'Back.Out' });
    this.publish();
  }

  private button(x: number, y: number, label: string, color: number, onClick: () => void) {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, 270, 64, color).setStrokeStyle(6, COLORS.ink).setAngle(-3);
    const t = this.add
      .text(0, 0, label, { fontFamily: FONT_TITLE, fontSize: '28px', color: CSS.ink })
      .setOrigin(0.5)
      .setAngle(-3);
    c.add([bg, t]);
    c.setSize(270, 64).setInteractive({ useHandCursor: true });
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
