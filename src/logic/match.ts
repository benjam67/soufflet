// Déroulé d'un match : tours alternés, chrono, gifle molle, K.O., rounds, victoire,
// rage et gifles spéciales, état sonné.
// Pur et sans Phaser : la scène l'anime, les tests et simulations le pilotent seul.
import { ADVANCED, FIGHTERS, MATCH, SLAP, type FighterId } from '../config/balance';
import { computeSlap, type SlapResult } from './slap';

export type Side = 'left' | 'right';
export const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** Ce que fait le joueur dont c'est le tour. */
export type TurnAction =
  | { type: 'slap'; charge: number; speed: number; angle: number }
  | { type: 'selfslap' }
  | { type: 'timeout' };

export type MatchEvent =
  | { type: 'roundStart'; round: number; first: Side }
  | {
      type: 'hit';
      attacker: Side;
      defender: Side;
      /** Dégâts totaux de l'attaque (somme des coups pour La Toupie). */
      damage: number;
      kind: 'slap' | 'limp' | 'special';
      result?: SlapResult;
      /** Gifle spéciale : nom et dégâts de chaque coup. */
      special?: { name: string; hits: number[] };
    }
  | { type: 'rageFull'; side: Side }
  | { type: 'stunned'; side: Side }
  | { type: 'selfhit'; side: Side; damage: number }
  | { type: 'ko'; loser: Side }
  | { type: 'roundOver'; round: number; winner: Side; wins: Record<Side, number> }
  | { type: 'matchOver'; winner: Side }
  | { type: 'turn'; side: Side };

export type MatchPhase = 'idle' | 'turn' | 'roundOver' | 'matchOver';

export class Match {
  readonly ids: Record<Side, FighterId>;
  round = 0;
  wins: Record<Side, number> = { left: 0, right: 0 };
  hp: Record<Side, number> = { left: MATCH.hp, right: MATCH.hp };
  turn: Side = 'left';
  phase: MatchPhase = 'idle';
  winner: Side | null = null;
  lastRoundWinner: Side | null = null;
  turnsThisRound = 0;
  totalTurns = 0;
  /** Rage (0–100) : +1 par dégât reçu. Conservée d'un round à l'autre. */
  rage: Record<Side, number> = { left: 0, right: 0 };
  /** Rage pleine : la prochaine gifle de ce perso sera sa spéciale. */
  specialReady: Record<Side, boolean> = { left: false, right: false };
  /** Sonné : la jauge de ce perso montera de façon irrégulière à son prochain tour. */
  stunned: Record<Side, boolean> = { left: false, right: false };

  constructor(left: FighterId, right: FighterId, readonly first: Side = 'left') {
    this.ids = { left, right };
  }

  /** Démarre le round suivant. Le perdant du round précédent ouvre le bal. */
  startRound(): MatchEvent[] {
    if (this.phase === 'turn' || this.phase === 'matchOver') return [];
    this.round++;
    this.hp = { left: MATCH.hp, right: MATCH.hp };
    this.turn = this.lastRoundWinner ? other(this.lastRoundWinner) : this.first;
    this.turnsThisRound = 0;
    this.stunned = { left: false, right: false };
    this.phase = 'turn';
    return [
      { type: 'roundStart', round: this.round, first: this.turn },
      { type: 'turn', side: this.turn },
    ];
  }

  /** Résout le tour en cours. */
  play(action: TurnAction): MatchEvent[] {
    if (this.phase !== 'turn') return [];
    const att = this.turn;
    const def = other(att);
    const events: MatchEvent[] = [];
    this.turnsThisRound++;
    this.totalTurns++;

    // Le tour de ce perso est joué : s'il était sonné, il ne l'est plus.
    this.stunned[att] = false;

    if (action.type === 'slap') {
      const input = { attacker: this.ids[att], defender: this.ids[def], charge: action.charge, speed: action.speed, angle: action.angle };
      if (this.specialReady[att]) {
        // Gifle spéciale : la rage retombe à 0 une fois la spéciale lancée.
        const sp = FIGHTERS[this.ids[att]].special;
        const results = Array.from({ length: sp.hits }, () => computeSlap({ ...input, extra: sp.multiplier }));
        const hits = results.map((r) => r.damage);
        const damage = hits.reduce((a, b) => a + b, 0);
        this.specialReady[att] = false;
        this.rage[att] = 0;
        events.push(
          this.hurt(def, damage, { type: 'hit', attacker: att, defender: def, damage, kind: 'special', result: results[0], special: { name: sp.name, hits } }),
        );
      } else {
        const result = computeSlap(input);
        events.push(this.hurt(def, result.damage, { type: 'hit', attacker: att, defender: def, damage: result.damage, kind: 'slap', result }));
      }
    } else if (action.type === 'timeout') {
      events.push(
        this.hurt(def, MATCH.limpSlapDamage, { type: 'hit', attacker: att, defender: def, damage: MATCH.limpSlapDamage, kind: 'limp' }),
      );
    } else {
      events.push(this.hurt(att, SLAP.selfSlapDamage, { type: 'selfhit', side: att, damage: SLAP.selfSlapDamage }));
    }

    // Rage et état sonné de la victime.
    const hit = events[events.length - 1];
    const victim: Side = hit.type === 'selfhit' ? att : def;
    const received = hit.type === 'hit' || hit.type === 'selfhit' ? hit.damage : 0;
    if (received > 0 && this.hp[victim] > 0) {
      const before = this.rage[victim];
      this.rage[victim] = Math.min(ADVANCED.rageMax, before + received * ADVANCED.ragePerDamage);
      if (this.rage[victim] >= ADVANCED.rageMax && !this.specialReady[victim]) {
        this.specialReady[victim] = true;
        events.push({ type: 'rageFull', side: victim });
      }
      if (hit.type === 'hit' && received >= ADVANCED.stunThreshold) {
        this.stunned[victim] = true;
        events.push({ type: 'stunned', side: victim });
      }
    }

    const loser: Side | null = this.hp.left <= 0 ? 'left' : this.hp.right <= 0 ? 'right' : null;
    if (loser) {
      const winner = other(loser);
      this.wins[winner]++;
      this.lastRoundWinner = winner;
      events.push({ type: 'ko', loser });
      events.push({ type: 'roundOver', round: this.round, winner, wins: { ...this.wins } });
      if (this.wins[winner] >= MATCH.roundsToWin || this.round >= MATCH.maxRounds) {
        this.phase = 'matchOver';
        this.winner = this.wins.left > this.wins.right ? 'left' : 'right';
        events.push({ type: 'matchOver', winner: this.winner });
      } else {
        this.phase = 'roundOver';
      }
      return events;
    }

    this.turn = def;
    events.push({ type: 'turn', side: this.turn });
    return events;
  }

  private hurt<E extends MatchEvent>(side: Side, amount: number, event: E): E {
    this.hp[side] = Math.max(0, this.hp[side] - amount);
    return event;
  }

  /** Prénom affiché dans le bandeau « À TOI, … ! ». */
  shortName(side: Side): string {
    return FIGHTERS[this.ids[side]].short.toUpperCase();
  }
}
