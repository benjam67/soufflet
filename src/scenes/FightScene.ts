import Phaser from 'phaser';
import assets from '../config/assets.json';
import { FIGHTERS, MATCH, SLAP, STAGE, type FighterId } from '../config/balance';
import { computeLayout, computeStrike, HABITUES, type StageLayout } from '../logic/layout';
import { SlapGesture, type GestureOutcome } from '../logic/gesture';
import { computeSlap, type SlapResult } from '../logic/slap';
import { ChargeGauge } from '../ui/ChargeGauge';
import { HealthBar } from '../ui/HealthBar';
import { flashText, popDamage } from '../ui/popups';
import { COLORS, CSS, FONT_TITLE, FONT_UI } from '../ui/theme';
import { fighterKey, type Pose } from './BootScene';

type Side = 'left' | 'right';
type Mode = 'training';

interface Fighter {
  side: Side;
  id: FighterId;
  sprite: Phaser.GameObjects.Image;
  bar: HealthBar;
  hp: number;
  pose: Pose;
  homeX: number;
}

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');
/** Arrêt sur image au contact, avant la réaction (direction artistique : 80 ms). */
const HITSTOP_MS = 80;

/**
 * Scène de combat.
 * Phase 1 : mode entraînement — Bernard gifle Lola en boucle.
 */
export class FightScene extends Phaser.Scene {
  private decor!: Phaser.GameObjects.Image;
  private patron!: Phaser.GameObjects.Image;
  private crowd: Phaser.GameObjects.Image[] = [];
  private f!: Record<Side, Fighter>;
  private gauge!: ChargeGauge;
  private hint!: Phaser.GameObjects.Text;
  private modeLabel!: Phaser.GameObjects.Text;
  layout!: StageLayout;

  private mode: Mode = 'training';
  private attacker: Side = 'left';
  private state: 'ready' | 'charging' | 'busy' = 'ready';
  private gesture: SlapGesture | null = null;
  private pointerId = -1;
  private slapCount = 0;
  private lastResult: (SlapResult & { kind: 'slap' }) | { kind: 'selfslap'; damage: number } | null = null;

  constructor() {
    super('Fight');
  }

  init(data: { mode?: Mode }) {
    this.mode = data.mode ?? 'training';
    this.attacker = 'left';
    this.state = 'ready';
    this.gesture = null;
    this.slapCount = 0;
    this.lastResult = null;
  }

  create() {
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
      .setDepth(100);
    this.modeLabel = this.add
      .text(0, 0, 'ENTRAÎNEMENT', {
        fontFamily: FONT_TITLE,
        fontSize: '20px',
        color: CSS.cream,
        backgroundColor: CSS.red,
        padding: { x: 12, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setAngle(-3)
      .setDepth(100);

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this));

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);

    this.setHint();
    this.publish();
    if (window.__slap) {
      window.__slap.ready = true;
      window.__slap.scene = 'Fight';
    }
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
    return { side, id, sprite, bar, hp: MATCH.hp, pose: 'idle', homeX: 0 };
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

    // Interface
    const margin = 22;
    const barW = width / 2 - margin - 90;
    this.f.left.bar.layout(margin, 16, barW);
    this.f.right.bar.layout(width - margin, 16, barW);
    this.f.left.bar.setValue(this.f.left.hp / MATCH.hp, true);
    this.f.right.bar.setValue(this.f.right.hp / MATCH.hp, true);
    this.gauge.layout(margin + 6, height * 0.3, height * 0.52);
    this.hint.setPosition(width / 2, height - 12);
    this.modeLabel.setPosition(width / 2, 14);

    if (window.__slap) window.__slap.layout = L;
  }

  // ── État visible par les tests ─────────────────────────────────────────

  private publish() {
    if (!window.__slap) return;
    window.__slap.state = {
      mode: this.mode,
      phase: this.state,
      attacker: this.attacker,
      hp: { left: this.f.left.hp, right: this.f.right.hp },
      pose: { left: this.f.left.pose, right: this.f.right.pose },
      slaps: this.slapCount,
      last: this.lastResult,
      charge: this.gesture ? this.gesture.charge(performance.now()) : 0,
    };
  }

  setPose(side: Side, pose: Pose) {
    const fighter = this.f[side];
    fighter.pose = pose;
    fighter.sprite.setTexture(fighterKey(fighter.id, pose));
    this.publish();
  }

  private setHint() {
    const def = FIGHTERS[this.f[other(this.attacker)].id].name.split(' ')[0];
    this.hint.setText(`MAINTIENS pour armer  ·  GLISSE vers ${def} pour gifler`);
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
    if (this.state !== 'ready') return;
    const att = this.f[this.attacker];
    this.gesture = new SlapGesture(att.id, this.attacker === 'left' ? 1 : -1);
    const { x, y } = this.css(p);
    this.gesture.down(this.now(p), x, y);
    this.pointerId = p.id;
    this.state = 'charging';
    this.gauge.setZone(FIGHTERS[att.id].goldenZone);
    this.gauge.setValue(0);
    this.gauge.show(true);
    this.setPose(this.attacker, 'windup');
    this.hint.setVisible(false);
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (this.state !== 'charging' || !this.gesture || p.id !== this.pointerId || !p.isDown) return;
    const { x, y } = this.css(p);
    this.resolve(this.gesture.move(this.now(p), x, y));
  }

  private onUp(p: Phaser.Input.Pointer) {
    if (this.state !== 'charging' || !this.gesture || p.id !== this.pointerId) return;
    const { x, y } = this.css(p);
    this.resolve(this.gesture.up(this.now(p), x, y));
  }

  update() {
    if (this.state === 'charging' && this.gesture) {
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

  private resolve(out: GestureOutcome | null) {
    if (!out) return;
    const att = this.f[this.attacker];
    att.sprite.x = att.homeX;
    if (out.type === 'cancel') {
      this.gesture = null;
      this.state = 'ready';
      this.gauge.show(false);
      this.setPose(this.attacker, 'idle');
      this.hint.setVisible(true);
      if (out.reason !== 'no-swipe') {
        const def = FIGHTERS[this.f[other(this.attacker)].id].name.split(' ')[0];
        flashText(this, this.scale.width / 2, this.scale.height * 0.42, `PLUS FORT, VERS ${def.toUpperCase()} !`, CSS.cream, 34);
      }
      return;
    }
    this.state = 'busy';
    this.gesture = null;
    if (out.type === 'selfslap') {
      this.gauge.setValue(100, true);
      this.time.delayedCall(250, () => this.gauge.show(false));
      this.selfSlap();
    } else {
      this.gauge.setValue(out.charge);
      this.time.delayedCall(350, () => this.gauge.show(false));
      const result = computeSlap({
        attacker: att.id,
        defender: this.f[other(this.attacker)].id,
        charge: out.charge,
        speed: out.speed,
        angle: out.angle,
      });
      this.slap(result);
    }
    this.publish();
  }

  // ── Animations ─────────────────────────────────────────────────────────

  /** windup → swing (60 ms) → slap avec pas en avant → impact → retour. */
  private slap(result: SlapResult) {
    const attSide = this.attacker;
    const defSide = other(attSide);
    const att = this.f[attSide];
    const def = this.f[defSide];
    const k = computeStrike(this.layout, attSide, att.id, def.id);
    att.sprite.setDepth(11);
    def.sprite.setDepth(10);

    this.setPose(attSide, 'swing');
    this.time.delayedCall(60, () => {
      this.setPose(attSide, 'slap');
      this.tweens.add({
        targets: att.sprite,
        x: att.homeX + k.dir * k.step,
        duration: 70,
        ease: 'Quad.Out',
        onComplete: () => this.impact(result, k),
      });
    });
  }

  private impact(result: SlapResult, k: ReturnType<typeof computeStrike>) {
    const attSide = this.attacker;
    const defSide = other(attSide);
    const att = this.f[attSide];
    const def = this.f[defSide];

    // Contact : la main est sur la joue (pose idle), arrêt sur image puis réaction.
    this.damage(defSide, result.damage);
    this.slapCount++;
    this.lastResult = { ...result, kind: 'slap' };
    this.burst(k.impactX, k.impactY, result.critical ? 1.3 : result.contact === 'clean' ? 1 : 0.6);
    this.publish();

    this.time.delayedCall(HITSTOP_MS, () => {
      this.setPose(defSide, 'hit');
      const big = result.damage >= 20;
      this.cameras.main.shake(big ? 180 : 110, (big ? 0.012 : 0.006) * (result.contact === 'missed' ? 0.4 : 1));
      const label = result.critical ? undefined : result.contact === 'grazed' ? 'EFFLEURÉE' : result.contact === 'missed' ? 'RATÉE…' : undefined;
      popDamage(this, k.impactX + k.dir * 40, k.impactY - 80, result.damage, { critical: result.critical, label });
      this.tweens.add({ targets: def.sprite, x: def.homeX + k.dir * 18, duration: 90, yoyo: true, ease: 'Quad.Out' });
    });

    this.time.delayedCall(HITSTOP_MS + 300, () => {
      this.tweens.add({
        targets: att.sprite,
        x: att.homeX,
        duration: 200,
        ease: 'Quad.InOut',
        onComplete: () => this.setPose(attSide, 'idle'),
      });
    });
    this.time.delayedCall(HITSTOP_MS + 560, () => {
      if (def.hp <= 0) this.knockout(defSide);
      else {
        this.setPose(defSide, 'idle');
        this.endTurn();
      }
    });
  }

  private selfSlap() {
    const side = this.attacker;
    const fighter = this.f[side];
    this.setPose(side, 'selfslap');
    this.damage(side, SLAP.selfSlapDamage);
    this.lastResult = { kind: 'selfslap', damage: SLAP.selfSlapDamage };
    const s = this.layout.fighterScale;
    const a = assets.fighters[fighter.id];
    const dir = side === 'left' ? 1 : -1;
    // La main se pose sur la joue, un peu en retrait de l'avant du visage.
    const fx = fighter.homeX + dir * (a.face.x - 55) * s;
    const fy = fighter.sprite.y - a.face.y * s;
    this.cameras.main.shake(120, 0.006);
    this.burst(fx, fy, 0.7);
    popDamage(this, fx, fy - 70, SLAP.selfSlapDamage, { label: 'SURCHAUFFE !', color: CSS.red });
    this.publish();
    this.time.delayedCall(800, () => {
      if (fighter.hp <= 0) this.knockout(side);
      else {
        this.setPose(side, 'idle');
        this.endTurn();
      }
    });
  }

  private damage(side: Side, amount: number) {
    const fighter = this.f[side];
    fighter.hp = Math.max(0, fighter.hp - amount);
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

  private knockout(side: Side) {
    this.setPose(side, 'dazed');
    const winner = other(side);
    flashText(this, this.scale.width / 2, this.scale.height * 0.4, 'K.O. !', CSS.yellow, 96);
    this.time.delayedCall(250, () => this.setPose(winner, 'victory'));
    // Entraînement : on repart pour un tour.
    this.time.delayedCall(1700, () => {
      for (const s of ['left', 'right'] as const) {
        this.f[s].hp = MATCH.hp;
        this.f[s].bar.setValue(1, true);
        this.setPose(s, 'idle');
      }
      this.endTurn();
    });
  }

  private endTurn() {
    // Entraînement : c'est toujours au même de gifler.
    this.state = 'ready';
    this.hint.setVisible(true);
    this.publish();
  }
}
