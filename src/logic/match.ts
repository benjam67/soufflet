// Déroulé d'un match : tours alternés, chrono, gifle molle, K.O., rounds, victoire.
// Pur et sans Phaser : la scène l'anime, les tests et simulations le pilotent seul.
import { FIGHTERS, MATCH, SLAP, type FighterId } from '../config/balance';
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
  | { type: 'hit'; attacker: Side; defender: Side; damage: number; kind: 'slap' | 'limp'; result?: SlapResult }
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

    if (action.type === 'slap') {
      const result = computeSlap({
        attacker: this.ids[att],
        defender: this.ids[def],
        charge: action.charge,
        speed: action.speed,
        angle: action.angle,
      });
      events.push(this.hurt(def, result.damage, { type: 'hit', attacker: att, defender: def, damage: result.damage, kind: 'slap', result }));
    } else if (action.type === 'timeout') {
      events.push(
        this.hurt(def, MATCH.limpSlapDamage, { type: 'hit', attacker: att, defender: def, damage: MATCH.limpSlapDamage, kind: 'limp' }),
      );
    } else {
      events.push(this.hurt(att, SLAP.selfSlapDamage, { type: 'selfhit', side: att, damage: SLAP.selfSlapDamage }));
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
