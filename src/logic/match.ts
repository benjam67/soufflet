// Déroulé d'un match : tours alternés, chrono, gifle molle, K.O., rounds, victoire,
// rage et gifles spéciales, état sonné.
// Pur et sans Phaser : la scène l'anime, les tests et simulations le pilotent seul.
import { ADVANCED, DEFENSE, FIGHTERS, MATCH, SLAP, type FighterId } from '../config/balance';
import { computeSlap, type DefenseQuality, type SlapResult } from './slap';

export type Side = 'left' | 'right';
export const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** Ce que fait le joueur dont c'est le tour. */
export type TurnAction =
  | {
      type: 'slap';
      charge: number;
      speed: number;
      angle: number;
      /** Esquive de celui qui reçoit (swipe arrière au moment de l'impact). */
      defense?: DefenseQuality;
      /** Garde de rage : celui qui reçoit dépense toute sa rage pour une esquive parfaite garantie. */
      rageGuard?: boolean;
      /**
       * Gifle spéciale lancée volontairement (il faut la rage pleine) : vitesse et angle de chaque
       * gifle réussie. Le Battoir : une seule. La Toupie : de 1 à 3 selon le rythme tenu.
       */
      special?: { hits: { speed: number; angle: number }[] };
    }
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
      /** Esquive de la victime ('rage' = garde de rage), et dégâts évités. */
      defense?: DefenseQuality | 'rage';
      avoided?: number;
    }
  | { type: 'rageFull'; side: Side }
  | { type: 'stunned'; side: Side }
  | { type: 'selfhit'; side: Side; damage: number }
  | { type: 'ko'; loser: Side }
  /** Droit de réponse : `side` est à 0 PV mais rend une dernière gifle avant de tomber. */
  | { type: 'lastWord'; side: Side }
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
  /** Qui a ouvert la manche en cours. */
  opener: Side = 'left';
  /** Droit de réponse en cours : ce perso est à 0 PV et joue sa dernière gifle. */
  lastWord: Side | null = null;
  /** PV « en dessous de zéro » (pour départager un double K.O.). */
  private overkill: Record<Side, number> = { left: 0, right: 0 };

  constructor(left: FighterId, right: FighterId, readonly first: Side = 'left') {
    this.ids = { left, right };
  }

  /** Démarre le round suivant. Le perdant du round précédent ouvre le bal. */
  startRound(): MatchEvent[] {
    if (this.phase === 'turn' || this.phase === 'matchOver') return [];
    this.round++;
    this.hp = { left: MATCH.hp, right: MATCH.hp };
    this.turn = this.lastRoundWinner ? other(this.lastRoundWinner) : this.first;
    this.opener = this.turn;
    this.lastWord = null;
    this.overkill = { left: 0, right: 0 };
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
      // Esquive : garde de rage (toute la rage contre une esquive parfaite), sinon esquive au timing.
      const guard = !!action.rageGuard && this.specialReady[def];
      const defense: DefenseQuality | undefined = guard ? 'perfect' : action.defense;
      if (guard) {
        this.rage[def] = 0;
        this.specialReady[def] = false;
      } else if (defense === 'perfect') {
        this.rage[def] = Math.min(ADVANCED.rageMax, this.rage[def] + DEFENSE.perfectRageBonus);
      }
      const input = { attacker: this.ids[att], defender: this.ids[def], charge: action.charge, defense };
      const tag = guard ? ('rage' as const) : defense;
      if (action.special && this.specialReady[att]) {
        // Gifle spéciale, lancée volontairement : la rage retombe à 0.
        const sp = FIGHTERS[this.ids[att]].special;
        const list = action.special.hits.slice(0, sp.hits);
        const swings = list.length > 0 ? list : [{ speed: action.speed, angle: action.angle }];
        const results = swings.map((h) => computeSlap({ ...input, speed: h.speed, angle: h.angle, extra: sp.multiplier, zone: sp.goldenZone }));
        const hits = results.map((r) => r.damage);
        const damage = hits.reduce((a, b) => a + b, 0);
        const avoided = results.reduce((a, r) => a + r.avoided, 0);
        this.specialReady[att] = false;
        this.rage[att] = 0;
        events.push(
          this.hurt(def, damage, {
            type: 'hit',
            attacker: att,
            defender: def,
            damage,
            kind: 'special',
            result: results[0],
            special: { name: sp.name, hits },
            defense: tag,
            avoided,
          }),
        );
      } else {
        const result = computeSlap({ ...input, speed: action.speed, angle: action.angle });
        events.push(
          this.hurt(def, result.damage, { type: 'hit', attacker: att, defender: def, damage: result.damage, kind: 'slap', result, defense: tag, avoided: result.avoided }),
        );
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

    let loser: Side | null = this.hp.left <= 0 ? 'left' : this.hp.right <= 0 ? 'right' : null;
    if (MATCH.rightOfReply) {
      if (this.lastWord === att) {
        // La dernière gifle est jouée. Double K.O. : le moins « en dessous de zéro » gagne.
        this.lastWord = null;
        if (this.hp[def] <= 0 && this.hp[att] <= 0) loser = this.overkill[def] > this.overkill[att] ? def : this.overkill[def] < this.overkill[att] ? att : def;
        else loser = att;
      } else if (loser === def && att === this.opener && hit.type === 'hit') {
        // Celui qui a ouvert met l'autre K.O. : l'autre a joué un tour de moins, il répond.
        this.lastWord = def;
        this.turn = def;
        events.push({ type: 'lastWord', side: def });
        events.push({ type: 'turn', side: def });
        return events;
      }
    }
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
    this.overkill[side] += Math.max(0, amount - this.hp[side]);
    this.hp[side] = Math.max(0, this.hp[side] - amount);
    return event;
  }

  /** Prénom affiché dans le bandeau « À TOI, … ! ». */
  shortName(side: Side): string {
    return FIGHTERS[this.ids[side]].short.toUpperCase();
  }
}

/**
 * Reconstruit un match à partir de la suite des actions jouées (jeu en ligne : reprise après
 * une coupure ou un rechargement). Les rounds s'enchaînent tout seuls.
 */
export function replayMatch(log: TurnAction[], left: FighterId = 'bernard', right: FighterId = 'lola', first: Side = 'left'): Match {
  const m = new Match(left, right, first);
  m.startRound();
  for (const action of log) {
    if (m.phase === 'roundOver') m.startRound();
    if (m.phase !== 'turn') break;
    m.play(action);
  }
  if (m.phase === 'roundOver') m.startRound();
  return m;
}
